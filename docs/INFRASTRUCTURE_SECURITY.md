# Infrastructure security (D-051)

Security requirements and controls for GoBye's network, edge, storage and deployment, by layer. Product and
privacy rules (permissions, location, account deletion, logging policy) stay in `SECURITY_PRIVACY.md`;
threats and controls per threat are in `THREAT_MODEL.md`.

Status: **Implemented** · **Tested locally** · **Configured** · **Simulated** · **Pending …** · **Future**.
"Tested locally" means automated tests against fakes in this repo. Nothing has been verified in staging or
production, so no control below is "verified".

## References used

OWASP MASVS (mobile storage, network, auth), OWASP ASVS (session, access control, files, config), OWASP API
Security Top 10 (object-level authorisation, resource consumption, SSRF, misconfiguration), NIST SSDF
(protect the software, produce secure software, respond to vulnerabilities), Apple and Android platform
guidance (Keychain/Keystore, ATS/cleartext), Nigeria Data Protection Act 2023 and NDPC guidance (lawful
basis, minimisation, retention, breach notification), PCI DSS scope (below).

## Controls by layer

### Client apps (rider, driver)

| Control | Status | Where |
|---|---|---|
| Only public config in bundles; secret-looking names or values refused | Implemented, tested locally | `parsePublicConfig`, `findSecrets` (`infra/env.ts`); `npm run check:env` |
| Mock services refused in production config | Implemented, tested locally; **not yet wired** into `ServicesProvider` | `assertMocksAllowed` |
| https/wss required outside development; no LAN or credentials in URLs | Implemented, tested locally | `parsePublicConfig` |
| Tokens in Keychain/Keystore | Implemented (mock tokens) | `apps/*/src/state/storage.ts` |
| No silent retry of writes; ambiguous outcomes looked up by idempotency key | Implemented, tested locally | `createApiClient`, `resolveAmbiguous` |
| Agreed fare locked after matching, never recalculated on the client | Implemented, tested locally | `lockedFare`, `assertQuoteFresh` (`infra/idempotency.ts`) |
| Realtime: short-lived credentials renewed on reconnect; server authorises channels | Implemented in client, tested locally; server side pending | `createRealtimeClient` |
| Certificate pinning | Future enhancement (decide with the backend; pinning risks outages on rotation) | — |

### Edge (Cloudflare)

| Control | Status | Where |
|---|---|---|
| TLS everywhere, Full (strict) to origins | Configured (plan) | `dns/plan.md` |
| Client identity / forwarding / admin headers stripped; client IP from `CF-Connecting-IP` only | Implemented, tested locally | `api-gateway/headers.ts` |
| Origin authentication `X-Gobye-Origin-Auth` (HMAC, timestamped) | Implemented, tested locally; origins must verify (pending) | `api-gateway/originAuth.ts` |
| Bearer presence on protected routes (backend still authorises) | Implemented, tested locally | `api-gateway/gateway.ts` |
| Body size limits, method allowlist, JSON validation per route class | Implemented, tested locally | `api-gateway/routes.ts` |
| Rate limits per route class; OTP tighter; safety never limited | Implemented (in-isolate), tested locally; production needs Cloudflare Rate Limiting rules or a Durable Object | `ratelimit.ts` |
| `Cache-Control: no-store` on every `/v1` response; origin internals dropped | Implemented, tested locally | `gateway.ts`, `headers.ts` |
| Errors never reveal origin addresses, stack traces or config | Implemented, tested locally | `envelope.ts` |
| WAF managed rules, bot protection | Pending deployment (account plan) | `CLOUDFLARE_SETUP.md` |
| Network-level origin protection (Tunnel, IP allowlist or Authenticated Origin Pulls) | Pending provider selection | `API_GATEWAY.md` |

### Storage (R2)

