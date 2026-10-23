# Cloudflare setup (D-051)

What to create in Cloudflare for GoBye, and in what order. **Nothing on this page has been done.** Every step is **pending credentials and owner approval**. No DNS record, bucket, token, Worker or paid feature has been created or changed by this repository.

API gateway, DNS and load balancing: see `API_GATEWAY.md`, `NETWORK_ARCHITECTURE.md` and `LOAD_BALANCING_FAILOVER.md`.


## One-command setup from your computer (2026-10-23)

This workspace can't reach the Cloudflare API on the free Claude plan, so the setup runs on the owner's computer with `tools/cloudflare-setup.mjs` (no extra installs; it downloads Wrangler with `npx` when deploying).

```powershell
# from the GOBYE folder, PowerShell
$env:CLOUDFLARE_API_TOKEN="<the setup token>"
node tools/cloudflare-setup.mjs            # look only: prints what it would do, changes nothing
node tools/cloudflare-setup.mjs --apply    # makes the changes
```

`--apply` (idempotent, safe to re-run): verifies the token; finds the account and the gobye.app zone; saves a DNS backup to `cloudflare-dns-backup-<time>.json`; creates the 8 R2 buckets (`gobye-{staging,prod}-{public-media,private-documents,private-evidence,private-uploads}`, r2.dev off); applies CORS from `r2/cors.*.json` to uploads and public-media; deploys the API gateway to `api-staging.gobye.app` / `api.gobye.app` and the public media Worker to `media-staging.gobye.app` / `media.gobye.app` as Worker custom domains; stores a random `ORIGIN_AUTH_SECRET` in Cloudflare; checks the addresses. It never touches `gobye.app` / `www` (Vercel) and skips any hostname that already has an unrelated DNS record. A summary without secrets is written to `cloudflare-setup-report.json`. Both output files are git-ignored.

Not done by the script (needs a separate R2 S3 key): the upload signer Worker. Status after the owner runs it: **Pending deployment** until the report comes back.

Staging hostnames are one level (`api-staging`, `media-staging`) so Cloudflare's free Universal SSL certificate covers them (Q-070).

## 0. Before you start

- **Account:** use one Cloudflare account owned by GoBye (not a personal one), with 2FA on every member, and add a second owner.
- **Plan:** R2 and Workers Paid ($5/month) cover what's below; Load Balancing is a separate paid add-on and stays off (`LOAD_BALANCING_FAILOVER.md`).
- **Location hint:** R2 location hint `weur` (closest R2 region to Nigeria today); revisit if Cloudflare adds an African R2 location.
- **Tooling:** Wrangler from a trusted machine (`npx wrangler@<pinned version>`), logged in with `wrangler login`. Never commit `.wrangler/` or tokens.

## 1. R2 buckets — staging first

Bucket definitions: `infra/cloudflare/r2/buckets.json`.

```bash
# Staging
npx wrangler r2 bucket create gobye-staging-private-uploads   --location weur
npx wrangler r2 bucket create gobye-staging-private-documents --location weur
npx wrangler r2 bucket create gobye-staging-private-evidence  --location weur
npx wrangler r2 bucket create gobye-staging-public-media      --location weur
# Production (only after staging is verified)
npx wrangler r2 bucket create gobye-prod-private-uploads   --location weur
npx wrangler r2 bucket create gobye-prod-private-documents --location weur
npx wrangler r2 bucket create gobye-prod-private-evidence  --location weur
npx wrangler r2 bucket create gobye-prod-public-media      --location weur
```

Then check every bucket in the dashboard (R2 → bucket → Settings):
- **Public access → R2.dev subdomain: Disabled** on all eight, including public-media.
- **Custom domains:**
  - none on the three private buckets, ever;
  - `media-staging.gobye.app` → `gobye-staging-public-media`, and `media.gobye.app` → `gobye-prod-public-media`, only once the hostname is approved. Alternatively serve them through the media-gateway Worker (section 4); choose one route, not both.
- **CORS:**
  - apply `cors.staging.json` / `cors.production.json` to the `private-uploads` and `public-media` buckets only;
  - check the origin list first.
- **Lifecycle:**
  - staging may use the cleanup rules in `lifecycle.proposed.json`;
  - production waits for retention sign-off.

## 2. API tokens (least privilege)

Create R2 API tokens (R2 → Manage R2 API tokens), **one per environment**:

| Token | Permission | Buckets | Used by |
|---|---|---|---|
| `gobye-staging-signer` | Object Read & Write | the four `gobye-staging-*` buckets only | staging upload signer |
| `gobye-prod-signer` | Object Read & Write | the four `gobye-prod-*` buckets only | production upload signer |
| `gobye-prod-backup` (later) | Object Read on prod private buckets; Write on the backup bucket | backup job | `BACKUP_DISASTER_RECOVERY.md` |

- Never use an Admin token in a Worker, and never give staging credentials access to production buckets.
- Record each token's owner and creation date.
- Rotate every 90 days and immediately when someone leaves.
- The R2 secret is shown once: put it straight into `wrangler secret put` (below) and nowhere else (no chat, email, Git or `.env` committed).

## 3. Upload signer Worker

Template: `infra/cloudflare/r2/wrangler.upload-signer.toml`. Code: `infra/cloudflare/src/workers/upload-signer`.

```bash
cd infra/cloudflare/r2
# Secrets (prompted, never echoed). Repeat with --env production after staging passes.
npx wrangler secret put R2_ACCOUNT_ID            --config wrangler.upload-signer.toml --env staging
npx wrangler secret put R2_ACCESS_KEY_ID         --config wrangler.upload-signer.toml --env staging
npx wrangler secret put R2_SECRET_ACCESS_KEY     --config wrangler.upload-signer.toml --env staging
npx wrangler secret put GATEWAY_ASSERTION_SECRET --config wrangler.upload-signer.toml --env staging   # ≥ 32 random chars, shared with the API gateway only
npx wrangler deploy --config wrangler.upload-signer.toml --env staging
```

- **Not public on its own:**
  - `workers_dev = false`;
  - reach it only from the API gateway (service binding or a route under `api.gobye.app/v1/files/*`);
  - requests without a valid gateway assertion get `401`.
- **Metadata:** the deployed entry point keeps metadata in memory, which does not survive restarts. Real use needs the metadata repository on the chosen database (**pending provider selection**).
- **Scanning:** no scanner is bound, so uploads stay "checking" and are never served (fail closed) until a malware-scanning service is connected (**pending provider selection**).

## 4. Public media gateway Worker (optional)

Template: `infra/cloudflare/r2/wrangler.media-gateway.toml`. No secrets.

```bash
npx wrangler deploy --config wrangler.media-gateway.toml --env staging
```

- **Prerequisites:** the zone must be on Cloudflare and `media-staging.gobye.app` approved. The route in the template attaches the Worker to that hostname.
- **Bucket:** it is bound to the public bucket only.

## 5. Staging verification (before any production step)

Follow `INFRASTRUCTURE_TEST_PLAN.md` § R2. In short:
- upload a JPEG through the signer and complete it;
- confirm a PUT with a wrong `x-amz-checksum-sha256` is refused by R2;
- confirm an expired URL is refused;
- confirm private objects are unreachable without a presigned URL;
- confirm `r2.dev` is off;
- confirm CORS blocks an unlisted origin.

Record the results in `TEST_PLAN.md`.

## 6. What is not on this page

DNS records for `gobye.app` (Vercel stays as is), the API gateway Worker, WAF and rate-limit rules, and Load Balancing — see the documents linked at the top.
