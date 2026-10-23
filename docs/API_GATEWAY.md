# API gateway — `https://api.gobye.app/v1` (D-051)

| Part | Status |
|---|---|
| Gateway Worker code (`infra/cloudflare/src/workers/api-gateway/`) | **Implemented, tested locally** (vitest, simulated origins) |
| Wrangler template (`wrangler.api-gateway.toml`) | **Configured (template)** — placeholders only |
| Deployment to Cloudflare (staging or production) | **Pending deployment** — needs a backend origin and owner approval |
| Backend origins | **Pending provider selection** — none exist, so every `/v1` route answers `503 backend_not_configured` |
| Production rate limiting across isolates | **Future enhancement** (Cloudflare Rate Limiting rules or a Durable Object) |

## Why a gateway

The rider app, driver app and admin only ever know one address: `https://api.gobye.app/v1` (staging:
`https://api-staging.gobye.app/v1`). Which backend answers is configuration at the edge (`ORIGINS_JSON` +
`TRAFFIC_POLICY`, later a Cloudflare Load Balancer). Changing or adding a backend provider never needs a new
app build or website deployment.

**The gateway is one layer, not the security model.** It checks that a bearer token is *present*, sizes,
methods and rates. The backend must still authenticate the token, authorise the action, check ownership
(a rider only sees their own trips, a driver only their assigned trip) and enforce every business rule
(fares, offers, payments). CORS is not authentication.

## Request flow

```
app ──HTTPS──▶ Cloudflare edge (TLS, WAF, rate-limit rules) ──▶ gobye-api-gateway Worker
                 1. new X-Request-Id (client's id kept as X-Client-Request-Id if well-formed)
                 2. route → route class (table below); unknown version → 404 unsupported_api_version
                 3. method allowlist → 405; bearer present on protected classes → 401
                 4. per-class + per-client rate limit → 429 + Retry-After (safety never limited)
                 5. body ≤ class limit → 413; JSON only, must parse → 400
                 6. traffic policy + origin health → pick origin (or 503 with Retry-After)
                 7. forward allowlisted headers + X-Forwarded-For = CF-Connecting-IP + signed X-Gobye-Origin-Auth
                 8. per-class timeout → 504 (writes are never replayed)
                 9. response: Cache-Control no-store, security headers, origin internals dropped
               ──HTTPS (Full strict)──▶ origin (rejects requests without a valid origin signature)
```

## Route classes

| Path | Route class | Auth | Body limit | Timeout | Edge rate limit (per client) |
|---|---|---|---|---|---|
| `/v1/auth/*` | auth | no | 8 KB | 10 s | 20/min; `/v1/auth/otp` also 5 per 5 min |
| `/v1/users/*` | users | yes | 32 KB | 10 s | 120/min |
| `/v1/drivers/*` | drivers | yes | 64 KB | 10 s | 120/min |
| `POST /v1/rides` | rides_create | yes | 16 KB | 10 s | 10/min |
| `/v1/rides/{id}/*` (and `GET /v1/rides`) | rides_active | yes | 16 KB | 8 s | 600/min (location updates) |
| `/v1/fares/*` | fares | yes | 16 KB | 8 s | 60/min |
| `/v1/offers/*` | offers | yes | 8 KB | 8 s | 30/min |
| `/v1/payments/*` | payments | yes | 16 KB | 15 s | 20/min |
| `/v1/files/*` | files | yes | 8 KB (metadata only; uploads go straight to R2) | 10 s | 30/min |
| `/v1/notifications/*` | notifications | yes | 8 KB | 8 s | 120/min |
| `/v1/support/*` | support | yes | 32 KB | 10 s | 60/min |
| `/v1/safety/*` | safety | yes | 32 KB | 10 s | **never limited at the edge** |
| `/health/live`, `/health/ready` | answered by the gateway | no | — | — | — |

Limits are provisional and live in `routes.ts`. They're split by class so a flood of booking or OTP requests
can't block trips in progress or safety. The in-isolate limiter is per Worker instance (a first line and a
test double); production needs Cloudflare Rate Limiting rules or a Durable Object counter.

## Responses (shared with the apps' API client)

