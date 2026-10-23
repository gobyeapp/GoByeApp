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
| Plans | Free (0.5 vCPU, 512 MB, 2 projects, 1 node, no backups), Ignite (1 vCPU, 1.5 GB, 3 nodes, 7-day backups), Pro (1.5 vCPU, 2 GB, 10 nodes, 30-day backups), Enterprise (4 vCPU, 8 GB, "SLA"). Naira or dollar billing. Re-read 2026-10-23: the page text still shows no price. | **Prices** (not shown on the public page). **Regions / data-centre locations.** **Bandwidth limits.** **Uptime SLA** below Enterprise. |

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
   - If StackShift can't do that, use the image path instead: GitHub Actions builds and pushes to GHCR, and StackShift deploys by digest. `.github/workflows/ci.yml` already builds and smoke-tests the image; a push-to-GHCR step needs approval and a `packages: write` permission, so it is not there yet.
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

## 6. Phase 1.5: what is verified, and what only the real host can show (2026-10-23)

**No StackShift account was available, so nothing was deployed.** Everything below was checked on the actual API image, built from `apps/api/Dockerfile`, with Docker locally. The real base image (Docker Hub) is blocked from this workspace. A stand-in base with the same Node 22 major was used. CI builds the real, digest-pinned base (`.github/workflows/ci.yml`, job `docker`).

| Brief item | Verified locally (stand-in base) | Still to verify on StackShift |
|---|---|---|
| CPU and memory | 0.5 CPU / 512 MB cap: ≈ 50 MB idle, ≈ 61 MB under 1,200 requests/s, no OOM (`STAGING_COST_ESTIMATE.md` §3) | Real traffic with sign-in and TLS (R3); the plan's actual CPU share |
| Environment variables | Invalid config exits **78** and names the variables without printing values; `check-runtime` prints no secrets | Encrypted variables reach the container; redeploy on change (D4); nothing in build logs |
| Docker compatibility | Multi-stage build; non-root user `node`; no TypeScript sources in the image; Docker `HEALTHCHECK` turns healthy | Dockerfile outside the repo root with a root context (D1); or deploy by digest |
| Health routing | `/health/live` 200; `/health/ready` 200 with the database and 503 without it; `health-check.mjs` passes from inside the image | Which path the platform probes; that `/health/ready` gates traffic |
| Worker behaviour | Worker in-process (`WORKER_ENABLED=true`) and as its own process; both stop cleanly on SIGTERM (exit 0) | A "worker" service type with no ingress; job lease recovery across a redeploy (D5) |
| Logging | JSON lines (pino) per request with request id, version and environment; no bodies; Nest start-up lines are JSON in staging and production | Retention, search and export on the platform (not published) |
| Restarts | SIGTERM: the API stops the worker, closes the server (which lets in-flight requests finish) and the pool, then exits 0 in under 1 s. Stopping **under load** was not tested here (D5). | Restart on a hung process via the health check (R2); restart policy |
| Connectivity to Supabase | Through PgBouncer in transaction mode, role timeouts apply (C-1 tests). TLS settings come only from `DATABASE_SSL` / `DATABASE_CA_CERT`. | Egress from the platform's region to the Supabase pooler; latency (N2); `check-runtime` OK |
| Database exposure | The API never listens for database traffic. Supabase is reached outbound over TLS only. StackShift's managed databases are **not** used. | Whether the host offers fixed egress addresses for Supabase network restrictions |
| Limits and pricing | — | **Prices are not published.** Bandwidth, regions and SLA below Enterprise are unknown. Needs a written quote (Q-075). |

**Smallest fit for staging:** one Free-plan service running the API with the worker in-process. That is enough for staging at the measured footprint. Production still needs two API instances and a separate worker (§2).