| Control | Status | Where |
|---|---|---|
| Separate private and public buckets per environment; no public access or `r2.dev` on private buckets | Configured (definitions) | `infra/cloudflare/r2/buckets.json` |
| Presigned URLs only from server code; R2 keys never in clients | Implemented, tested locally | `src/r2/sigv4.ts`, upload-signer |
| Caller identity from a signed gateway assertion (≤ 60 s), not the client's word | Implemented, tested locally | `src/r2/assertion.ts` |
| Server-generated object keys; no user filename or phone in keys | Implemented, tested locally | `objectKeyFor` |
| Extension + MIME + magic-byte + size + SHA-256 checks; quarantine first | Implemented, tested locally | `files/validate.ts`, `service.ts` |
| Malware scan before anyone can read; fail closed with no scanner | Implemented (interface + `PendingScanner`); scanner pending provider | `files/service.ts` |
| Single-use completion; client "done" not authoritative | Implemented, tested locally | `completeUpload` |
| Private download: owner or staff with a reason (audited), 60 s URL, `private, no-store` | Implemented, tested locally | `getDownloadAccess` |
| CORS explicit origins, no `*` | Configured | `r2/cors.*.json` |
| Destructive lifecycle rules | Not applied; cleanup rules proposed for staging only | `r2/lifecycle.proposed.json` |

### Web hosting (Vercel)

| Control | Status | Where |
|---|---|---|
| CSP (enforced), HSTS, `X-Frame-Options: DENY`, Permissions-Policy, COOP, nosniff | Configured; tested in Chromium with the headers applied; pending deployment | `apps/web/vercel.json` |
| Admin: strict CSP, noindex, no-cache `index.html` | Configured, tested in Chromium; pending deployment | `apps/admin/vercel.json` |
| No proxy in front of Vercel (DNS-only records) | Configured (plan) | `dns/records.proposed.json` |

### Admin and operations

| Control | Status |
|---|---|
| Role permissions, approvals, audit trail | Simulated in the admin prototype (UI-side) |
| MFA for staff and a recent MFA check for traffic changes | **Simulated** (UI step); real MFA pending auth provider |
| Second approver for production traffic changes; proposer can't approve | Implemented in `traffic/changes.ts`, tested locally; server enforcement pending |
| Traffic changes recorded as audit events with reason | Implemented (contract), simulated |

The admin must not hold real personal data until the backend enforces permissions, MFA and audit
server-side (INFRASTRUCTURE_AUDIT R10).

## Secrets

- **Server-only names:** `SECRET_ENV_NAMES` in `infra/env.ts`, plus the Worker secrets `ORIGIN_AUTH_SECRET`,
  `GATEWAY_ASSERTION_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Full list in
  `ENVIRONMENT_CONFIGURATION.md` and `INFRASTRUCTURE_REPORT.md` §6.
- **Where they go:** `wrangler secret put` per environment (Cloudflare), Vercel project env vars for any
  server-side function (none today), the backend's secret manager (pending). Never in git, `.env.example`,
  `wrangler.*.toml`, or any `EXPO_PUBLIC_` / `VITE_` / `NEXT_PUBLIC_` variable.
- **Separation:** different values for development, staging and production; R2 tokens scoped to the buckets
  of one environment.
- **Rotation:** the Supabase service_role key and the GitHub token shared in chat on 2026-10-22 must be
  rotated (owner action; not in the repo).
- **Check:** `npm run check:env -- <env file>` before every deploy (DEPLOYMENT_RUNBOOK.md).

## CORS is not authentication

CORS only tells browsers which origins may read a response. Native apps don't send `Origin` at all. Every
request is authorised by the backend (session + object ownership) and every R2 access by a signature issued
after an authorisation check.

## Payments and PCI DSS scope

Launch payment methods are Wallet and bank transfer, with no cards (D-023). If cards are added through
Paystack's hosted checkout or SDK, card data never touches GoBye systems, which keeps GoBye to the smallest
PCI DSS self-assessment scope. GoBye still owns: webhook signature verification, idempotent charge creation,
reconciliation and never showing "paid" before the provider confirms (D-030). Pending backend.

## Data protection (NDPA)

- Minimise: masked ID numbers in shared views; coordinates rounded in logs (`redact`).
- Retention: proposals in `R2_STORAGE_ARCHITECTURE.md` need legal sign-off (Q-071).
- Breach response: credentials rotation and access-log review procedures in `BACKUP_DISASTER_RECOVERY.md`;
  NDPC notification duties to be confirmed by counsel.
- Data location: R2 location hints and backend region to be chosen with the provider (Q-064).
