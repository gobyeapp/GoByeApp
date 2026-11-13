# Deploying on Cloudflare (D-065)

**Status (2026-11-13):** configuration built and checked, **nothing deployed**.
- `wrangler deploy --dry-run` passes for the website and the admin.
- The API container config is accepted. Its image build needs Docker Hub, which is reachable on GitHub's runners but blocked in the build workspace.
- Deploying needs the owner's Cloudflare account, the **Workers Paid plan ($5/month)** for Containers, a rotated Cloudflare token (C-6), and approval.

```
Riders, drivers, admin ──▶ api-staging.gobye.app  (gateway Worker: signs every request, rate limits)
                                  │ ORIGINS_JSON → this address
                                  ▼
                        gobye-api-staging (Worker) ──▶ container: apps/api image (API + job worker)
                                  │ cron every 5 min keeps it awake         │
                                                                            ▼
                                                     Supabase gobye-staging (London): Postgres + Auth
Website  ──▶ gobye-web     (static files, apps/web)
Admin    ──▶ gobye-admin   (static files, apps/admin/dist; unknown paths → index.html)
```

## 1. API on Cloudflare Containers

| File | What it is |
|---|---|
| `infra/cloudflare/src/workers/api-container/index.ts` | Worker plus `GobyeApi` container class. Port 8080; sleeps after 15 minutes idle; internet access on for Supabase. Every request goes to one instance (`gobye-api-primary`, location hint `weur`, near London). A cron every 5 minutes calls `/health/live`, so the in-process job worker keeps running. |
| `.../api-container/logic.ts` | Which settings are passed into the container: a fixed list plus `WHATSAPP_*` and `R2_*`. Bindings and other Worker values never are (tests: `infra/cloudflare/test/api-container.test.ts`). |
| `.../api-container/wrangler.api-container.toml` | `[env.staging]` settings: `basic` instance (¼ vCPU, 1 GiB), at most 2 instances; image built from `apps/api/Dockerfile` with the repository root as context; non-secret staging settings. `apps/api/test/config.test.ts` checks that these settings plus the four secrets form a valid staging configuration. |
| `.github/workflows/deploy-api-staging.yml` | Manual **Deploy API (staging)**: checks the settings, builds the image and deploys, sets the four secrets with `wrangler secret bulk`, then health-checks the origin. |

**The API stays behind the gateway.** The container Worker has a workers.dev address. The API refuses `/v1` requests without the gateway's signature (`ORIGIN_AUTH_REQUIRED=true` in staging), so that address is no way around the gateway. Later improvement: a service binding from the gateway, which gives the API no public address at all.

**Cost:**
- Workers Paid plan, $5/month, which includes 25 GiB-hours of memory and 375 vCPU-minutes.
- A `basic` instance awake all month uses about 730 GiB-hours, so about $6.35/month of memory beyond the allowance, plus a little CPU.
- Total estimate: **about $11–12/month**. Check this against the first invoice.

## 2. Website and admin on Cloudflare static hosting

| Site | Files | Notes |
|---|---|---|
| Website (`apps/web`) | `wrangler.toml`, `_headers`, `_redirects`, `.assetsignore` | Same headers as `vercel.json` (enforced by `infra/cloudflare/test/static-sites.test.ts`); `/open/*` → `open.html`; clean URLs. |
| Admin (`apps/admin`) | `wrangler.toml`, `public/_headers` | Serves `dist/` after `npm run build`; unknown paths return `index.html`. |

Both deploy first to their `preview` environment, a workers.dev address, for checking. Moving `gobye.app` and `admin.gobye.app` off Vercel is a DNS change that needs the owner's approval. Vercel keeps serving until then.

## 3. Owner steps, in order

1. **Rotate the Cloudflare token** (`SECURITY_CREDENTIAL_ROTATION.md` X-3). Create a new one scoped to this account with **Workers Scripts: Edit**, **Containers: Edit** and **Account Settings: Read**, expiring within 90 days.
2. **Turn on Workers Paid** (Cloudflare dashboard → Workers & Pages → Plans). This is a paid activation, so only the owner does it.
3. **Finish the staging database** (`Actions → Staging database → up`, currently paused on the migrator password).
4. In GitHub, under **Settings → Environments → staging**, add:
   - **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `STAGING_ORIGIN_AUTH_SECRET` (48 random characters, e.g. `openssl rand -base64 36`).
   - **Variable:** `STAGING_DATABASE_CA_CERT`. Download it from Supabase → Project Settings → Database → SSL Configuration and paste the whole PEM file; it is public.
5. Run **Actions → Deploy API (staging)**. Copy the `workers.dev` address from the log into the variable `STAGING_API_ORIGIN_URL`, then run it again to health-check it.
6. **Supabase sign-in for staging** (Authentication settings):
   - asymmetric JWT signing key (ECC P-256), so `/health/ready` reports `ok` and not `degraded`;
   - email sign-in on;
   - phone sign-in with the chosen SMS provider (A-4, not the paid MFA add-on);
   - TOTP MFA on for staff;
   - access token lifetime 15 minutes;
   - refresh token rotation on;
   - redirect URLs for the apps only.
7. **Gateway:**
   - set the staging gateway's `ORIGINS_JSON` to the container Worker's address;
   - set the same `ORIGIN_AUTH_SECRET` with `wrangler secret put`;
   - deploy the gateway's `preview` or `staging` environment.

## 4. Still to check on staging (not provable from here)

- **Where the container actually runs.** The location hint applies to the Durable Object; Cloudflare says container placement is chosen for routing and startup speed. Measure database latency from the container.
- **Cold start.** Cloudflare quotes 1–3 seconds. Measure it with the cron in place.
- **Outbound connections to Supabase's pooler** (Postgres over TCP on 5432 and 6543) from the container.
- **Containers' product status** and its limits on the account.
- The rest of `BACKEND_PHASE_1_VERIFICATION.md` §4.6, which defines when staging is ready.

## Sources

- [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- [Containers platform details](https://developers.cloudflare.com/containers/platform-details/)
- [Containers getting started](https://developers.cloudflare.com/containers/get-started/)
- [Containers: environment variables and secrets](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/)
