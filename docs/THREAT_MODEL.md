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

## Update for Backend Phase 2 (2026-11-27): sign-in, driver documents, deletion

What changed with real accounts (D-077 to D-083), threat by threat. "Tested locally" means automated tests in this repo; nothing has run against real users.

| # | Threat | Preventive | Detective | Recovery | Status |
|---|---|---|---|---|---|
| T16 | **Phone-code abuse** (SMS pumping, guessing codes, flooding a number) | Supabase Auth limits codes per number and per IP. The app waits about a minute before sending another code. Only Nigerian mobile numbers are accepted (`isNigerianPhone`). A sign-in code is never sent for an account that doesn't exist (`shouldCreateUser: false`). Error messages never say whether an account exists (`friendlyAuthError`) | Supabase Auth logs; SMS spend on the provider's dashboard (D-067: to surface in Service balances) | Lower Supabase's SMS limits; block number ranges at the provider | App side tested locally; Supabase limits and the SMS provider are not configured yet (A-4) |
| T17 | **Password-only sign-in** (stolen or reused password) | Every password sign-in ends with a code to the account's phone: the password step signs straight out, and the session starts only after the code (D-078) | Auth failure alerts (T1) | Password reset by emailed code; sessions revoked on reset | Tested locally with a fake Supabase |
| T18 | **Session theft from the device** | Sessions sit in the Keychain / Keystore (chunked SecureStore), never in AsyncStorage on phones. Refresh happens only while the app is open. Tokens are checked against Supabase's signing keys by the API and the upload signer | Unusual devices: the `app.devices` list per account | Sign out from the account; Supabase session revocation | Implemented. The web test build keeps the session in browser storage (test only) |
| T19 | **Staff reading driver documents without need** | Staff file roles come from the database (`fileRolesFor`), never the token. Staff roles count only after the second sign-in step. Staff stay inside their cities and can't review their own application. Downloads need a reason and are audited (T4). Contact details only with `drivers.contact_details` | Audit rows for every document access and decision; application history | Remove the staff member (`status`), which takes effect on the next request | Tested locally; document viewer not built yet |
| T20 | **Unscanned or malicious uploads** | A file is unreadable until scanned clean. With no scanner connected, everything stays "checking" (fail closed). Type and magic-byte checks, size limits, checksum checked against storage. Submission and approval need every file clean | Files stuck in scanning (daily clean-up re-scans) | Quarantine or reject the file; the driver uploads again | Tested on PostgreSQL locally; no scanner chosen |
| T21 | **Approval race or replay** (two staff, or a resent request) | Optimistic versions on applications (`VERSION_CONFLICT`); idempotency keys on every write; a plate can't be on two active vehicles | `application_events` (append-only) and audit rows | Decisions are recorded with who and why; a wrong approval is reversed by suspending | Tested locally, including two decisions at once |
| T22 | **Deletion and data rights** | Deletion is scheduled after 14 days and can be cancelled. The deletion job anonymises the profile, removes devices and deletes the sign-in account. People can download their own data (`GET /v1/me/export`, audited, without internal storage details) | Audit rows for deletion requests and exports | Backups (D-083) hold deleted data for 14 days at most on staging | Tested locally; legal review of the retention periods pending (Q-071, Q-073) |
| T23 | **Backup exposure** | The nightly staging backup is encrypted (AES-256) before it leaves the runner; it's a private artifact kept 14 days; the passphrase is only in GitHub's staging environment and the owner's password manager | Each run checks that it decrypts and lists tables | Rotate the passphrase; old artifacts expire | Workflow written; first staging run pending the passphrase |

**Accepted for now:**
- The admin's other pages still use its own dataset in live mode (D-081). Live mode is staging only.
- The rider web preview is public by link (search engines are told not to index it). It uses test data only.
