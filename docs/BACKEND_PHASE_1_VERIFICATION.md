# Backend Phase 1: verification and readiness audit

**Date:** 2026-10-23 (afternoon, Lagos).
**Commit audited:** `170efda` (GitHub `main`, working tree identical).
**Method:** every result below was produced again for this audit. The repository was freshly cloned from GitHub into a clean folder, with a clean `npm ci` of the API workspace. Nothing was taken from earlier reports.
**Nothing was deployed and no paid service was activated.**

## Classification key

| Label | Meaning |
|---|---|
| **Implemented and tested** | Code exists, and automated or manual checks ran in this audit with the results shown |
| **Implemented but untested** | Code or config exists, but nothing exercised it here |
| **Partially implemented** | Some of the item exists. The missing part is named. |
| **Not implemented** | Absent |
| **Blocked** | Cannot be completed or proven without credentials or infrastructure the owner must provide |

## Environment of this audit

| Item | Version or state |
|---|---|
| Node | v22.22.0 |
| PostgreSQL | 16.15 (local cluster). Supabase runs 15/17; no Supabase project was used. |
| Docker | Engine 29.9.1 runs, but Docker Hub refuses this workspace: `HEAD …/library/node/manifests/22.22.0-bookworm-slim: Forbidden` |
| Network | Supabase, StackShift and Cloudflare accounts are not available to this workspace |

## 1. The 15 items

| # | Item | Classification | Evidence |
|---|---|---|---|
| 1 | NestJS backend exists and starts | **Implemented and tested** | See §1.1 |
| 2 | Folder structure clean and maintainable | **Implemented and tested**, with one gap | See §1.2 |
| 3 | PostgreSQL connection implemented and tested | **Implemented and tested** locally. **Blocked** for Supabase. | See §1.3 |
| 4 | Supabase authentication | Token verification and permissions **implemented and tested with locally generated keys**. Integration with a real Supabase project: **Blocked**. Sign-up and sign-in endpoints and app wiring: **Not implemented** (Phase 2). | See §1.4 |
| 5 | API routes versioned and documented | **Implemented and tested** | See §1.5 |
| 6 | Environment variables properly managed | **Implemented and tested** | See §1.6 |
| 7 | Migrations exist and run safely | **Implemented and tested** on PostgreSQL 16. **Blocked** for Supabase roles and RLS. | See §1.7 |
| 8 | Role-based permission enforcement | Staff RBAC **implemented and tested**. Rider/driver role rules **partially implemented**. | See §1.8 |
| 9 | Health endpoints respond correctly | **Implemented and tested** | See §1.9 |
| 10 | Cloudflare R2 storage interfaces prepared | **Partially implemented**; live bucket **Blocked** | See §1.10 |
| 11 | Payment interfaces defined without a hardcoded provider | **Implemented and tested** (interface and refusal). Real adapter **Not implemented** (deliberate). | See §1.11 |
| 12 | Automation and background jobs documented | **Implemented and tested** (queue); financial workflows **Not implemented** (deliberate) | See §1.12 |
| 13 | StackShift deployment configuration | **Partially implemented**: image build and deploy **Blocked** | See §1.13 |
| 14 | Backend unit and integration tests run | **Implemented and tested**: 72/72 with PostgreSQL | See §1.14 |
| 15 | Existing Expo apps and admin still work | **Implemented and tested** (no regression) | See §1.15 |

### 1.1 NestJS backend exists and starts

**Code:** `apps/api/src/main.ts`, `app.factory.ts` and `app.module.ts`. NestJS 12.2.0 on Fastify 5.12.7 (`apps/api/package.json`).

**Fresh clone:**
- `npm ci --workspace apps/api` completed in 3.8 s.
- `npm run typecheck -w apps/api` exited with 0 errors.
- `npm run build -w apps/api` produced `dist/apps/api/src/{main,worker,migrate}.js`.

**Started against a fresh database:** `node dist/apps/api/src/main.js` with `APP_ENV=development`, `PORT=8095`.

