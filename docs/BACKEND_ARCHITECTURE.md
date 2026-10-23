# GoBye backend architecture: Phase 1 foundation (D-059)

**Status legend**

| Label | Meaning |
|---|---|
| **Built + tested** | The code exists and automated tests pass in this repository (Node 22, PostgreSQL 16). |
| **Built, not tested here** | The code or config exists, but it could not be exercised in the build workspace. |
| **Placeholder** | Fails closed with `NOT_CONFIGURED`, or is a fake for development. |
| **Future** | Designed only. |

Nothing here is deployed: no StackShift service, no Supabase backend schema, no DNS.

The audit that came before this work is in `BACKEND_AUDIT.md`.

## 1. Stack (owner decision, 2026-10-23)

| Layer | Choice | Notes |
|---|---|---|
| Rider and Driver apps | Expo + React Native | Unchanged. They keep their mocks until each HTTP service is ready. |
| Website and admin | Vercel | Unchanged. The admin gets real data once endpoints exist. |
| API | **NestJS 12 on Fastify 5**, TypeScript 6, Node 22 | `apps/api` |
| Hosting | **StackShift: initial candidate only** | Not production until the tests in `DEPLOYMENT_STACKSHIFT.md` pass. |
| Database | **Supabase PostgreSQL** | Schemas `app` and `ops`, not exposed to the Data API. |
| Auth | **Supabase Auth** | The API verifies tokens (JWKS) and decides permissions itself. |
| Files | **Cloudflare R2** | Existing Workers plus presigning in the API. |
| Edge | Cloudflare API gateway Worker (existing) | Signs requests to the API with `X-Gobye-Origin-Auth`. |
| Jobs | **PostgreSQL queue** (no Redis) | §10 |

Why Fastify under NestJS:
- **Speed:** higher throughput per instance.
- **Testing:** in-process request injection for tests.
- **Logging:** pino JSON logs built in.

Why not Prisma or TypeORM:
- The schema is hand-written SQL migrations (§7), so every constraint and lock is visible and reviewed.
- Queries use `pg` directly with parameters.
- An ORM can be added later behind the repositories if it earns its place.

## 2. Request path

```
App / admin ──HTTPS──▶ api.gobye.app (Cloudflare gateway Worker)
                         │ rate limits, request id, X-Gobye-Origin-Auth (HMAC, 60 s)
                         ▼
                   StackShift: gobye-api container (NestJS/Fastify, PORT 8080)
                         │ 1 OriginAuthGuard  2 AuthGuard (Supabase JWT → Principal from DB)
                         │ 3 PermissionGuard (core permissions)  4 handler (zod validation)
                         ▼
                   Supabase PostgreSQL (pooler for requests, direct for migrations)
                         ▲
                   gobye-worker container (same image): jobs + schedules
```

## 3. Repository layout

```
apps/api/
  Dockerfile                 multi-stage, non-root, healthcheck; build from repo root
  docker-compose.yml         local Postgres + API (development only)
  env/*.env.example          development, staging, production templates (no values)
  migrations/0001-0005_*.sql forward-only schema
  scripts/health-check.mjs   post-deploy check (no dependencies)
  src/
    main.ts  worker.ts  migrate.ts       three entry points, one image
    app.factory.ts app.module.ts         Fastify settings, logging, headers, versioning, guards
    config/config.ts                     environment validation
    common/                              errors, envelope, request ids, zod validation pipe, exception filter
    auth/                                JWT verification, principal, guards, decorators
    database/                            pool + transactions, migrations runner, idempotency
    jobs/                                Postgres queue, worker, schedules
    providers/                           payment, maps, notification, storage interfaces + implementations
    health/ me/ subscriptions/ costs/    Phase 1 endpoints
  test/*.test.ts                         node:test, compiled first (tests the shipped JavaScript)
```

`@gobye/core` (pure TypeScript) is compiled into the API (`tsconfig` path + `tsc-alias`). The server therefore runs the same functions as the apps:
- `buildTimeline` and `subscriptionTimelineResponse`;
- `permissionsOf`;
- `breakEven`;
- the error and health envelopes;
- the payment adapter contract;
- `ObjectStore`.

The R2 presigner is shared with the edge Worker the same way.

## 4. Configuration (Built + tested)

`src/config/config.ts` validates the environment once at start-up with zod.

- **All problems at once:** every problem is listed together, by variable name only (values never printed), and the process exits with code 78.
- **Staging and production refuse:**
  - unverified database TLS;
  - a missing gateway secret, or one shorter than 32 characters;
  - the legacy HS256 JWT secret;
  - debug logging.