- Success: `{ "data": …, "requestId": "…" }`
- Error: `{ "error": { "code", "message", "requestId", "retryAfterSeconds"?, "details"? } }`

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request`, `invalid_json` | non-JSON body, unparseable JSON |
| 401 | `unauthenticated` | no / malformed bearer token on a protected class |
| 403 | `forbidden` | reserved for the backend |
| 404 | `not_found`, `unsupported_api_version` | unknown route, `/v2/…` |
| 405 | `method_not_allowed` | with `Allow` |
| 413 | `payload_too_large` | over the class limit |
| 429 | `rate_limited` | with `Retry-After` |
| 502 | `upstream_error` | origin unreachable or 5xx (origin body replaced) |
| 503 | `backend_not_configured`, `no_healthy_origin`, `temporarily_unavailable`, `service_unavailable` | no origins; all unhealthy; maintenance/emergency policy; origin 503 — always with `Retry-After` |
| 504 | `gateway_timeout` | origin too slow. The message tells the client to **check status before retrying** |

Error bodies never contain origin addresses, stack traces or configuration (tested).

## Retry, idempotency and timeouts

- A failed **read** may be retried once on another origin.
- A **write** is retried on another origin only if it carries an `Idempotency-Key` (8–128 chars) **and** the
  first origin refused the connection (it never received it). A timed-out write is **never** replayed: it
  may have succeeded. The client looks up the authoritative status by its idempotency key instead
  (bookings, offers, payments). See `canRetryOnAnotherOrigin` in `packages/core/src/traffic/select.ts`.

## Headers

- Forwarded from the client (allowlist): `Authorization`, `Content-Type`, `Accept`, `Accept-Language`,
  `User-Agent`, `Idempotency-Key`, `If-Match`, `If-None-Match`, `X-App-Version`, `X-Platform`.
- Never forwarded: `X-Forwarded-*`, `Forwarded`, `X-Real-IP`, `X-User-*`, `X-Gobye-*`, `X-Admin-*`,
  `Cookie`, `CF-*` from the client. The gateway sets `X-Forwarded-For` from `CF-Connecting-IP` only.
- Added: `X-Request-Id`, `X-Forwarded-Proto: https`, `X-Forwarded-Host`, `X-Gobye-Route-Class`,
  `X-Gobye-Origin-Auth: t=<ms>,sig=<HMAC-SHA256(ORIGIN_AUTH_SECRET, requestId.t.METHOD.pathAndQuery)>` (method and path bound since 2026-10-23; the API also refuses a repeated request id within 60 s).
- Response: only `Content-Type`, `ETag`, `Retry-After`, `Location`, `Content-Language` pass through;
  `Server`, `X-Powered-By`, `Set-Cookie` etc. are dropped. Always `Cache-Control: no-store`, `nosniff`,
  `X-Frame-Options: DENY`, `CSP default-src 'none'`, HSTS.

## Origin protection

Origins must reject requests without a fresh, valid `X-Gobye-Origin-Auth` (`verifyOriginRequest` in
`originAuth.ts` is the reference). Add network-level protection where the chosen provider allows:
Cloudflare Tunnel (no public origin address), firewall allowlist of Cloudflare IP ranges, or
Authenticated Origin Pulls (mTLS). TLS mode is Full (strict).

## Health

- `GET /health/live` — the gateway is running (`200 {data:{status:"ok"}}`).
- `GET /health/ready` — `200` only if at least one origin is usable, else `503`. No dependency details.
- Each **origin** must implement the same two endpoints; its `/health/ready` must check its critical
  dependencies (database etc.) and return 503 when it can't serve. Load-balancer monitors use it
  (`infra/cloudflare/load-balancer/monitors.proposed.json`).

## Logging

One JSON line per request: `ts, env, service, requestId, method, path (ids collapsed), status, durationMs,
routeClass, origin (id only), selection, outcome`. Never: tokens, query strings, bodies, IPs, origin addresses.

## Configuration

| Binding | Kind | Notes |
|---|---|---|
| `ORIGINS_JSON` | var | JSON array of `BackendOrigin` (https only). `[]` today |
| `TRAFFIC_POLICY` | var | `primary_only` (default) or a JSON `TrafficPolicy` |
| `ORIGIN_AUTH_SECRET` | **secret** (`wrangler secret put`) | per environment |
| `ENVIRONMENT`, `PUBLIC_HOST`, `ALLOWED_ORIGINS` | var | `ALLOWED_ORIGINS` e.g. `https://admin.gobye.app` |

## Deploy (when approved)

1. Backend origin(s) exist and implement `/health/*` and origin-signature checks.
2. `npx wrangler secret put ORIGIN_AUTH_SECRET --env staging`; set `ORIGINS_JSON` for staging.
3. `npx wrangler deploy -c infra/cloudflare/src/workers/api-gateway/wrangler.api-gateway.toml --env staging`,
   route `api-staging.gobye.app/*`. Run the checks in docs/INFRASTRUCTURE_TEST_PLAN.md.
4. Repeat for production with approval. Rollback: `npx wrangler rollback` (previous version).

Tests: `cd infra/cloudflare && npx vitest run test/gateway-routing.test.ts test/failover-gateway.test.ts`.