| Request | Result |
|---|---|
| `GET /health/live` | `200 {"status":"ok","version":"verify-170efda"}` |
| `GET /health/ready` | `200 {"status":"degraded",…}` (degraded only because no Supabase URL is configured, so the `auth_keys` check fails) |
| `GET /v1/me` | `401 unauthenticated`, with `requestId` |
| `GET /v2/me` | `400 unsupported_api_version` |
| `GET /v1/unknown` | `404 not_found` |
| `POST /v1/costs/expenses` with invalid JSON | `422 validation_failed` |

**In-process worker:** ran the scheduled job (`ops.jobs`: `ops.idempotency_cleanup | succeeded | 1`).

**Graceful stop:** `SIGTERM` stopped the process and logged `"msg":"Shutting down"`.

**Unsafe configuration refused:** `APP_ENV=production PAYMENTS_PROVIDER=simulated` printed six problems by variable name (no values) and exited with code 78.

### 1.2 Folder structure

The layout is documented in `docs/BACKEND_ARCHITECTURE.md` §3 and matches the tree:
- `apps/api/src`: `auth`, `common`, `config`, `costs`, `database`, `health`, `jobs`, `me`, `providers`, `subscriptions`;
- `apps/api/migrations`, `apps/api/test`, `apps/api/env`, `apps/api/scripts`, `apps/api/ci`.

Code size and hygiene:
- 2,094 lines of source, the largest file 164 lines (`config/config.ts`).
- 1,134 lines of tests.
- No build output is tracked (`git ls-files` finds nothing under `apps/api/dist*`).

Business rules are imported from `@gobye/core` (no duplicate implementations). `apps/api/src` contains no provider names (Paystack, Flutterwave and others: 0 matches).

**Gap:** no linter is configured for `apps/api` (nor for `apps/admin`, `packages/core` or `infra`). TypeScript `strict` is the only static check. See C-2.

### 1.3 PostgreSQL connection

**Code:**
- `apps/api/src/database/database.ts`: pool, TLS modes, transactions with `SET LOCAL statement_timeout` and `lock_timeout`, a 2-second readiness ping, Postgres error mapping in `common/exception.filter.ts`.
- `database/idempotency.ts`.

**Tested:**
- Every database test creates and drops its own database (`apps/api/test/helpers.ts`).
- 44 of the 72 tests use it, covering transactions, row locks (`FOR UPDATE`, `SKIP LOCKED`), unique constraints, concurrent requests (ten concurrent duplicate POSTs → one row) and repeatable-read snapshots.
- TLS: `test/config.test.ts` "TLS settings in the database URL cannot override DATABASE_SSL" passes.

**Not proven:** a connection to Supabase (pooler or direct) with `verify-full` and the Supabase CA. That is **blocked** until a project exists. Correction **C-1** concerns the pooler.

### 1.4 Supabase authentication

**Implemented and tested** (`apps/api/src/auth/jwt.ts`, `principal.ts`, `guards.ts`; `test/auth.test.ts`, 8 tests):
- JWKS verification (ES256/RS256) with issuer, audience, expiry and a UUID `sub`;
- `role = authenticated` required; `service_role`, `anon`, anonymous users, `alg: none`, foreign keys and tampered payloads all refused;
- HS256 only when explicitly enabled (refused by config in staging and production);
- principals read from the database (token metadata ignored);
- staff MFA (`aal2`) and suspension.

**What "tested" means here:** tests sign tokens with an ES256 key generated in the test, and serve it through a local JWKS. The real Supabase JWKS endpoint, real tokens, key rotation and the claim shapes of the deployed project have **not** been exercised: **Blocked** (no Supabase staging project). Steps: `docs/AUTHENTICATION_PLAN.md` §4–5.

**Not implemented:**
- sign-up completion (`POST /v1/me/profile`);
- account deletion;
- the apps' Supabase client;
- admin staff sign-in through Supabase.

These are Phase 2 (§4).

### 1.5 Versioning and documentation

Routes registered by the running app (`fastify.printRoutes()`):

```
/health/live (GET)          /health/ready (GET)          /v1/ops/health (GET)
/v1/me (GET)                /v1/drivers/:driverId/subscription (GET)
/v1/costs/expenses (POST, GET)                          /v1/costs/break-even (GET)
```

