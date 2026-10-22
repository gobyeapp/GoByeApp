# Infrastructure foundation — implementation report (D-051, 2026-10-23)

## 1. Infrastructure status

**Before:** a static website on Vercel (minimal headers), Expo apps and a Vite admin running on simulated
services, a LAN demo relay (D-049), Supabase for the waitlist. No HTTP client, no file storage, no Cloudflare,
no gateway, no CI (INFRASTRUCTURE_AUDIT.md).

**Now:** a provider-independent foundation in code, tested locally against fakes:
- typed public config with secret detection; a central API client with request ids, timeouts, idempotency and
  safe retries; health and error contracts; structured logging with redaction; metrics and provisional alert
  policies; a resilient realtime client;
- a secure file pipeline (classes, validation, quarantine, scan, single-use completion, private downloads),
  an R2 SigV4 presigner and upload-signer / media-gateway Workers, R2 bucket/CORS/lifecycle definitions;
- an API gateway Worker for `api.gobye.app/v1` with header hygiene, limits, rate limits, origin
  authentication and health-aware failover; a traffic model with privileged, audited, simulated changes and an
  admin "Traffic and origins" page (simulation);
- hardened Vercel headers for the website and admin; DNS and load-balancer proposals.

| State | What |
|---|---|
| Implemented in code | everything listed above |
| Tested locally | all of it, against fakes / simulated origins (numbers in §4) |
| Deployed to staging | **nothing** |
| Verified in production | **nothing** |

## 2. Files created and modified

**Created**
- `packages/core/src/infra/`: `env.ts`, `errors.ts`, `health.ts`, `http.ts`, `idempotency.ts`, `observability.ts`, `realtime.ts`, `index.ts`
- `packages/core/src/files/`: `types.ts`, `policy.ts`, `validate.ts`, `lifecycle.ts`, `service.ts`, `video.ts`, `index.ts`
- `packages/core/src/traffic/`: `model.ts`, `select.ts`, `changes.ts`, `index.ts`
- Core tests: `src/__tests__/infra-env-http.test.ts`, `infra-observability-realtime.test.ts`, `files-validate-policy.test.ts`, `files-service.test.ts`, `traffic-routing.test.ts`, `traffic-changes.test.ts`
- `infra/cloudflare/` workspace (`package.json`, `tsconfig.json`, `src/index.ts`):
  - `src/r2/`: `sigv4.ts`, `bindings.ts`, `assertion.ts`
  - `src/workers/api-gateway/`: `gateway.ts`, `routes.ts`, `envelope.ts`, `headers.ts`, `ratelimit.ts`, `originAuth.ts`, `index.ts`, `wrangler.api-gateway.toml`
  - `src/workers/upload-signer/index.ts`, `src/workers/media-gateway/index.ts`
  - `r2/`: `buckets.json`, `cors.staging.json`, `cors.production.json`, `lifecycle.proposed.json`, `wrangler.upload-signer.toml`, `wrangler.media-gateway.toml`, `README.md`
  - `dns/`: `plan.md`, `records.proposed.json`; `load-balancer/`: `pools.proposed.json`, `monitors.proposed.json`, `steering.md`, `terraform/README.md`, `terraform/main.tf.example`
  - `test/`: `gateway-routing.test.ts`, `failover-gateway.test.ts`, `r2-sigv4.test.ts`, `upload-signer.test.ts`, `media-gateway.test.ts`, `check-env.test.ts`, helper `r2-fake.ts`
- `apps/rider/src/state/publicConfig.ts`, `apps/driver/src/state/publicConfig.ts`
- `apps/admin/src/workspaces/infrastructure/`: `Traffic.tsx`, `logic.ts`, `logic.test.ts`; `apps/admin/vercel.json`
- `tools/check-env.mjs`
- Docs: `INFRASTRUCTURE_AUDIT.md`, `INFRASTRUCTURE_ARCHITECTURE.md`, `NETWORK_ARCHITECTURE.md`, `CLOUDFLARE_SETUP.md`, `VERCEL_CONFIGURATION.md`, `R2_STORAGE_ARCHITECTURE.md`, `API_GATEWAY.md`, `API_CLIENT.md`, `LOAD_BALANCING_FAILOVER.md`, `TRAFFIC_SWITCHING.md`, `REALTIME_ARCHITECTURE.md`, `INFRASTRUCTURE_SECURITY.md`, `THREAT_MODEL.md`, `MONITORING_OBSERVABILITY.md`, `BACKUP_DISASTER_RECOVERY.md`, `ENVIRONMENT_CONFIGURATION.md`, `DEPLOYMENT_RUNBOOK.md`, `INFRASTRUCTURE_TEST_PLAN.md`, `INFRASTRUCTURE_COSTS.md`, this report

