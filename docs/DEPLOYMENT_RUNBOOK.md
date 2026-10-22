# Deployment runbook (D-051)

How to deploy and roll back each part. **Nothing has been deployed by this work.** Cloudflare steps need an
account, credentials and owner approval; DNS changes need explicit approval; Load Balancing is a paid add-on
and needs separate approval. Always staging first.

## Before any deploy

1. `npm run typecheck && npm test` at the repo root (includes `infra/cloudflare`).
2. `npm run check:env -- <env file>` for every env file you are about to use (apps, admin). It must print no
   problems. It never prints values.
3. Confirm you're targeting the right environment (staging vs production) and have the approval recorded.

## Website (`apps/web`, Vercel) — existing, keep as is

- Deploy: push to the connected branch or `vercel --prod` from `apps/web` (static, no build step).
- New in this work: security headers in `apps/web/vercel.json` (CSP enforced). After deploy, open the site,
  check the browser console for CSP violations, play the hero video, open the waitlist and submit a test
  sign-up (VERCEL_CONFIGURATION.md has the checklist).
- If the waitlist endpoint changes host, add it to `connect-src` first.
- Rollback: Vercel dashboard → Deployments → previous → Promote to Production (instant).
- Don't change custom domains without approval.

## Admin (`apps/admin`, Vercel) — not deployed today

- Build: `npm run admin:build` (Vite) → `apps/admin/dist`; `apps/admin/vercel.json` adds noindex and a
  strict CSP. Add `VITE_*` variables in the Vercel project for the environment (public values only).
- Must not hold real personal data until a backend enforces permissions, MFA and audit.
- Rollback: as the website.

## Mobile apps

- Environment comes from `EXPO_PUBLIC_*` (ENVIRONMENT_CONFIGURATION.md). Restart Expo with `-c` after
  changes; EAS builds read the build profile's env.
- Production builds must have `EXPO_PUBLIC_ENV=production`, https/wss URLs and mocks off; wire
  `assertMocksAllowed` into `ServicesProvider` before the first production build (audit R6).

## Cloudflare Workers (pending credentials)

Templates (placeholders only): `infra/cloudflare/src/workers/api-gateway/wrangler.api-gateway.toml`,
`infra/cloudflare/r2/wrangler.upload-signer.toml`, `infra/cloudflare/r2/wrangler.media-gateway.toml`.

```bash
# once per environment — values come from the secret manager, never from git
npx wrangler secret put ORIGIN_AUTH_SECRET        -c <api-gateway toml>   --env staging
npx wrangler secret put GATEWAY_ASSERTION_SECRET  -c <upload-signer toml> --env staging
npx wrangler secret put R2_ACCOUNT_ID             -c <upload-signer toml> --env staging
npx wrangler secret put R2_ACCESS_KEY_ID          -c <upload-signer toml> --env staging
npx wrangler secret put R2_SECRET_ACCESS_KEY      -c <upload-signer toml> --env staging

npx wrangler deploy -c <toml> --env staging       # then run the staging checks
npx wrangler deploy -c <toml> --env production    # only with approval
npx wrangler rollback -c <toml> --env production  # previous version
```

The API gateway is deployed only once a backend origin exists (otherwise every route answers
`503 backend_not_configured`, which is honest but useless). Its `ORIGINS_JSON` holds origin endpoints and is
never shown to clients.

## R2 buckets (pending credentials)

From `infra/cloudflare/r2/buckets.json`, `cors.*.json`, `lifecycle.proposed.json`:

```bash
npx wrangler r2 bucket create gobye-staging-private-uploads
npx wrangler r2 bucket create gobye-staging-private-documents
npx wrangler r2 bucket create gobye-staging-private-evidence
npx wrangler r2 bucket create gobye-staging-public-media
npx wrangler r2 bucket cors set gobye-staging-private-uploads --file infra/cloudflare/r2/cors.staging.json
```

Check the `wrangler r2` sub-command syntax against the installed Wrangler version before running.
Never enable public access or `r2.dev` on a private bucket. Lifecycle cleanup rules: staging only until
approved; no retention deletes on documents or evidence. Create a bucket-scoped API token per environment
(Object Read & Write on that environment's buckets only) for the signer's presigning keys.

## DNS (approval required)

Proposed records: `infra/cloudflare/dns/records.proposed.json`, plan `dns/plan.md`. Vercel hostnames stay
**DNS only** (no Cloudflare proxy). Apply one record at a time, verify TLS and the Vercel domain check, keep the
previous values to revert.

## Load balancing (paid, future)

Only after two real origins exist and the account plan is checked: `infra/cloudflare/load-balancer/*`
(templates marked "do not apply"). Follow LOAD_BALANCING_FAILOVER.md.

## Demo relay is separate

`npm run demo:relay` (D-049) is for demos on test data. It writes `.env.local` files for development; never
deploy a build pointing at it. Production config refuses a demo relay URL.

## After every deploy

Run the matching section of INFRASTRUCTURE_TEST_PLAN.md (staging checks), watch error rates for 30 minutes,
record the deploy in LOG.md.