- **Production also refuses:**
  - simulated payments, fake maps, the log-only notifier and in-memory storage;
  - staff without MFA.

Templates: `apps/api/env/{development,staging,production}.env.example`. A test proves each one loads, so the templates and the validator can't drift. Variable reference: `ENVIRONMENT_CONFIGURATION.md` §Server.

## 5. Authentication and permissions (Built + tested; integration with a real Supabase project: Future)

Details are in `AUTHENTICATION_PLAN.md`. In short:
- **Token checks:** Supabase access tokens are verified against the project's JWKS (ES256/RS256), cached for at most 10 minutes. The checks cover:
  - issuer and audience;
  - expiry;
  - a UUID `sub`;
  - `role` = `authenticated`.
- **Refused tokens:** anonymous, `service_role`, `alg: none`, and anything signed by a key outside the JWKS.
- **Principal:** who the caller is (rider, driver, staff, status) is read from `app.users`, `app.riders`, `app.drivers` and `app.staff_members`. Token metadata is never trusted.
- **Staff permissions:** the union of their roles (`packages/core/src/platform/permissions.ts`). They apply only to sessions with a second factor (`aal2`) when `STAFF_REQUIRE_MFA=true`, which is mandatory in production.
- **City scope:** staff limited to some cities are refused records elsewhere.
- **Suspended accounts:** stopped at the guard.

## 6. Database connection (Built + tested against PostgreSQL 16)

`src/database/database.ts`:
- **Pool:** one `pg` pool per process.
- **TLS:** `verify-full` against the Supabase root certificate in staging and production.
- **Timeouts:**
  - per-transaction `SET LOCAL statement_timeout` and `lock_timeout`, which also work through Supavisor's transaction mode;
  - a client-side query timeout;
  - a 2-second readiness ping.

Supabase connections:

| Use | Connection | Why |
|---|---|---|
| API requests | Supavisor pooler, transaction mode (port 6543) | Many short transactions. No session state, no named prepared statements. |
| Migrations, advisory locks | Direct connection or session mode (port 5432), `DATABASE_MIGRATION_URL` | The advisory lock needs a real session. |
| Worker | Pooler (transaction mode) | `FOR UPDATE SKIP LOCKED` works inside a transaction. |

**Roles (to create on Supabase, `DATABASE_MIGRATIONS.md` §Roles):**
- `gobye_migrator` owns the `app` and `ops` schemas.
- `gobye_api` gets read and write on tables only.
- Neither is `postgres`.
- The service-role key is never used by the API.

**Row level security:** on for every table, with no policies. Only the backend roles (owner, or `bypassrls`) read them. The Data API exposes only `public`.

## 7. Schema and migrations (Built + tested)

Forward-only SQL in `apps/api/migrations`. Runner in `src/database/migrations.ts`, CLI in `src/migrate.ts`. Workflow: `DATABASE_MIGRATIONS.md`.

| Migration | Tables | Rules the database enforces |
|---|---|---|
| 0001_foundation | `ops.audit_events`, `ops.idempotency_keys`, `ops.jobs`, `ops.job_schedules` | Audit log is append-only. One job per idempotency key. A running job has a lease. Client roles revoked. |
| 0002_identity | `app.users`, `riders`, `drivers`, `vehicles`, `staff_members` | Person id = Supabase user id. Valid phone and email. Staff roles from the fixed list. One active vehicle per driver. Unique plate. |
| 0003_driver_passes | `app.driver_pass_timelines`, `driver_pass_payments`, `driver_pass_voids` | Inputs of the D-058 timeline only. Payments and voids are append-only. One pass per payment reference. Version per driver. |
| 0004_rides | `app.rides`, `app.ride_events` | One active ride per driver and one open ride per rider (partial unique indexes, BR-047). NGN integer kobo. Ride events append-only. |
| 0005_costs_config_files | `app.vendors`, `operating_expenses`, `config_versions`; `ops.files` | Whole kobo. No self-approval. One active config version per key. A file can't be approved unless its scan was clean. |

**No ledger, wallet, withdrawal or payout tables (§9).**

## 8. Provider interfaces (Built + tested; real adapters: Future)