**Modified**
- `package.json` (workspace `infra/*`; scripts `infra:test`, `check:env`), `package-lock.json`
- `packages/core/src/index.ts` (exports `infra`, `files`, `traffic`)
- `apps/web/vercel.json` (security headers, CSP), `apps/admin/src/nav.tsx` (Traffic and origins)
- `apps/rider/.env.example`, `apps/driver/.env.example` (new public variable names, placeholders)
- `README.md`, `CLAUDE.md`, `AGENTS.md`, `LOG.md`, `docs/ARCHITECTURE.md`, `docs/API_CONTRACTS.md`, `docs/SECURITY_PRIVACY.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md`, `docs/OPEN_QUESTIONS.md`

## 3. Implemented features

- Public config parsing per environment; production refuses mocks, demo relay, http and secret-looking values.
- API client: request id, bearer, `Idempotency-Key`, per-call timeout, error envelope mapping, bounded
  jittered retries for reads/keyed writes only, Retry-After, offline detection, no secrets in logs,
  ambiguous-write resolution by lookup.
- Fare integrity helpers: quote freshness, locked agreed fare.
- Health contracts (`/health/live`, `/health/ready`) with a public view that hides dependencies.
- Logger with redaction; in-memory metrics; provisional SLOs and alert policies; alert sink interface.
- Realtime client: credentials, subscriptions, ordering, dedupe, gap resync, jittered reconnect,
  background/offline handling, version checks; mock transport.
- File service: 7 file classes, environment-specific buckets, server-generated keys, layered validation
  with magic bytes, quarantine → scan → approve, fail-closed scanner, single-use completion, owner/staff
  access with audited reasons, quotas, deletion rules, video originals without transcoding claims.
- R2: SigV4 presigner (AWS test vector), R2 binding adapter, signed gateway assertions, upload-signer and
  public media gateway Workers.
- API gateway: route classes, auth presence, limits, rate limits, header allowlists, origin HMAC, health-aware
  selection and failover, no replay of uncertain writes, no-store, sanitised errors, structured logs, honest
  `503 backend_not_configured`.
- Traffic: origins, five policies, hysteresis, recovery ramp, change proposals with permission, MFA, reason,
  second approver, stale-version refusal, rollback, audit events; simulated control plane; admin page.
- Vercel headers for website and admin; `check:env` tool.

## 4. Tests performed

| Command | Result |
|---|---|
| `npm run typecheck` | 0 errors across all workspaces |
| `npm test` | core **215**, rider **36**, driver **14**, admin **250**, infra/cloudflare **41** — all pass |
| `npm run infra:test` | **41** passed (6 files) |
| Website in Chromium with `vercel.json` headers applied locally | renders, video, waitlist dialog, footer canvas; no CSP violations (fonts/cdnjs unreachable from the sandbox) |
| Admin build + traffic page in Chromium with its headers | no CSP violations or errors |

Outstanding failures: none. Not tested: anything requiring real Cloudflare, R2, DNS, origins or providers
(INFRASTRUCTURE_TEST_PLAN.md "Not yet tested").

## 5. Security review

**Controls implemented:** see INFRASTRUCTURE_SECURITY.md (all "tested locally", none verified in production).

**Risks discovered:** credentials pasted in chat on 2026-10-22 (not in git; rotation outstanding); no CI;
demo relay unauthenticated on LAN (demo only); optional Supabase demo tables writable by anon (if applied);
admin permissions/MFA UI-side; mock services not yet guarded in app builds.

**Unresolved:** real auth/session, server-side authorisation and MFA; malware scanning; production rate
limiting across isolates; network-level origin protection; WAF rules; certificate plan for two-level staging
names; secret rotation with overlap; backups and restore drills.