- **Documentation:** exactly these seven are in `docs/API_CONTRACTS.md` §10, with auth, request, response and errors.
- **Versioning:** URI `/v1` (`app.enableVersioning`). Unknown versions give 400 (tested in `test/http.test.ts` and live in §1.1). Health is deliberately unversioned (gateway contract, `packages/core/src/infra/health.ts`).
- **Gateway:** `infra/cloudflare/src/workers/api-gateway/routes.ts` routes `me`, `costs` and `ops` (`test/gateway-routing.test.ts`, infra 41/41).

### 1.6 Environment variables

- **Validation:** `apps/api/src/config/config.ts` (zod) lists every problem at once by name, exits with code 78, and refuses unsafe staging and production settings. 10 tests in `test/config.test.ts`, all passing.
- **Templates:**
  - `apps/api/env/{development,staging,production}.env.example` contain no values.
  - A test proves each template loads once its blanks are filled.
  - `node tools/check-env.mjs` passes all three, plus the existing app and admin templates.
- **Nothing secret committed:**
  - `git ls-files` shows only `.env.example` files.
  - `apps/api/.gitignore` ignores `.env` and `env/*.env`.
  - A pattern scan of tracked files found one token, the website's Supabase key. Decoded, its role is `anon` (by design; risk R-6).
- **Loading:**
  - Locally: `node --env-file-if-exists=.env` (`apps/api/package.json` scripts).
  - In containers: the host's variables. Nothing is baked into the image (`Dockerfile`, `.dockerignore` allowlist).

Full reference: `docs/ENVIRONMENT_CONFIGURATION.md` §Server and §3 below.

### 1.7 Migrations

**Files:**
- `apps/api/migrations/0001_foundation.sql` … `0005_costs_config_files.sql`;
- runner: `src/database/migrations.ts`;
- CLI: `src/migrate.ts`;
- workflow: `docs/DATABASE_MIGRATIONS.md`.

**Live run on a fresh database:**
- `status` → 5 pending;
- `up` → applied 5;
- `up` again → applied 0, 5 already applied;
- `status` → pending none, exit 0.

**Tests** (`test/database.test.ts`, 11 tests): fresh migrate and idempotent re-run, an edited file refused, a failing file fully rolled back, a concurrent migrator refused (advisory lock), and a multi-statement no-transaction file refused. Also:
- append-only triggers;
- one active ride per driver;
- no self-approval;
- NGN only;
- no grants to client roles;
- RLS on every table;
- `/health/ready` 503 while the schema is behind.

**Role SQL** (`docs/DATABASE_MIGRATIONS.md` §Roles) was checked on plain PostgreSQL 16 on the same day (LOG). **Blocked** on Supabase:
- whether `postgres` may grant `bypassrls`;
- whether the session pooler accepts the advisory lock;
- the Supabase CA.

### 1.8 Role-based permissions

**Staff:**
- `PermissionGuard` with `@RequirePermission`;
- permissions from `packages/core/src/platform/permissions.ts`;
- MFA (`aal2`) required;
- city scope (`assertCityScope`);
- suspended staff refused.

Tested in `test/auth.test.ts` (finance has `costs.manage` but not `logs.view`; developer has `logs.view`; no MFA → `MFA_REQUIRED`), `test/costs.test.ts` (care staff refused; non-staff refused) and `test/subscriptions.test.ts` (Abuja-only staff refused a Lagos driver).

**Riders and drivers: partially implemented.**
- The principal carries `isRider`, `isDriver`, driver city and verification status.
- One ownership rule exists: a driver may read only their own pass timeline; others get 404.
- There is **no** route-level rider or driver guard yet (e.g. `@RequireRole('driver')`, "approved driver only"), because no rider or driver write routes exist. Phase 2 adds them (§4).

**Not implemented:** second-person approvals on the server (`packages/core/src/platform/approvals.ts` exists for the admin only). They are needed before any staff write beyond expense records.

### 1.9 Health endpoints

| Endpoint | Behaviour | Tests |
|---|---|---|
| `/health/live` | 200, no dependencies, exempt from the gateway signature | `test/http.test.ts` |
| `/health/ready` | 200 `ok` or `degraded`; 503 + `Retry-After: 5` when the database is down or the schema is behind; status and version only | `http.test.ts`, `database.test.ts` |
| `/v1/ops/health` | Staff `logs.view` + MFA; per-check detail and timings | `auth.test.ts` |

