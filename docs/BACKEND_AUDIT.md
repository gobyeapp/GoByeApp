# Backend Phase 1: repository audit (2026-10-23)

This audit was written before any backend code was added. It records what exists, what is simulated, and what the backend must take over. It is based on the working tree at commit `a5a97c8`, the documentation in `docs/`, and the source code.

**Short answer:**
- There was no backend.
- Every app runs on simulated services.
- The parts the backend needs most already exist as tested, framework-free TypeScript in `packages/core`:
  - the pass timeline, permissions, the ledger, fee schedules and the payment adapter contract;
  - file lifecycle, health and error envelopes;
  - the automation registry and costs.

The backend must reuse that code, not rewrite it.

## 1. What exists

| Area | Where | State | Backend consequence |
|---|---|---|---|
| Rider app | `apps/rider` (Expo SDK 57) | Complete UI on `createMockServices()`. Sign-in is simulated (email + password, Apple, Google, then phone code; D-045). Accounts persist on the device (`authStore`). | Real sign-in comes from Supabase Auth. The app needs HTTP implementations of `AuthService`, `PricingService`, `MatchingService`, `TripService`, `PaymentService`, `WalletService` (Phase 2+). |
| Driver app | `apps/driver` | Complete UI on mocks: registration, documents, the pass timeline (D-058, local), requests, trips, earnings. Location sessions are real on the device. | Server owns verification, eligibility (`NO_ACTIVE_ACCESS`), the pass timeline, matching and location ingestion. |
| Admin | `apps/admin` (Vite SPA, Vercel) | Runs on `createPlatformDataset()` test data. Staff sign-in and MFA are simulated. Permissions are enforced in the UI only. | Server must enforce the same permissions (`packages/core/src/platform/permissions.ts`). Staff MFA becomes Supabase `aal2`. |
| Website | `apps/web` (Vercel) | Live. The waitlist writes to Supabase `public.waitlist` with the anon key (insert-only RLS). | Untouched. The backend must not break the `public` schema tables it uses. |
| Connected demo | `tools/demo-relay`, `public.demo_*` tables | Test-only relay (D-049). The demo tables allow anon reads and writes. | Not production. The backend uses its own schemas (`app`, `ops`) so nothing collides. |
| Edge | `infra/cloudflare` | API gateway Worker (origin HMAC `X-Gobye-Origin-Auth`, request IDs, rate limits, failover), upload signer, media gateway, R2 definitions. Tested locally, **not deployed**. | Origins must verify the gateway signature and serve `GET /health/live` and `GET /health/ready`. |
| Shared rules | `packages/core` | Pure TypeScript, no runtime dependencies. 265 tests. | Compiled into the API at build time, so the server and the apps share one implementation of each rule. |

## 2. Domain by domain

**Authentication**
- Simulated everywhere (`AuthService` mock).
- No tokens are issued.
- `SECURITY_PRIVACY.md` §2 requires:
  - short-lived access tokens with rotating refresh;
  - server-side revocation;
  - OTP limits;
  - no OTP in logs.
- Supabase Auth covers sessions, refresh rotation, phone OTP, email codes, Apple/Google and staff MFA. The backend only verifies tokens (JWKS) and decides permissions.

**Data models**
- TypeScript types live in `packages/core/src/types.ts` and `platform/types.ts`, described in `DATA_MODELS.md`.
- Money is integer kobo everywhere (BR-001).
- IDs are opaque strings in the prototype. The database uses UUIDs, and Supabase `auth.users.id` is the person's ID.

**Ride flows**
- `bookingReducer` (state machine), negotiation rules, quick match and trip phases all run in core against mocks.
- Server contract: `API_CONTRACTS.md` §4–6 and `BACKEND_HANDOVER.md` §2–4. These require:
  - single assignment under concurrency (row lock or partial unique index);
  - server-side expiry;
  - idempotency keys on every write.
- Naming conflict: `/bookings` (contracts) vs `/v1/rides` (gateway). **Q-069**, resolved here as `/v1/rides` (the gateway map already uses it).

**Subscriptions (driver passes)**
- `packages/core/src/subscriptions` is the single calculation (D-058):
  - ₦2,000 for 24 hours and ₦60,000 for 30 days;
  - passes queue after the last scheduled pass;
  - voids keep history;
  - idempotent by payment reference;
  - `expectedVersion` checks.