| Port | Contract | Default | Development / test | Production |
|---|---|---|---|---|
| Payments | `PaymentGatewayAdapter` (`packages/core/src/gateway/adapter.ts`, D-054) | `null`, nothing can charge | Simulated core adapter (labelled simulated) | Refuses simulated. Real adapter after Q-042 and the §9 reviews. |
| Maps | `MapsProvider` (`searchPlaces`, `reverseGeocode`, `route`) | `NOT_CONFIGURED` | `fakeMaps` (straight line × 1.3, 30 km/h, labelled fake) | Refuses fake. Google Maps Platform still only proposed (D-025). |
| Notifications | `NotificationSender` (push, sms, email; idempotent message id) | `NOT_CONFIGURED` | `logNotifications` (records ids; never logs addresses or data) | Refuses log-only. Sign-in SMS and OTP come from Supabase Auth. |
| Document storage | `ObjectStore` (`packages/core/src/files`) | `NOT_CONFIGURED` | In-memory mock store | R2 presigned PUT/GET (same SigV4 code and signed headers as the edge Worker). Head, move and delete stay with the upload signer Worker. |

## 9. Money: what is deliberately not built

Owner restriction: no real-money wallet before the ledger, reconciliation, payment-provider and security designs are reviewed.

**Phase 1 contains:**
- no wallet balances;
- no ledger tables;
- no fundings, withdrawals or payouts;
- no webhook endpoint;
- no real payment adapter.

**What it does contain:**
- recording of *provider-verified* pass payments into the D-058 timeline (`recordVerifiedPayment`, no HTTP route; to be called by the verification job once a provider exists);
- operating-cost records;
- versioned configuration rows.

**Proposed for review (not migrated):**
- **Ledger:** `app.ledger_journals` (id, kind, reference unique per kind, created_by, reverses) and `app.ledger_entries` (journal_id, account_kind, owner_id, provider, amount_kobo signed, `SUM = 0` enforced per journal by a deferred constraint trigger). Both append-only.
- **Collections and transfers:** `app.collections` and `app.transfers` keyed by provider reference (unique), with the lookup-first rules from `gateway/money-movement.ts`.
- **Provider fees:** posted to `processing_costs` as their own entries, separate from GoBye's `fee_income` and from pass revenue (BR-130–136).
- **Reconciliation:** `app.reconciliation_runs` and items. Corrections need a second person.

**Reviews needed before any of it ships:**
1. ledger and accounting (Finance);
2. reconciliation against the chosen provider's settlement report;
3. provider adapter in test mode (Q-042);
4. security review (threat model update, key handling, webhook signatures, payout approval).

## 10. Durable automation without Redis (Built + tested)

`ops.jobs` + `ops.job_schedules` (`src/jobs`):

