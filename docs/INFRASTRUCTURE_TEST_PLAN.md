# Infrastructure test plan (D-051)

Each test from the infrastructure brief §18, where it lives, and the actual result. **Local** = automated test
against fakes or simulated origins in this repo. Local passes prove logic, **not** real Cloudflare, R2 or
failover behaviour; the "Staging" column lists what must be re-run once something is deployed.

## Commands

```bash
npm run typecheck                 # all workspaces
npm test                          # core (jest), rider, driver (jest), admin (vitest), infra/cloudflare (vitest)
npm run infra:test                # infra/cloudflare only
cd packages/core && npx jest src/__tests__/infra- src/__tests__/files- src/__tests__/traffic-
npm run check:env -- apps/rider/.env.local
```

## Results (2026-10-23)

| Suite | Result |
|---|---|
| `npm run typecheck` | 0 errors (core, ui, rider, driver, admin, infra/cloudflare) |
| core jest | **215** passed (17 suites) |
| rider jest | **36** passed |
| driver jest | **14** passed |
| admin vitest | **250** passed (18 files) |
| infra/cloudflare vitest | **41** passed (6 files) |

## File storage

| Brief case | Automated test | Local result | Staging |
|---|---|---|---|
| Valid upload | `files-service.test.ts` "valid upload: quarantined first…"; `upload-signer.test.ts` "valid upload: presigned PUT to R2…" | Pass | Upload a real file to `gobye-staging-private-uploads`, complete, download |
| Invalid upload (type) | `upload-signer` "invalid type and oversized uploads are refused before signing"; `files-validate-policy` "checks the claims" | Pass | — |
| Oversized upload | same | Pass | — |
| Expired upload authorisation | `files-service` "expired upload authorisation…"; `upload-signer` "expired authorisation…" | Pass | PUT after 5 min must be refused by R2 |
| Unauthorised upload | `files-service` "rejects unauthenticated callers…"; `upload-signer` "unauthorised: no assertion, a forged one, or a stale one is refused" | Pass | — |
| Missing file | `upload-signer` "missing / interrupted upload…" | Pass | — |
| Invalid file ownership | `files-service`/`upload-signer` "wrong owner can't complete…" | Pass | — |
| Failed upload completion | `upload-signer` "failed completion: a checksum R2 rejects, or content that isn't what was claimed"; `files-service` "size or content that doesn't match…" | Pass | **Confirm R2 enforces signed `x-amz-checksum-sha256` on presigned PUT** |
| Duplicate completion request | "…duplicate completion is refused" | Pass | — |
| Failed malware scan | `files-service` "infected files are quarantined…"; `upload-signer` "infected file…" | Pass | With the chosen scanner |
| No scanner connected | "with no scanner connected…" (both) | Pass (fail closed) | — |
| Interrupted upload | `files-service` "interrupted upload stays pending…" | Pass | — |
| Private file access rejection | `files-service` "private access: other users refused…"; `upload-signer` "private access…"; `media-gateway` "never serves private classes…" | Pass | Try a private key on `media.staging…` → 404 |
| SigV4 correctness | `r2-sigv4.test.ts` "matches the published AWS presigned-URL example" | Pass | First real presign against staging R2 |

## Network and API

| Brief case | Automated test | Local result |
|---|---|---|
| Successful routing | `gateway-routing` "forwards to the primary origin with the path, request id and a signed origin header" | Pass |
| Missing authentication | "missing or malformed auth on a protected route → 401…" | Pass |
| Unauthorised requests | Backend responsibility (403). Gateway reserves the code | Not yet (no backend) |
| Invalid payloads | "invalid JSON → 400; non-JSON body → 400; too large → 413; wrong method → 405" | Pass |
| Rate-limit responses | "rate limit → 429 with Retry-After; …safety is never limited" | Pass |
| Gateway timeout | `failover-gateway` "origin timeout → 504 and the write is not replayed" | Pass |
| Origin unavailable | "no backend configured yet: an honest 503"; "both origins down…" | Pass |
| Incorrect forwarded headers | "strips spoofed forwarding, identity and admin headers…" | Pass |
| Unsafe public caching | "responses are never cacheable and drop origin internals" | Pass |
| API version compatibility | "unknown API version and unknown routes get the standard envelope" | Pass |
| Client error model, retries, idempotency | `infra-env-http.test.ts` (API client block) | Pass |
| Env / secret checks | `infra-env-http` "refuses anything that looks like a secret…"; `check-env.test.ts` (3) | Pass |

## Failover — simulated only

| Brief case | Automated test | Local result |
|---|---|---|
| Primary unavailable | `traffic-routing` "primary down → traffic fails over…"; `failover-gateway` "primary marked unhealthy…" | Pass (simulated) |
| Secondary healthy | same | Pass (simulated) |
| Both unavailable | "both down → 503 with Retry-After"; "both origins down → 502…/503" | Pass (simulated) |
| Backend recovery | "a recovered origin ramps up gradually…"; "recovery: once the primary is healthy…" | Pass (simulated) |
| Partial network failure | "primary unreachable on a safe read → retried once on the secondary" | Pass (simulated) |
| Health-check instability | "one failed check does not flip traffic…"; "flapping checks never mark…" | Pass (simulated) |
| Active trip during transition | "an active trip keeps working when traffic moves…" (contract); "maintenance policy…trips in progress still route" | Pass (contract) |
| Duplicate payment after reconnection | "a payment resent after reconnecting is answered from the idempotency record…" | Pass (contract) |

**Real failover is not tested.** It needs two origins in staging and a monitor (LOAD_BALANCING_FAILOVER.md).

## Realtime and observability

`infra-observability-realtime.test.ts`: redaction of credentials, signed URLs, cards and tokens; masked IDs;
rounded coordinates; JSON logs; metrics/alerts interface; health public view; realtime connect with fresh
credentials, ordering, duplicate drop, gap → resync, jittered reconnect with new credentials, background /
offline pause and resume, unsupported versions, close. All pass (mock transport).

## Traffic switching

`traffic-changes.test.ts` (permission, MFA, reason, unsafe changes refused, second approver, stale proposal,
rollback) and `apps/admin/src/workspaces/infrastructure/logic.test.ts` (4): pass. The admin page is a
simulation.

## Frontend integration

| Brief item | Status |
|---|---|
| Website keeps working on Vercel with new headers | Checked in Chromium with the headers applied by a local server (fork report): page, video, waitlist dialog, footer canvas, Supabase request allowed, other hosts blocked. Fonts and cdnjs not reachable from this sandbox. **Re-check after deploy** |
| Existing functionality preserved | All previous app/admin tests still pass (numbers above) |
| API calls through centralised clients | `createApiClient` exists; apps still use mocks (no backend) |
| Meaningful errors, offline, recovery, no endless loaders, no silent retries of sensitive ops | Client tests (above). App wiring pending backend |
| Rider and driver share contracts | Both import `@gobye/core` services and infra |

## Not yet tested (needs deployment or providers)

Real R2 presigned PUT/GET and checksum enforcement; Worker deployment and routes; DNS/TLS; Cloudflare WAF and
rate-limit rules; real origin failover and LB monitors; realtime provider; malware scanner; backup restore
drills; CI.
