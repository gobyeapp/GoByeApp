# Security review, 2026-11-27

Scope: the GoBye API (`apps/api`) after rides (D-100), money (D-101) and outside connections (D-103) were
added, the Cloudflare gateway's routing, and the repository. Method: reading the code against the threat
model, then turning each property into an automated test so it keeps holding. **Limits:** everything ran
on a laptop-style PostgreSQL with stand-in providers. Nothing was tested on the deployed gateway, against
Paystack, Google, Termii, QoreID or Expo, or on a phone. This is a developer's review, not an independent
penetration test; one should be commissioned before real money moves.

## What was checked, for every route

`apps/api/test/security.test.ts` reads the list of routes from the running server, so a new route can't
be missed.

| Property | Result |
|---|---|
| No answer without a valid sign-in (no token, expired, forged signature, another issuer, "alg none") | Holds for all non-public routes |
| The only public routes are health checks and three webhooks | Holds |
| Webhooks refuse unsigned or wrongly signed requests, and a rider's token doesn't help | Holds |
| Staff routes refuse riders, staff without a second factor, suspended staff, and tokens that only claim to be staff | Holds |
| Errors never show SQL, file paths, connection strings or stack traces, whatever is sent (injection strings, prototype pollution, huge numbers, broken JSON) | Holds; no 5xx was produced |
| Every route that changes something takes an Idempotency-Key | Holds, with two documented exceptions (driver presence and position: overwrite-one-row PUTs) and the provider callbacks (de-duplicated by event id) |
| SQL is never built from request text | Holds (parameters only) |
| No secret, sign-in code or PIN reaches logs, audit rows or job payloads | Holds |
| The gateway routes every API route, with the same answer to "does it need a sign-in?" | Holds after fixes (below) |

## Findings and what was done

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | The gateway did not list `/v1/staff/*` (driver application review, built earlier), so those routes would have answered 404 in production | Medium (availability) | Fixed; the gateway now checks itself against the API's route list (`apps/api/routes.snapshot.json`) |
| 2 | New areas (`quotes`, `places`, `wallet`) were not in the gateway's list | Medium (availability) | Fixed; prices and place lookups use the tight "fares" limit, wallet uses "payments" |
| 3 | Staff ride and finance routes were first placed under `/v1/admin/*`, which the gateway deliberately refuses | Low | Moved to `/v1/ops/*` |
| 4 | The SMS hook was first placed outside the gateway's webhook class | Low | Moved to `/v1/webhooks/auth/send-sms` |
| 5 | Asking for prices cost a maps call with no per-person limit | Medium (cost) | Fixed: 20 a minute per rider, plus the gateway limit |
| 6 | A stolen driver account could change the bank account and withdraw at once | High once money is on | Fixed: no withdrawal for 24 hours after a change; changes are audited; staff still approve |
| 7 | An account holding money or with an open ride could be deleted | Medium | Fixed: deletion is refused (with the reason) until it is settled, and the deletion job checks again |
| 8 | A debit against an existing balance failed (PostgreSQL checks the proposed row before merging) | Functional, found by tests | Fixed before any release |
| 9 | `react-router` in the admin had published advisories (open redirect, unsafe deserialisation) | High (advisory) | Updated to 7.18.7; admin tests (418) and build pass |
| 10 | `expo-router` pulls in a `query-string` with an advisory | Low (runs on the phone) | Accepted until the SDK 58 upgrade |
| 11 | The website's Supabase anon key is in git | None | Expected: it is the public key, limited to inserting waitlist rows |

## Idempotency, audit and ledger (asked for specifically)

- **Idempotency:** the key and the change are written in one transaction; the same key with the same
  request replays the stored answer; with a different request it is refused. Tested for booking, top-ups,
  wallet payment and staff actions. Provider references make journals idempotent a second time at the
  database level (`unique (kind, reference)`).
- **Audit:** every state change that matters writes an audit row in the same transaction: booking, match,
  fare lock, trip end, payment claim and confirmation, cancellations (with who and why), payout account
  changes, top-ups, withdrawals (request, approve, reject, paid), refunds (request, approve), identity
  results, receipt settings. Audit and ride events are append-only in the database. Position updates are
  deliberately not audited.
- **Ledger:** append-only; a journal that doesn't sum to zero can't commit; balances can't go below zero;
  a daily job re-adds everything. After the whole money test run, the integrity report is clean.

## Still open (not code)

1. An independent penetration test before real money.
2. The four reviews in BACKEND_ARCHITECTURE §9 (finance, reconciliation, provider test mode, security).
3. Real-provider runs: Paystack test mode, a Google key, Termii, QoreID, Expo push on a device.
4. The deployed path: gateway signature, rate limits and WAF rules on the real domain.
5. Policy: whether refunds are ever charged back to a driver; data retention periods (Q-071, Q-073).
6. No virus scanner is chosen, so uploaded files stay "checking" and identity checks wait (fail closed).