- The Driver App stores it on the device. The admin reads it from test data.
- The backend stores the inputs (payments and voids) and computes the timeline with the same function.

**Wallet and ledger**
- `platform/ledger.ts`:
  - balanced journals and reversals;
  - wallet funding credit, trip charge, withdrawal reserve, settle and release;
  - separate `processing_costs` and `fee_income` accounts.
- `gateway/*`: provider adapter contract, versioned fee schedules, money-movement guards.
- All of this is simulated. **No real-money wallet may be built until the ledger, reconciliation, provider and security designs are reviewed** (owner restriction). Phase 1 creates no ledger or wallet tables. The proposed tables are written down for review (`BACKEND_ARCHITECTURE.md` §9).

**Costs and profitability**
- `packages/core/src/costs` holds vendors, expenses, budgets and `breakEven()`.
- `OPERATING_CATEGORIES` already excludes marketing, matching the agreed break-even rule.
- Expenses are entered by hand (D-057).

**Automation**
- `packages/core/src/automation` holds a registry of 14 workflows with idempotency keys, retry classes and escalation.
- `runtime: 'not_connected'` everywhere (Q-074).

**Files**
- `packages/core/src/files` holds the `ObjectStore` interface, `FileService`, class rules, the quarantine → scan → approved lifecycle and quotas.
- The upload signer Worker implements it at the edge.
- The backend needs the metadata table and the same rules.

**Admin functionality**
- Every workspace (people, trips, live ops, finance, payments, costs, automation, support, safety, staff, audit) is UI over test data.
- `permissions.ts` (10 roles, union of permissions, city scope) and `approvals.ts` (second-person approvals) are the rules the server must enforce.

## 3. Inconsistencies found (and how Phase 1 settles them)

| # | Inconsistency | Resolution in Phase 1 |
|---|---|---|
| 1 | Validation errors: `API_CONTRACTS.md` says `400 VALIDATION_FAILED`; core `ERROR_STATUS` and the gateway say `422 validation_failed`. | The backend follows core (422, lowercase generic codes). The API client already treats 400 and 422 alike. The contracts doc is updated. |
| 2 | Success envelope: contracts show `{ data, requestId }`; core `ApiSuccessBody` is `{ data, meta }`. | `{ data, meta: { requestId } }`, plus the `x-request-id` header. The client reads `data` and the header, so both shapes work. |
| 3 | Booking path `/bookings` vs `/v1/rides` (Q-069). | `/v1/rides` (gateway map). |
| 4 | Upper-case domain codes in the contracts (`NO_ACTIVE_ACCESS`) vs lower-case generic codes in core. | Generic codes stay lower case (shared with the gateway); domain codes stay upper case as documented. The envelope allows both. |
| 5 | The Supabase project holds live (`waitlist`) and test (`demo_*`) tables in `public`, exposed through the Data API. | Backend tables live in schemas `app` and `ops`, which are not exposed to the Data API. RLS is on with no policies, and the backend connects with its own role. |
| 6 | Credentials shared in chat on 2026-10-22 (GitHub PAT, Supabase service-role key, Cloudflare setup token). | Still to be rotated by the owner. The backend never needs the service-role key for normal requests. |

## 4. What the backend must not do

- Change or remove working app, admin or website behaviour (all mocks stay until each HTTP service is ready and tested).
- Hold or move real money: wallet, payouts and live charges wait for the reviews listed above.
- Trust client-calculated fares, permissions or payment statuses.
- Store gateway credentials in code, images or committed env files.
- Add Redis, ClickHouse, Kubernetes or paid services without a demonstrated need.

## 5. Gaps that Phase 1 fills, and gaps it leaves

**Fills**
- A NestJS service with versioning, validation, structured errors, request IDs, config validation, health checks and gateway signature checks.
- Supabase JWT verification and server-side permissions.
- A Postgres connection layer and initial schema with a safe migration runner.
- Provider interfaces.
- A Postgres-backed job queue.
- Docker and environment templates, tests and docs.

**Leaves**
- Every product endpoint beyond the foundation: rides, matching, pricing, payments, wallet, files API, realtime.
- Real provider adapters.
- Staging deployment.
- Load and soak tests.
- The reviews named in §4.
