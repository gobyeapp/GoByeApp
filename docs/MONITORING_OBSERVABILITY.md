# Monitoring and observability (D-051)

| Item | Status |
|---|---|
| Structured JSON logger with redaction (`createLogger`, `redact`, `packages/core/src/infra/observability.ts`) | Implemented, tested locally |
| Metrics interface + in-memory implementation (`Metrics`, `memoryMetrics`) | Implemented, tested locally |
| Provisional SLOs (`PROVISIONAL_SLOS`) and alert policies (`ALERT_POLICIES`) | Implemented as data; thresholds are **proposals** |
| Alert channel (`AlertSink`) | Interface only; no channel connected (Pending provider) |
| Log store, metrics backend, dashboards, error tracking | Pending provider selection |
| Production data | None yet; no reliability figures are claimed |

## Log event shape

```json
{ "ts": "2026-10-23T00:00:00.000Z", "env": "production", "service": "gateway", "level": "error",
  "event": "origin.failed", "requestId": "req_…", "correlationId": "…", "outcome": "failure",
  "durationMs": 31, "error": { "kind": "unavailable", "code": "origin_unavailable" } }
```

Services: `rider`, `driver`, `admin`, `website`, `gateway`, `media-gateway`, `upload-signer`, and the
future backend. One `requestId` flows from the app (`x-request-id`) through the gateway to the origin;
`correlationId` ties several requests of one user action (e.g. booking + payment).

## Never logged (enforced by `redact` before any sink)

- Fields named password, pin, pickup PIN, otp code, token (access / refresh / id), authorization,
  cookie, secret, api key, signature, card number / PAN / CVV, private key, session → `[redacted]`.
- ID numbers (NIN, BVN, licence, passport, account number) → last four only.
- Signed URL parameters (`X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`, `token=`,
  `sig=`, …), Bearer/Basic credentials, JWTs, card-like numbers, `sk_live_`/`sk_test_`, GitHub tokens,
  `AKIA…` keys inside any string.
- Coordinates rounded to 3 decimal places (~110 m). Full location histories are not logged at all; trip
  routes belong in the trip record with its retention rule.
- Request and response bodies are not logged by the API client.

## Metrics

`api_requests_total`, `api_request_duration_ms`, `api_errors_total`, `auth_failures_total`,
`uploads_total`, `upload_failures_total`, `storage_bytes`, `proxy_errors_total`, `origin_health`,
`matching_failures_total`, `realtime_disconnects_total`, `queue_failures_total`,
`deployment_failures_total`. Labels: route (ids replaced), method, status class, origin, environment.

## Provisional service levels (to be reviewed after launch with real data)

| SLO | Target (proposal) |
|---|---|
| API availability | 99.5% of /v1 requests non-5xx per 30 days |
| API latency | p95 < 800 ms reads, < 1.5 s booking creation (7 days) |
| Realtime | 99% of trip events delivered within 3 s |
| Uploads | 99% complete or fail with a clear reason (7 days) |

## Alert policies (provisional thresholds)

| Policy | Condition | Severity | Runbook |
|---|---|---|---|
| Backend origin unavailable | origin health 0 for 2 checks (60 s) | page | LOAD_BALANCING_FAILOVER.md |
| Elevated 5xx | > 2% over 5 min, min 200 requests | page | DEPLOYMENT_RUNBOOK.md |
| Repeated auth failures | > 50 / 5 min from one network or > 500 overall | ticket | INFRASTRUCTURE_SECURITY.md |
| R2 upload failures | > 5% over 15 min, min 20 | ticket | R2_STORAGE_ARCHITECTURE.md |
| Unexpected storage growth | > 3× 7-day daily average in 24 h | ticket | R2_STORAGE_ARCHITECTURE.md |
| Traffic spike | > 5× same hour last week for 10 min | ticket | INFRASTRUCTURE_SECURITY.md |
| Realtime instability | disconnects > 3× baseline, or > 5% active trips without location for 60 s | page | REALTIME_ARCHITECTURE.md |
| Payment failures | > 10% over 15 min (min 20), or webhook signature failures | page | BACKUP_DISASTER_RECOVERY.md |
| Failed deployment | any failure, or readiness failing 5 min after release | ticket | DEPLOYMENT_RUNBOOK.md |
| Unhealthy LB pool | healthy origins below pool minimum for 2 min | page | LOAD_BALANCING_FAILOVER.md |

"page" = wake someone; "ticket" = next working hours. No fake production alerts are generated; the
admin's simulated views are labelled as simulations.

## Where it will run (Pending provider)

Candidates once the backend is chosen: Cloudflare Workers Logs / Logpush for edge Workers, the
backend host's log drain, an error tracker (e.g. Sentry) for apps and website, and a metrics backend.
Each needs NDPA-compliant retention (logs 30 days by default; security/audit logs longer, see
BACKUP_DISASTER_RECOVERY.md).

## Tests

`packages/core/src/__tests__/infra-observability-realtime.test.ts` (redaction, log shape and levels,
metrics, policies, error-rate rule, alert sink) and `infra-env-http.test.ts` (API client never logs tokens,
bodies or signed URLs).
