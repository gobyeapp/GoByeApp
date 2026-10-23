# Deploying the API on StackShift (candidate) and the tests it must pass

**Status:**
- StackShift is the **initial hosting candidate**, not a production decision.
- Nothing is deployed.
- **Production stays off StackShift until every test in §4 passes** and the owner approves (Q-072, Q-075).

## 1. What we know about StackShift (from its public pages, 2026-10-23)

| Topic | What the documentation says | Still unknown (must be answered by testing or by StackShift) |
|---|---|---|
| Deploy from GitHub | Builds with "Shiftpack", or the repo's own Dockerfile "if you point StackShift at it". Redeploys on push or manually. | Whether a Dockerfile **outside the repo root** with a **root build context** is supported (we need `apps/api/Dockerfile`, context `.`). |
| Deploy an image | Supports immutable `…@sha256:<digest>` image URIs. | Which registries (GHCR?) and how private-registry credentials are stored. |
| Runtime | Resource presets: Standard 512 MB / 0.5 CPU, up to 8 GB / 4 CPU. Startup timeout 30–600 s. "Worker" services have no public ingress. | Which port is routed (we listen on `PORT`, default 8080). Health-check path and settings. Zero-downtime deploys. |
| Variables | Per environment, encrypted at rest. Saving triggers a redeploy. Build-time vs runtime-only keys. | Audit trail of who changed a variable. |
| Domains | Custom domains with "SSL activation". | Whether a Cloudflare-proxied hostname (our gateway → origin) works; origin certificate behaviour. |
| Databases | Managed databases, connection pooling on paid plans. | Not needed: we use Supabase. |
| Plans | Free (0.5 vCPU, 512 MB, no backups), Ignite, Pro, Enterprise ("SLA" mentioned on Enterprise only). Naira or dollar billing. | **Prices** (not shown on the public page). **Regions / data-centre locations.** **Bandwidth limits.** **Uptime SLA** below Enterprise. |

Sources: [stackshift.cloud](https://stackshift.cloud/), [pricing](https://stackshift.cloud/pricing), docs: [deploy from GitHub](https://docs.stackshift.cloud/projects/deploy-from-github.md), [deploy a Docker image](https://docs.stackshift.cloud/projects/deploy-a-docker-image.md), [environment, domains and previews](https://docs.stackshift.cloud/projects/environment-domains-and-previews.md).

## 2. Services to create (staging first)

| Service | Image / command | Ingress | Size to start | Variables |
|---|---|---|---|---|
| `gobye-api-staging` | `apps/api/Dockerfile` (default command) | Public HTTPS, called only by the Cloudflare gateway | Standard (0.5 CPU / 512 MB); measure, then size | `apps/api/env/staging.env.example` |
| `gobye-worker-staging` | Same image; command `node apps/api/dist/apps/api/src/worker.js` | None (worker) | Standard | Same variables |
| Release step | Same image; `node apps/api/dist/apps/api/src/migrate.js up` | None | One-off | `DATABASE_MIGRATION_URL` |

Then, in the staging gateway Worker:
- `ORIGINS_JSON` points at the StackShift URL;
- `ORIGIN_AUTH_SECRET` (wrangler secret) equals the API's variable.

## 3. Deploy steps (staging)

1. Owner: create the StackShift account and project; choose the plan that allows two services (worker + API).
2. Connect the GitHub repository; set the Dockerfile path to `apps/api/Dockerfile` and the build context to the repo root.
   - If StackShift can't do that, use the image path instead: GitHub Actions builds and pushes to GHCR, and StackShift deploys by digest. The CI template has the build step.
3. Set the variables from `staging.env.example` (secrets from the password manager). `APP_VERSION` = the commit SHA.
4. Run the release step (`migrate.js status`, then `up`) against the **staging** Supabase project.
5. Deploy the API and the worker. Set the platform health check to `GET /health/live` if configurable.
6. Run: `node apps/api/scripts/health-check.mjs https://<stackshift-url> --expect-version <sha>`. Expect a pass, **or 403 on `/v1/me`, because the gateway signature is required**.
7. Point the staging gateway at it. Run the health check again through `https://api-staging.gobye.app`.

## 4. Tests StackShift must pass before any production use (Q-075)

Record results in this table with the date, the plan and the region used.

| # | Test | How | Pass when |
|---|---|---|---|
| D1 | Deploy from this monorepo | §3 steps 2–5 | Image builds; health check passes; the release step works |
| D2 | Zero-downtime deploy | Run `autocannon -c 20 -d 120 <url>/health/live` during a redeploy | No 5xx or connection errors; versions switch cleanly |
| D3 | Rollback | Redeploy the previous image | Back within 5 min; health check passes with the old version |
| D4 | Secrets | Change `LOG_LEVEL`; confirm the redeploy and that values never show in build logs | No secret in any log |
| D5 | Graceful stop | Redeploy while a job runs and requests are in flight | No lost job (lease recovery) and no dropped request |
| N1 | Region and latency | `curl -w '%{time_connect} %{time_starttransfer}'` from Lagos (4G and fibre) to the origin and through the gateway | p50 TTFB ≤ 250 ms and p95 ≤ 600 ms through the gateway for `/health/live` |
| N2 | Database round trip | `GET /v1/ops/health` timings (staff) from the StackShift region to Supabase | `database` check p95 ≤ 50 ms (same or near region) |
| B1 | Bandwidth | Ask StackShift for limits, then 10 GB of mixed API responses over a day (scripted) | No throttling; cost matches the quote |
| R1 | Reliability | Run the health check every minute for 14 days (external monitor) | ≥ 99.9% success; every incident explained |
| R2 | Restart on hang | Block the event loop in staging (debug build) | Platform restarts it via `/health/live`; alert fires |
| R3 | Load | `autocannon` on `/v1/me` with valid tokens at 100 rps for 10 min (0.5 CPU) | p95 ≤ 300 ms, no errors, memory stable |
| S1 | Origin lockdown | Call the StackShift URL directly without the gateway signature | `403` on all `/v1` routes |
| S2 | TLS | `testssl.sh` on the StackShift hostname | TLS 1.2+ only; valid certificate |

If D1–D5, N1–N2, R1–R3 and S1–S2 pass and B1 has a written price, StackShift can be proposed for production. If not, the same image runs on any container host (the API has no StackShift-specific code).

## 5. Production readiness gates (not done)

- [ ] All §4 tests pass and are recorded
- [ ] The production Supabase project is in the chosen region (Q-076), on a paid plan (daily backups; PITR decided)
- [ ] Credentials rotated (`ENVIRONMENT_CONFIGURATION.md` incidents)
- [ ] Gateway signature required and S1 passing
- [ ] Alerting on the health check and error rate goes to a named person (Q-072)
- [ ] Owner approval for the first production deploy