The deploy check script (`apps/api/scripts/health-check.mjs`) passed **11/11** against the live server. In strict mode it **failed** on `degraded`, which is correct: a real readiness pass needs Supabase. `test/deploy-check.test.ts` (3 tests) passes.

### 1.10 Cloudflare R2

**Prepared:**
- the `ObjectStore` interface (`packages/core/src/files/service.ts`);
- `r2Storage()` in `apps/api/src/providers/providers.ts`, with presigned PUT (signed content type, length and SHA-256) and presigned GET (`private, no-store`);
- the same SigV4 code as the edge Worker (`infra/cloudflare/src/r2/sigv4.ts`, checked against the AWS test vector in the infra tests);
- config validation of the `R2_*` variables;
- the `ops.files` metadata table.

Tested in `test/providers.test.ts` (URL host, expiry, signed headers, checksum encoding, bucket-name validation).

**Not in the API by design:** head, read, copy and delete fail closed with `NOT_CONFIGURED`. The upload signer Worker owns them.

**Not implemented:** the files API (`/v1/files/*`) and the malware scanner (Q-067).

**Blocked:** no bucket or credentials. Nothing has been uploaded to or signed against a real R2 bucket.

### 1.11 Payments

**Interface:** `PaymentGatewayAdapter` (`packages/core/src/gateway/adapter.ts`, D-054), re-exported in `apps/api/src/providers/ports.ts`.

**Configuration:**
- `PAYMENTS_PROVIDER` is `none` (default) or `simulated`.
- Production refuses `simulated` (config test, and the live refusal in §1.1).
- `apps/api/src` names no provider.
- No credentials variables exist yet, so none can be hardcoded.

Tested in `test/providers.test.ts` (default `null`; the simulated adapter reports `simulated: true` and has every required capability).

**Not implemented, on purpose:** a real adapter, webhook endpoint, wallet, ledger and payouts (owner restriction; `docs/BACKEND_ARCHITECTURE.md` §9).

### 1.12 Automation and background jobs

**Documented:** `docs/BACKEND_ARCHITECTURE.md` §10, D-060.

**Implemented:** `apps/api/src/jobs/queue.ts` and `worker.ts`, plus the `ops.jobs` and `ops.job_schedules` tables. Tested in `test/jobs.test.ts` (10 tests):
- enqueue de-duplication;
- no double claims across four workers;
- retry with backoff, then `failed`;
- permanent failure;
- unknown kinds wait for a newer worker;
- lease recovery;
- the poison-job cap;
- timeout with abort and no overlapping retry;
- exactly one job per schedule slot under eight concurrent ticks;
- cleanup.

It also ran live in §1.1.

**Not connected (on purpose):** the 14 Automation Centre workflows (`packages/core/src/automation`). Only `ops.idempotency_cleanup` and `ops.noop` are registered.

### 1.13 StackShift deployment

**Exists:**
- `apps/api/Dockerfile`: multi-stage, `node` user, `HEALTHCHECK`, `APP_VERSION`. Base tag `node:22.22.0-bookworm-slim` confirmed on Docker Hub (active; amd64 and arm64).
- The root `.dockerignore` allowlist.
- `apps/api/env/staging.env.example` and `production.env.example`.
- `docs/DEPLOYMENT_STACKSHIFT.md`: service layout, release order and 13 acceptance tests.
- `apps/api/docker-compose.yml` (local only).
- `apps/api/ci/github-actions-api.yml` (template).

**Not proven:**
- `docker build` fails here because Docker Hub returns 403 to this workspace. The stages were rehearsed by hand on 2026-10-23 (LOG) and the runtime layout passed the deploy checks, but **the image itself has never been built**.
- No StackShift project, service, variables or domain exist.
- StackShift publishes no prices, regions, bandwidth limits or uptime commitment below Enterprise (Q-075).
- Whether StackShift can build `apps/api/Dockerfile` with the repository root as context is unknown.
- `docker-compose.yml` was not run.
- The CI template is not active (it sits outside `.github/workflows`).

### 1.14 Backend tests

**Fresh clone, `npm test -w apps/api`:** exit 0. **72 tests, 8 suites, 72 passed, 0 failed, 0 skipped** (9.2 s).