## 6. Configuration requirements (names only, never values)

**Public (safe in bundles):**
- Apps: `EXPO_PUBLIC_ENV`, `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_REALTIME_URL`, `EXPO_PUBLIC_MEDIA_BASE_URL`, `EXPO_PUBLIC_USE_MOCKS`, `EXPO_PUBLIC_DEMO_RELAY_URL`, `EXPO_PUBLIC_DEMO_RELAY_KEY` (anon key only)
- Admin: `VITE_DEMO_RELAY_URL`, `VITE_DEMO_RELAY_KEY` today; `VITE_ENV`, `VITE_API_BASE_URL`, `VITE_REALTIME_URL`, `VITE_MEDIA_BASE_URL`, `VITE_USE_MOCKS` supported by `parsePublicConfig` for later
- Website: Supabase URL + anon key in `apps/web/site.config.js`

**Worker vars (non-secret):** api-gateway `ORIGINS_JSON`, `TRAFFIC_POLICY`, `ENVIRONMENT`, `PUBLIC_HOST`,
`ALLOWED_ORIGINS`; upload-signer `DEPLOY_ENV`, `PUBLIC_MEDIA_BASE_URL`; R2 bindings `UPLOADS`, `DOCUMENTS`,
`EVIDENCE`, `PUBLIC_MEDIA`.

**Server-only secrets:** `ORIGIN_AUTH_SECRET` (gateway), `GATEWAY_ASSERTION_SECRET`, `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (signer); later `PAYSTACK_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`,
`DATABASE_URL`, `SESSION_SIGNING_SECRET`, `MEDIA_TOKEN_SECRET`, `SMS_PROVIDER_API_KEY`,
`GOOGLE_MAPS_SERVER_KEY`, `CLOUDFLARE_API_TOKEN` (deploys), `SUPABASE_SERVICE_ROLE_KEY` (if ever used, server
only). Full rules in ENVIRONMENT_CONFIGURATION.md.

**External services needed:** Cloudflare account with the `gobye.app` zone, R2, Workers (and later Load
Balancing); Vercel project(s); backend + database; auth/OTP provider; malware scanner; realtime provider;
observability sink.

## 7. Pending integrations

| Blocked by | Items |
|---|---|
| Backend selection (Q-064) | gateway origins, `/health/*`, origin signature verification, file metadata repository, realtime server |
| Database selection (Q-064) | `FileMetadataRepository`, idempotency records, audit storage, backups / PITR |
| Auth provider (Q-065) | sessions, minting gateway assertions, staff MFA, revocation |
| Credentials | R2 tokens, Worker secrets, Cloudflare API token |
| Domain access / approval | DNS records, `media.gobye.app`, `api.gobye.app`, staging hosts (Q-070) |
| Provider approval | malware scanner (Q-067), realtime (Q-066), observability, Stream (later) |
| Paid plan | Load Balancing, advanced rate limiting / WAF tiers, extra certificates (Q-068) |

## 8. Next implementation steps (in order)

1. Rotate the Supabase service_role key and the GitHub token (owner).
2. Add CI: typecheck, tests, `check:env`, `npm audit` on every push.
3. (Done 2026-10-23: both apps call `assertMocksAllowed(publicConfig)` before creating simulated services.) Next: add an HTTP implementation
   skeleton of the service interfaces on top of `createApiClient` behind `EXPO_PUBLIC_USE_MOCKS=false`.
4. Choose backend, database and auth (Q-064, Q-065); implement `/health/*` and origin-signature checks on the
   first origin.
5. Create staging R2 buckets and tokens; deploy upload-signer + media-gateway to staging; run the storage
   staging checks (incl. checksum enforcement).
6. Choose a malware scanner (Q-067); keep documents fail-closed until then.
7. Deploy the API gateway to `api-staging.gobye.app` with one origin; run the network checks.
8. Wire the driver app's `PhotoCapture` to `/v1/files/*` (initialise → PUT → complete).
9. Choose a realtime provider (Q-066) and implement the server side of the realtime contract.
10. When a second origin exists: Load Balancing evaluation, monitors, failover drill.
