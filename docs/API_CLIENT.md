# API client, error model, retries and idempotency (D-051)

The rider app, driver app and admin will call the backend through one client:
`createApiClient` in `packages/core/src/infra/http.ts`. **Status: implemented and tested locally against a
fake fetch. No backend exists (Pending provider selection); the apps still use the simulated services in
`packages/core/src/mocks/services.ts`, which implement the same service interfaces
(`packages/core/src/services/types.ts`).**

## Calling convention

```ts
const api = createApiClient({ baseUrl: publicConfig.apiBaseUrl, getToken, isOnline, logger, client: 'rider/0.1.0' });
const r = await api.post<Ride>('/rides', body, { idempotencyKey: newIdempotencyKey('booking') });
if (!r.ok) showError(r.error.message); // switch on r.error.kind, never on raw status
```

- Base URL is the stable public address (`https://api.gobye.app/v1`), never an origin server.
- Every call returns `ApiResult<T>`; nothing throws for HTTP or network failures.
- A success body `{ data, meta? }` is unwrapped to `data`.

## Headers sent

| Header | When |
|---|---|
| `x-request-id` | Always (same id across automatic retries of one call; echoed by the gateway) |
| `Authorization: Bearer …` | When signed in and not `anonymous` (token fetched per call, so refreshes apply) |
| `Idempotency-Key` | On creates that move money or commit a driver |
| `x-client` | `rider/<version>`, `driver/<version>`, `admin/<version>` |
| `Content-Type: application/json` | With a body |

## Error model (`ApiError.kind`)

| kind | From | User message (default) |
|---|---|---|
| validation | 400, 413, 422 (`details` per field) | Check the highlighted details and try again. |
| unauthenticated | 401 | Your session has ended. Sign in again. |
| forbidden | 403 | You don’t have access to this. |
| not_found | 404 | We couldn’t find that. |
| conflict | 409 (`quote_expired`, `idempotency_conflict`, …) | This changed while you were on it… |
| rate_limited | 429 (+ `retryAfterSeconds`) | Too many attempts… |
| unavailable | 502, 503 (incl. maintenance) | GoBye is temporarily unavailable… |
| timeout | 504 or client timeout | This is taking longer than usual… |
| offline | `isOnline()` false | You’re offline… |
| network | connection failed | We couldn’t reach GoBye… |
| server | other 5xx, unreadable success body | Something went wrong on our side… |

The server's envelope `{ error: { code, message, requestId, retryAfterSeconds?, details? } }` is defined
once in `infra/health.ts` (shared with the gateway); its `message` is shown when present. `requestId` is
shown in support flows.

`ambiguous: true` marks a write that may have reached the server (client timeout, connection cut after
sending, 504). See below.

## Retry rules

| Request | Automatic retries | On |
|---|---|---|
| GET / HEAD | up to 2 | network error, timeout, 502, 503, 504 |
| POST / PATCH / PUT / DELETE **with** Idempotency-Key | up to 1 | same |
| Writes **without** a key | **never** | – |
| Any 4xx (except 429 handled by the caller) | never | – |

Delay: `Retry-After` when present (capped), otherwise full-jitter exponential backoff
`random × min(8 s, 400 ms × 2^attempt)`. Offline fails immediately (no retry loop while offline).

## Idempotency and ambiguous writes (`infra/idempotency.ts`)

- `newIdempotencyKey(scope)` once per user intent (booking, offer, counter, select_driver, payment,
  wallet_topup, withdrawal, cancel, upload). Persist it with the pending action so a relaunch reuses it.
- The backend must store key → result and return the stored result for repeats; a different body with
  the same key is `409 idempotency_conflict` (BACKEND_HANDOVER.md).
- After an ambiguous booking/payment, call `resolveAmbiguous(() => api.get('/rides/by-key/' + key))`:
  `succeeded` → use it; `not_found` → safe to resubmit **with the same key**; `unknown` → keep showing
  "Checking your booking…", never "failed". This matches the existing rule that an unconfirmed payment
  is *pending*, not failed (D-030).
- Quotes: `assertQuoteFresh(quote, now, expectedVersion)` before booking; a stale quote is re-fetched,
  never patched locally.
- Agreed fare: `lockedFare(serverAgreed, clientComputed)` refuses any client-side difference. After
  matching the fare shown is the server's; route changes go through a separate fare-adjustment request
  the rider approves.

## Logging

Each call logs one `api.request` event (route with ids replaced, method, outcome, duration, attempts,
error kind/code/status). Tokens, bodies and signed URL parameters are never logged (see
MONITORING_OBSERVABILITY.md for redaction).

## Tests

`packages/core/src/__tests__/infra-env-http.test.ts`: headers, envelope and Retry-After mapping, no retry
for unkeyed writes, GET retry with backoff, keyed write retried on 504 but not 409, timeout (ambiguous),
offline, non-JSON body, log redaction, backoff bounds, ambiguous booking resolved by lookup,
idempotency keys, quote freshness, locked fare.