| Suite | Tests |
|---|---|
| config | 10 |
| HTTP conventions and gateway signature | 11 |
| authentication and permissions | 8 |
| migrations and schema | 11 |
| driver pass timeline | 8 |
| operating costs and break-even | 6 |
| durable jobs | 10 |
| providers | 5 |
| deploy check script | 3 |

**Without PostgreSQL** (`TEST_DATABASE_ADMIN_URL` unreachable): 72 tests, **28 pass, 44 skipped**, each with the reason printed. A green run on a machine without Postgres therefore proves little (also noted in `CLAUDE.md`).

**What kind of tests these are:**
- **Mostly integration:** the real Nest app via Fastify `inject`, plus a real PostgreSQL.
- **True unit tests:** config, providers and the signature functions.
- **One end-to-end test:** the deploy check script against a listening server.

**Not covered:** load tests, Supabase-hosted behaviour, the Docker image, StackShift.

### 1.15 Existing apps and admin

Run on the working tree (identical to `170efda`):

| Check | Result |
|---|---|
| `npm run typecheck` (all workspaces) | exit 0, 0 `error TS` |
| core (Jest) | **265/265** |
| rider (Jest) | **36/36** |
| driver (Jest) | **14/14** |
| admin (Vitest) | **405/405** |
| infra/cloudflare (Vitest) | **41/41** |
| `npx expo export --platform android --platform ios` in `apps/rider` | exit 0, `android` and `ios` bundles |
| the same in `apps/driver` | exit 0, `android` and `ios` bundles |
| `npm run build` in `apps/admin` | exit 0 (`✓ built`) |
| The admin's Vercel install command in a clean clone (`installCommand` from `apps/admin/vercel.json`) | exit 0, 229 packages; build passes |

**Unchanged by Phase 1:** the apps and admin still run on simulated services (mocks), as before. Phase 1 did not wire them to the API.

**Not checked:** physical devices.

## 2. Next-phase readiness

### 2.1 Complete

The API foundation (items 1, 2, 3 locally, 5, 6, 7 locally, 9, 11, 12, 14) and the no-regression check (15).

### 2.2 Incomplete

- Supabase integration (4)
- Rider and driver role rules (8)
- Files API and real R2 (10)
- Image build, StackShift deployment and CI (13)
- Server-side approvals
- Every product endpoint (sign-up, onboarding, rides, pricing, payments, realtime)

### 2.3 Needs correction

| # | Priority | Problem | Correction |
|---|---|---|---|
| **C-1** | **Before staging** | `poolConfig` sends `statement_timeout` as a connection start-up parameter (`apps/api/src/database/database.ts`). Supabase documents role-level timeouts. Its docs say session-level settings don't work through Supavisor transaction mode (port 6543), and say nothing about start-up parameters. PgBouncer is known to reject exactly this parameter ("unsupported startup parameter: statement_timeout"). If Supavisor does the same, **every pooled connection would fail**. | Remove the start-up parameter (or make it opt-in for direct connections). Rely on `alter role gobye_api set statement_timeout` (already in `DATABASE_MIGRATIONS.md`) plus the existing `SET LOCAL` in transactions. Test against the staging pooler. |
| C-2 | Before Phase 2 grows the code | No linter for the API, admin, core or infra | Add ESLint with typescript-eslint (recommended plus a few safety rules) and a `lint` script; run it in CI |
| C-3 | Before staging | The CI workflow isn't active, so nothing builds the image | Move `apps/api/ci/github-actions-api.yml` to `.github/workflows/api.yml` (needs a token with the workflow permission, or the owner adds it in the GitHub web UI). This also produces the first real image build. |
| C-4 | With C-3 | Base image pinned by tag, not digest | Pin `node:22.22.0-bookworm-slim@sha256:<index digest>` from the first CI build |
| C-5 | Phase 2 | No route-level rider or driver guards; no server-side two-person approvals | `@RequireRole()` / `@RequireApprovedDriver()` guards; approvals table and endpoints before staff write actions |
| C-6 | Owner, now | Credentials shared in chat are still not rotated. The deploy token used for every push this week is one of them. | Rotate the GitHub PAT, the Supabase service-role key and the Cloudflare token (risk R-1) |
| C-7 | Low | `docker-compose.yml` never run | Run it once on a machine with Docker Hub access |

### 2.4 Required environment variables

