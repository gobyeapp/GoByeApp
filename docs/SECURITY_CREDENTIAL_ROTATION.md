# Credential rotation checklist (C-6, Phase 1.5)

**Status (2026-10-23):** **open, owner action.** None of the credentials below has been rotated yet. This page names each credential by **type and location only**. It never contains a value, and nobody should paste a new value into chat to "check" it.

## 1. What was exposed, and where

Found by:
- the incident notes (`ENVIRONMENT_CONFIGURATION.md`, `LOG.md`);
- a pattern scan of the working tree and the **entire git history**: GitHub tokens, Supabase secret keys and JWTs, Cloudflare tokens, AWS-style keys, private keys and database URLs with passwords.

The scan printed counts and file names only, never values.

| # | Credential (type) | Exposed how | In git? | Still in use? | Severity |
|---|---|---|---|---|---|
| X-1 | **GitHub fine-grained personal access token** (`github_pat_…`) with push access to `gobyeapp/gobyeapp` | Pasted in chat (2026-10-22). It is stored in this AI workspace's conversation history and used for every push from here. | No | **Yes**: every push this week | **High**: anyone holding it can push code **and change GitHub Actions workflows** (a workflow file was pushed with it on 2026-10-23, so it has that scope) |
| X-2 | **Supabase `service_role` key** of the website project `morqitxqsfiprefczduo` (legacy JWT-based key) | Pasted in chat (2026-10-22) | No | Not by GoBye code (the website uses only the public anon key) | **High**: bypasses RLS on the waitlist (emails) and demo tables |
| X-3 | **Cloudflare API token** (scoped: Workers, R2, DNS for `gobye.app`, per the setup brief) | Saved by the owner into this workspace for `tools/cloudflare-setup.mjs` (D-051). The file was shredded on 2026-10-23, but the token itself was never revoked. | No | No (the workspace cannot reach api.cloudflare.com) | **High**: DNS for gobye.app can be changed |
| — | Supabase **anon** key of the website project | In `apps/web/site.config.js` by design (decoded role: `anon`) | Yes, intended | Yes | Public by design. Risk is the RLS on the demo tables (R-6), not the key. **Changes if X-2 is rotated by disabling legacy keys** (see X-2 steps). |
| — | `AKIAIOSFODNN7EXAMPLE` in `infra/cloudflare/test/r2-sigv4.test.ts` | AWS's documented example key, used for signature test vectors | Yes | n/a | None |
| — | Test-only passwords (`gobye_local_only`, `gobye_api_local_only`, `postgres_ci_only`) | Local and CI throwaway databases | Yes | Local or CI only | None. Never reuse them anywhere real. |

**Not found:** no Supabase secret key (`sb_secret_…`), private key, R2 secret, Vercel token, payment key, or database URL with a real password, anywhere in the tree or history.

**Not checked:** the owner's own computer, and other places the owner may have pasted these values (notes, other chats, email).

## 2. Rotation steps (owner; in this order)

### X-1 GitHub token (do first)

1. **Decide how this workspace will push afterwards**, because rotating ends the current method:
   - **(a, recommended)** give the Claude GitHub integration write access to `gobyeapp/gobyeapp` (Settings → GitHub Apps / collaborators), so no token passes through chat; or
   - **(b)** the owner pushes from their computer: the workspace already copies changed files to `C:\Users\yatij\Downloads\GOBYE`.
2. github.com → Settings → Developer settings → Fine-grained tokens → the token → **Revoke**.
3. Review **Settings → Security log** and the repository's commits, branches, Actions settings and deploy keys for anything you didn't do since 2026-10-22.
4. If a replacement token is needed for a tool: create it with the smallest scope (one repository; Contents read/write; **no** Workflows or Administration unless needed), an expiry of 30 days or less, and store it in the password manager.

**Verify the old token is dead.** From any shell, with the old token in a variable, never on the command line:
```bash
read -s OLD && git -c http.extraHeader="Authorization: Basic $(printf 'x-access-token:%s' "$OLD" | base64 -w0)" ls-remote https://github.com/gobyeapp/gobyeapp >/dev/null 2>&1 && echo "STILL WORKS" || echo "revoked"; unset OLD
```
Expected: `revoked` (authentication failed). This workspace can run the same check with the token it holds once the owner says it is revoked. Then it will delete the token from its instructions.

### X-2 Supabase keys of the website project

The legacy `service_role` key cannot be rotated on its own: it is a JWT signed with the project's JWT secret. Two options:
- **(a, recommended)** Settings → API keys: create the **new** publishable and secret keys, then **disable the legacy JWT-based API keys**. That kills both the leaked `service_role` key and the current anon key.
  1. Before disabling, put the **new publishable key** in `apps/web/site.config.js` and redeploy the website, or the waitlist form stops working.
  2. Then disable the legacy keys.
- **(b)** Rotate the JWT secret. This also invalidates the anon key and every session, so the same website update is needed.

Also: change the project's **database password** if it was ever shared, and review Auth → Users and the `waitlist` table for unexpected changes since 2026-10-22.

**Verify:** with the old key in a variable:
```bash
read -s OLD && curl -s -o /dev/null -w '%{http_code}\n' "https://morqitxqsfiprefczduo.supabase.co/rest/v1/waitlist?select=id&limit=1" -H "apikey: $OLD" -H "Authorization: Bearer $OLD"; unset OLD
```
Expected: `401`. Before rotation the same call returns `200`. Then confirm the website's waitlist still accepts a test sign-up with the new publishable key (expected `201`, or `409` for a repeat email).

### X-3 Cloudflare token

1. dash.cloudflare.com → My Profile → API Tokens → the token → **Roll** or **Delete**.
2. Review Audit Logs (Manage Account → Audit Log) for DNS, Workers or R2 changes since the token was created.

**Verify:**
```bash
read -s OLD && curl -s https://api.cloudflare.com/client/v4/user/tokens/verify -H "Authorization: Bearer $OLD" | grep -o '"success":[a-z]*'; unset OLD
```
Expected: `"success":false` (invalid token).

## 3. Rotate before staging, by design

| Credential | When | Rule |
|---|---|---|
| Staging database passwords (`postgres`, `gobye_migrator`, `gobye_api`) | Created fresh in the password manager (STAGING_SUPABASE.md §4) | Never shared in chat; rotate on any suspicion, then update the host variables |
| `ORIGIN_AUTH_SECRET` (gateway ↔ API) | Generated once per environment (`openssl rand -base64 48`) | Rotate by setting the new value on the Worker and the API in the same window |
| Deployment tokens (StackShift, Vercel, Cloudflare `wrangler`) | When the accounts are created | Scoped per project, with an expiry, stored in the password manager or CI secrets, never in the repo |
| R2 S3 keys | When `STORAGE_PROVIDER=r2` is enabled | Bucket-scoped, one pair per environment |

## 4. Status board

| # | Rotated | Old value verified dead | Activity reviewed | Date / by |
|---|---|---|---|---|
| X-1 GitHub PAT | ☐ | ☐ | ☐ | |
| X-2 Supabase website keys | ☐ | ☐ | ☐ | |
| X-3 Cloudflare token | ☐ | ☐ | ☐ | |

**C-6 is closed only when all three rows are ticked.** Until then, risk R-1 stays **High** in `BACKEND_PHASE_1_VERIFICATION.md`.
