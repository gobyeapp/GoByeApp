# Threat model (D-051)

Assets: rider and driver identities, driver documents, live locations, bookings and agreed fares, payments
and wallet balances, incident evidence, staff accounts, infrastructure credentials.

Actors: outside attackers, abusive riders or drivers, compromised devices, malicious or careless insiders,
supply-chain compromise.

Each threat lists **preventive**, **detective** and **recovery** controls with their status. "Tested locally"
means automated tests against fakes in this repo; nothing is verified in production.

| # | Threat | Preventive | Detective | Recovery | Status |
|---|---|---|---|---|---|
| T1 | **Stolen credentials** (rider/driver/staff passwords, OTP interception) | Password + phone verification (D-045); OTP rate limit 5 per 5 min at the edge (`routes.ts`); staff MFA | Auth-failure alert policy (`ALERT_POLICIES`) | Session revocation, forced reset | Edge limits tested locally; auth provider pending; MFA simulated |
| T2 | **Compromised mobile app** (modified build, extracted config) | No secrets in bundles (`findSecrets`, `check:env`); server authorises everything; fares locked server-side | Anomalous request patterns in gateway logs | Revoke sessions; rotate public keys if abused | Implemented, tested locally; app attestation is a future enhancement |
| T3 | **Leaked API keys / secrets** | Secrets only in Worker / backend secret stores; separate per environment; least-privilege R2 tokens | `check:env` before deploy; git history checked (none committed) | Rotate (`wrangler secret put`), redeploy; see DR scenario 7 | Implemented; rotation of the 2026-10-22 chat-shared keys **outstanding** |
| T4 | **Unauthorised document access** | Private buckets; presigned 60 s downloads only after owner/staff check; staff need a reason; no listing of others' files | Audit events for every staff read (`FileAuditEvent`) | Revoke staff access; review audit | Implemented, tested locally (`files-service`, `upload-signer` tests) |
| T5 | **GPS spoofing** (fake driver position, fake arrival) | Server-side plausibility checks on speed/jumps; PIN at pickup (D-030 trip flow) | Location anomaly metric | Trip review, driver suspension | PIN implemented in apps; plausibility checks pending backend |
| T6 | **Fake driver identities** | Document upload with type/magic-byte checks, scan, staff review with checks per document; masked numbers | Review queue; duplicate identity checks (backend) | Reject / suspend; evidence retained | Upload pipeline tested locally; NIN/FRSC checks pending providers |
| T7 | **Fare manipulation** | Quotes versioned and expiring (`assertQuoteFresh`); agreed fare locked (`lockedFare`); server authoritative | Mismatch between quote and charge in reconciliation | Adjustment process with audit | Client rules tested locally; server pending |
| T8 | **Duplicate bookings** | Idempotency keys on create (`newIdempotencyKey`); no automatic replay of writes (client and gateway) | Duplicate-key metric | Lookup by key resolves ambiguity (`resolveAmbiguous`) | Tested locally (client, gateway, traffic contract tests) |
| T9 | **Payment fraud** | No cards at launch (D-023); provider-hosted flows; webhook signatures; idempotent charges | Payment failure alerts; reconciliation | Reverse / refund with approvals (admin prototype) | Contracts only; provider pending |
| T10 | **Origin bypass** (hitting the backend directly) | `X-Gobye-Origin-Auth` HMAC verified by origins; Tunnel / IP allowlist / Authenticated Origin Pulls | Origin logs of unsigned requests | Rotate `ORIGIN_AUTH_SECRET` | Signing + reference verifier tested locally; origin side pending |
| T11 | **Proxy-header spoofing** (`X-Forwarded-For`, `X-User-Id`, `X-Gobye-*`) | Header allowlist; client IP from `CF-Connecting-IP`; caller identity only from signed assertion | Gateway logs | — | Implemented, tested locally (`gateway-routing`, `upload-signer` forged assertion) |
| T12 | **DDoS / resource exhaustion** | Cloudflare edge; per-class rate limits; body limits; direct-to-R2 uploads (no Worker in data path) | Traffic spike alert policy | Cloudflare under-attack mode; emergency policy disabling non-critical routes | Gateway limits tested locally; edge rules pending deployment |
| T13 | **Cloud misconfiguration** (public private bucket, wildcard CORS, wrong DNS proxying) | Definitions in git (`r2/buckets.json`, `cors.*.json`, `dns/records.proposed.json`); no `*` CORS; private buckets never public | Review before apply; post-deploy checks in INFRASTRUCTURE_TEST_PLAN | Revert definitions; rotate exposed objects' access | Configured; not applied |
| T14 | **Supply-chain vulnerabilities** | Lockfile; pinned versions; vendored three.js; minimal Worker dependencies (none beyond core) | `npm audit` in CI (CI pending) | Patch and redeploy | Partly; CI pending (INFRASTRUCTURE_AUDIT R4) |
| T15 | **Insider misuse of admin privileges** | Role permissions; reasons on sensitive reads; second approver for production traffic changes; proposer can't approve | Audit trail; access reviews | Revoke, roll back (`applyChange` rollback) | Implemented in core and admin, **simulated**; server enforcement pending |

## Trust boundaries

1. Device ↔ edge (HTTPS, untrusted client).
2. Edge ↔ origin (signed origin header, Full strict TLS).
3. Edge ↔ R2 (Worker bindings; clients only via presigned URLs).
4. Admin browser ↔ backend (staff sessions, MFA; today simulated).
5. Demo relay (D-049): **outside** the production model; test data only, no auth, LAN HTTP.

## Residual risks accepted for now

- Demo relay has no authentication (test data only; refused in production config).
- In-isolate rate limiting is per Worker instance until Cloudflare rules or a Durable Object are configured.
- Admin permissions and MFA are UI-side until a backend exists; the admin must not hold real data.