From `apps/api/env/*.env.example` and `docs/ENVIRONMENT_CONFIGURATION.md` §Server. ★ marks a secret, which goes in the host's secret store and never in git.

| Variable | Development | Staging | Production |
|---|---|---|---|
| `APP_ENV` | `development` | `staging` | `production` |
| `APP_VERSION` | `dev` | git SHA (set by deploy) | git SHA |
| `DATABASE_URL` ★ | local Postgres | Supabase **pooler** URL, `gobye_api` role | same, production project |
| `DATABASE_MIGRATION_URL` ★ | optional | **required**; direct or session (port 5432), `gobye_migrator` | required |
| `DATABASE_SSL` / `DATABASE_CA_CERT` | `disable` | `verify-full` + Supabase root CA | same |
| `SUPABASE_URL` | dev project (optional) | staging project | production project |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` | `authenticated` | `authenticated` |
| `STAFF_REQUIRE_MFA` | `false` allowed | `true` (enforced) | `true` (enforced) |
| `ORIGIN_AUTH_REQUIRED` / `ORIGIN_AUTH_SECRET` ★ | `false` / empty | `true` / 32+ characters, equal to the staging gateway's secret | same, production gateway |
| `CORS_ORIGINS` | `http://localhost:5173` | `https://admin-staging.gobye.app` | `https://admin.gobye.app` |
| `TRUST_PROXY_HOPS` | 0 | 2 | 2 |
| `PAYMENTS_PROVIDER` / `MAPS_PROVIDER` / `NOTIFICATIONS_PROVIDER` / `STORAGE_PROVIDER` | simulated / fake / log / memory | simulated / fake / log / `none` (or `r2`) | `none` until real adapters exist |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` ★, `R2_SECRET_ACCESS_KEY` ★, `R2_BUCKET_PREFIX` | — | when `STORAGE_PROVIDER=r2` | same |
| `WORKER_ENABLED`, `WORKER_POLL_MS`, `WORKER_CONCURRENCY` | in-process | `false` in the API; separate worker service | same |

Not needed by the API: the Supabase service-role key, and any payment secret (none exists yet).

### 2.5 Required Supabase configuration (owner, staging first)

1. **Projects:** create **new** staging and production projects in the chosen region (Q-076). Do **not** reuse `morqitxqsfiprefczduo`: it holds the website waitlist and the demo tables, whose RLS lets the `anon` key write.
2. **Plan:** Pro organisation (daily backups; no pause). Decide on point-in-time recovery for production.
3. **Signing keys:** Settings → JWT signing keys. Create an asymmetric key (ECC P-256), make it current, and revoke the legacy secret.
4. **Roles:** create `gobye_migrator` and `gobye_api` with the role-level timeouts (`DATABASE_MIGRATIONS.md` §Roles). Check `bypassrls` is allowed; otherwise use the policy fallback.
5. **CA certificate:** download the root certificate into `DATABASE_CA_CERT`.
6. **Connection strings:** collect the pooler URL (6543) for `DATABASE_URL` and the direct or session URL (5432) for `DATABASE_MIGRATION_URL`.
7. **Auth providers (Phase 2 needs them):** email + password, phone (SMS provider or Send SMS hook, decision A-4), Apple, Google, TOTP MFA for staff. Set the access-token lifetime (A-6) and redirect URLs for the apps' deep links.

### 2.6 Required StackShift configuration (owner, staging only)

1. **Account and plan:** an account on a plan that allows two services. Get a **written** quote with region, bandwidth limits and uptime commitment (Q-075).
2. **Build:** a project from GitHub with Dockerfile `apps/api/Dockerfile` and the repo-root build context. If unsupported, deploy by image digest from GHCR via CI.
3. **Services:**
   - `gobye-api-staging` (public, port 8080, health path `/health/live`);
   - `gobye-worker-staging` (worker type, command `node apps/api/dist/apps/api/src/worker.js`);
   - a release step running `migrate.js up`.
4. **Variables:** the staging variables from §2.4, set as encrypted project variables.
5. **Verify:** run `docs/DEPLOYMENT_STACKSHIFT.md` §4 tests D1–D5, N1–N2, B1, R1–R3, S1–S2. Production waits for all of them.

### 2.7 Security risks

| # | Risk | Severity | Mitigation / status |
|---|---|---|---|
| R-1 | GitHub PAT, Supabase service-role key and Cloudflare token exposed in chat; the PAT is still in use | **High** | Rotate now (C-6) |
| R-2 | C-1 could stop all database connections on the pooler | High (availability) | Fix before staging |
| R-3 | Signature replay across instances: the replay cache is per instance, so a captured header could be used once on each other instance within 60 s. It still needs a valid user token and the same method and path. | Low | Accept for now. A shared cache (database table) is possible if there are many instances. |
| R-4 | Tokens remain valid until they expire after sign-out (stateless JWT) | Medium | Short access-token lifetime (A-6). Suspension takes effect immediately, because principals are read from the database on every request. |
| R-5 | Phone OTP cost abuse (SMS pumping) once sign-up opens | Medium | Phase 2: Nigerian numbers only, CAPTCHA (Turnstile) on web, Supabase rate limits plus gateway limits, alerts on SMS spend |
| R-6 | The website's Supabase project lets `anon` write to the demo tables | Medium | Keep the backend in separate projects (§2.5). Remove the demo tables before launch (D-049). |
| R-7 | No malware scanner, so uploaded documents can't be approved | Medium (blocks onboarding) | Q-067 decision. Fail closed until then. |
| R-8 | Image never built; dependencies not scanned | Medium | C-3/C-4. Add `npm audit` or similar to CI. |
| R-9 | No linter | Low | C-2 |

### 2.8 Expected infrastructure costs

Unchanged since the morning research (`docs/INFRASTRUCTURE_COSTS.md`, list prices and sources there). The known items add up to about $65 a month, before StackShift and SMS:

| Item | Monthly |
|---|---|
| Supabase Pro organisation | $25 |
| Supabase compute (production Small $15 + staging Micro $10, less the $10 credit) | $15 |
| Vercel Pro, one seat | $20 |
| Cloudflare Workers Paid | $5 |
| R2 (under 10 GB) | $0 |

**New in this audit:** if every rider and driver sign-in must end with a phone code through Supabase's **phone MFA** (D-045 as written), the add-on costs **$75/month for the first project and $10/month per additional project** on paid plans, plus SMS per message ([Supabase phone MFA](https://supabase.com/docs/guides/auth/auth-mfa/phone)). See decision A-3.

**Unknown:** StackShift (no public prices), SMS per message (provider not chosen).

**Spent so far: ₦0.**

### 2.9 Decisions requiring approval

| # | Decision | Recommendation |
|---|---|---|
| A-1 | Accept D-059–D-061 as built: Fastify; hand-written SQL migrations; schemas `app` and `ops`; Postgres job queue, no Redis; `/v1/rides`; `422` for validation; lower-case generic and upper-case domain error codes | Approve |
| A-2 | New Supabase projects for staging and production (not the waitlist project), region per Q-076 | Approve; choose the region |
| A-3 | How "every sign-in ends with a phone code" (D-045/D-048) is delivered: (a) Supabase phone MFA (+$75/month, every sign-in); (b) phone verified once at sign-up and again only on a new device (custom, no add-on); (c) phone OTP as the sign-in method itself | **(b)**: keeps the safety reason (a reachable verified number) without an SMS on every sign-in |
| A-4 | SMS route for OTP: a provider built into Supabase, or the Send SMS hook to a Nigerian gateway | Compare delivery to Nigerian networks and price per message. Hook if a local gateway wins. |
| A-5 | Driver documents before a scanner exists (Q-067): wait, or allow staff review of unscanned files in a restricted viewer | Wait (fail closed). Choose the scanner in Phase 2. |
| A-6 | Access-token lifetime | 15 minutes, with refresh-token reuse detection |
| A-7 | Paid items before staging: Supabase Pro, StackShift plan; before launch: Vercel Pro, Workers Paid | Approve when staging starts |
| A-8 | Who approves production deploys and migrations, and who is on call (Q-072) | Name them |

## 3. Next step

Phase 2 is planned in **`docs/BACKEND_PHASE_2_PLAN.md`** (real Rider and Driver authentication and onboarding). Not started.

Before Phase 2 code:
1. C-1 and C-6.
2. Decisions A-2, A-3, A-4, A-6.
3. A Supabase staging project, which unblocks items 3, 4 and 7.