- **Enqueue:** idempotent by business key. The same event never creates two jobs (`ON CONFLICT DO NOTHING`).
- **Claim:** `FOR UPDATE SKIP LOCKED`, with a lease (default 60 seconds). A crashed worker's job is reclaimed after the lease expires and the attempt count rises. A job whose worker dies on its last allowed attempt is marked `failed`, not reclaimed for ever.
- **Retries:** exponential backoff with jitter (5 seconds doubling, capped at 15 minutes), up to `max_attempts`.
  - Permanent failures stop at once and become visible for a protected manual retry (Automation Centre, D-055).
  - An unknown kind (a newer version's job during a rolling deploy) waits and retries.
- **Handler timeout:** 30 seconds by default. The handler's `AbortSignal` fires, and the retry is not scheduled before the timed-out run's lease would end, so two runs never overlap within a lease.
- **Schedules:** every instance may tick. Each slot inserts one job keyed `<schedule>:<slot>`, so the unique index guarantees exactly one.
- **Where it runs:** in the API process (`WORKER_ENABLED=true`, for small deployments) or as its own service from the same image (`worker.js`, recommended: a StackShift worker service with no public ingress).
- **Registered today:** `ops.idempotency_cleanup` (hourly) and `ops.noop`. Every financial workflow in the Automation Centre registry stays `not_connected` (§9).

**When to revisit (measure first):**
- queue wait p95 over 5 seconds at normal load;
- more than about 200 jobs per second sustained;
- lock contention on `ops.jobs`.

Before adding Redis, the first steps are `LISTEN/NOTIFY` wake-ups and partitioning `ops.jobs` by status.

## 11. Deployment (Built; image build not run here)

| Item | State |
|---|---|
| `apps/api/Dockerfile` | Multi-stage (deps → build → prod-deps → runtime), Node 22 slim, non-root `node` user, `HEALTHCHECK` on `/health/live`, `APP_VERSION` build argument. |
| Docker build | **Not run here:** Docker Hub is blocked from the build workspace. Every stage's commands were rehearsed with the same file allowlist. The rehearsal found and fixed a missing `apps/api/node_modules` copy (zod). The runtime layout passed all 11 deploy checks. |
| `.dockerignore` | Allowlist: no `.env` files, no app sources, no git. |
| StackShift | Plan and test checklist in `DEPLOYMENT_STACKSHIFT.md`. Nothing deployed. |
| CI | Template at `apps/api/ci/github-actions-api.yml`. Move it to `.github/workflows/` when the repository token has workflow permission. |
| Post-deploy check | `scripts/health-check.mjs` (11 checks, exits non-zero on failure). Tested against a live in-process server. |

## 12. API conventions (Built + tested)

| Convention | Implementation |
|---|---|
| Versioning | URI: `/v1/...`. Unknown versions → `400 unsupported_api_version`. `/health/*` is unversioned. |
| Success envelope | `{ "data": …, "meta": { "requestId": "…" } }` (core `ApiSuccessBody`) |
| Error envelope | `{ "error": { "code", "message", "requestId", "details"?, "retryAfterSeconds"? } }`. Generic codes lower case (shared with the gateway); domain codes upper case (`TOKEN_EXPIRED`, `MFA_REQUIRED`, `ACCOUNT_SUSPENDED`, `NOT_CONFIGURED`). Unknown errors → `500 internal_error` with a generic message. Details are logged, not returned. |
| Validation | zod schemas per route, `.strict()` (unknown fields refused) → `422 validation_failed` with `details: { field: message }`. Invalid JSON → 422. Body > 256 KB → 413. |
| Request ids | Incoming `x-request-id` kept if well formed (8–128 of `[A-Za-z0-9._:-]`), else a UUID. Echoed in the header and the envelope. Present in every log line. |
| Idempotency | `Idempotency-Key` required on creating and changing writes. The record is written in the same transaction as the change. Same request → replay (`idempotent-replayed: true`); different request → `409 idempotency_conflict`. Concurrent duplicates wait on the row lock. Records expire after 48 hours (hourly cleanup job). |
| Gateway signature | `X-Gobye-Origin-Auth`: HMAC over request id, time, **method and path** (shared signing code with the gateway Worker, tested both ways). A request id seen in the last 60 s is refused (per-instance replay cache). Required in staging and production. `/health/*` exempt. |
| Headers | `x-request-id`, `nosniff`, `DENY` framing, `no-referrer`, `cache-control: no-store`; no `x-powered-by`. CORS only for listed https origins. |
| Logs | pino JSON: method, path without query, status, latency, request id. Authorization, cookies, signatures and idempotency keys are redacted. Bodies are never logged. |
| Shutdown | SIGTERM: stop claiming jobs, finish requests, close the pool. Fastify answers 503 while closing. |

Endpoints and payloads: `API_CONTRACTS.md` §10.

## 13. Status table

| Area | State |
|---|---|
| Config validation, environment templates | Built + tested |
| Health live/ready (+ staff detail) | Built + tested |
| Envelopes, errors, request ids, validation, versioning, headers | Built + tested |
| Gateway signature check | Built + tested (against the gateway's own signer) |
| Supabase JWT verification (JWKS, claims, refusals) | Built + tested with locally generated ES256 keys. **Not yet against a real Supabase project.** |
| Principal from database, staff permissions, MFA, city scope, suspension | Built + tested |
| Postgres connection, transactions, timeouts | Built + tested (local PostgreSQL 16; Supabase runs 15/17) |
| Migration runner (lock, checksums, rollback, production flag) | Built + tested |
| Initial schema (identity, passes, rides, costs, config, files, ops) | Built + tested (constraints exercised) |
| Pass timeline storage + `GET /v1/drivers/{id}/subscription` | Built + tested (stacking, duplicates, concurrency, refunds, access control) |
| Operating costs `POST/GET /v1/costs/expenses`, `GET /v1/costs/break-even` | Built + tested (validation, idempotency, audit, marketing excluded) |
| Durable jobs and schedules | Built + tested |
| Provider ports | Built + tested; payments, maps and notifications are **placeholders or fakes**; R2 presigning built + tested (no live bucket) |
| Docker image | Built; **image build not run** (registry blocked). Runtime layout rehearsed and passing. |
| docker-compose (local) | Built, not tested here |
| CI workflow | Template only (needs moving into `.github/workflows`) |
| StackShift deployment | **Future**, blocked on owner account and the tests in `DEPLOYMENT_STACKSHIFT.md` |
| Rides, matching, pricing, payments, wallet, files API, realtime endpoints | **Future** (Phase 2+) |

## 14. Implementation checklist

**Phase 1 (this work)**
- [x] Audit apps, auth, data models, ride flows, subscriptions, wallet, admin (`BACKEND_AUDIT.md`)
- [x] NestJS + Fastify API in `apps/api`, sharing `@gobye/core`
- [x] Versioning, validation, structured errors, request ids, config validation
- [x] `/health/live` and `/health/ready` (+ staff `/v1/ops/health`)
- [x] Supabase PostgreSQL connection layer (pooler/direct, TLS, timeouts)
- [x] Supabase Auth JWT verification + server-side permissions (MFA, city scope)
- [x] Initial schema + safe migration workflow (lock, checksums, forward-only, production flag)
- [x] Provider interfaces: payments, maps, notifications, document storage
- [x] Durable automation on PostgreSQL (no Redis)
- [x] Dockerfile, `.dockerignore`, docker-compose (local), env templates for development, staging and production
- [x] Automated tests (72) + post-deploy health check script
- [x] Independent review: 12 findings (1 high, 6 medium, 5 low), all fixed with regression tests (§15)
- [x] Docs and LOG

**Phase 1b: owner and infrastructure steps (nothing here is done)**
- [ ] Rotate the credentials shared in chat (GitHub PAT, Supabase service-role key, Cloudflare token)
- [ ] Choose the Supabase region and plan for staging and production (Q-076); create separate projects
- [ ] Switch both projects to asymmetric JWT signing keys; enable MFA for staff
- [ ] Create `gobye_migrator` and `gobye_api` roles (`DATABASE_MIGRATIONS.md` §Roles); run migrations on staging
- [ ] Create a StackShift account; run the staging tests in `DEPLOYMENT_STACKSHIFT.md` (Q-075)
- [ ] Set `ORIGIN_AUTH_SECRET` on the staging gateway and API; point `ORIGINS_JSON` at the StackShift URL
- [ ] Move the CI template into `.github/workflows/`

**Phase 2: first product endpoints (proposed order)**
- [ ] Sign-up completion (`POST /v1/me/profile`) and account deletion pipeline
- [ ] Driver onboarding + documents (files API over `ops.files` + the upload signer)
- [ ] Pricing quotes (server-side, versioned config) and `POST /v1/rides` (Quick Match), then negotiation
- [ ] Realtime provider decision (Q-066) and trip events
- [ ] HTTP service implementations in the apps, one service at a time, each behind its own switch

**Phase 3: money (only after the §9 reviews)**
- [ ] Ledger tables and posting functions (from `platform/ledger.ts`) with database-level balance checks
- [ ] Provider adapter (Q-042) in test mode; webhook intake with signature check, storage and dedupe
- [ ] Pass purchase end to end: collection → verification job → `recordVerifiedPayment`
- [ ] Reconciliation runs; then wallet funding; payouts last

## 15. Independent review (2026-10-23)

A separate reviewer read the API without seeing this document. All 12 findings are fixed, and each fix has a test.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | `?ssl=0` (or `sslmode`) in `DATABASE_URL` could switch TLS off despite `DATABASE_SSL=verify-full` | Every TLS-related URL parameter is stripped; `DATABASE_SSL` and `DATABASE_CA_CERT` are the only source |
| 2 | Medium | The gateway did not route `/v1/me`, `/v1/costs`, `/v1/ops` | Added to the gateway route map (account class) |
| 3 | Medium | The gateway signature was not bound to the request; a captured header could be replayed for 60 s on any route | The signature now covers the method and path (gateway and API updated together); per-instance replay cache of request ids |
| 4 | Medium | Migrations could run through the transaction pooler (advisory lock ineffective) | `DATABASE_MIGRATION_URL` required in staging and production; port 6543 refused; no fallback outside development |
| 5 | Medium | A multi-statement `no-transaction` migration would fail | Refused at load: exactly one statement |
| 6 | Medium | A job that kills its worker was reclaimed for ever | Marked `failed` once `attempts ≥ max_attempts` |
| 7 | Medium | A timed-out job could run twice at once | Abort signal; the retry waits for the lease end |
| 8 | Low | Queries outside transactions had no server-side timeout | `statement_timeout` sent at connection start, plus role-level setting (`DATABASE_MIGRATIONS.md`) |
| 9 | Low | A concurrent duplicate could get a 500 after the lock timeout | Postgres lock timeout, serialisation failure and deadlock → `409 conflict` with `Retry-After`; timeout → 503 |
| 10 | Low | Staging allowed `STAFF_REQUIRE_MFA=false` | Refused in staging and production |
| 11 | Low | Timeline read was not one snapshot; another driver's payment reference became a 500; legacy references could collide | Repeatable-read transaction; `wrong_driver` refusal; legacy references include the driver id (core) |
| 12 | Low | During a rolling deploy, an old worker failed a newer job kind for good | Unknown kinds retry with backoff |

