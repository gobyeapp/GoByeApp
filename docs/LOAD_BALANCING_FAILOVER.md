# Load balancing and failover (D-051)

| Part | Status |
|---|---|
| Origin model, health tracking with hysteresis, selection, recovery ramp (`packages/core/src/traffic`) | **Implemented, tested locally** (jest) |
| Gateway failover between origins (`infra/cloudflare/src/workers/api-gateway`) | **Implemented, tested locally with simulated origins** (vitest) — *not* real failover |
| Cloudflare Load Balancer pools / monitors | **Proposed templates only** (`infra/cloudflare/load-balancer/`). Paid add-on: verify on the account and get approval |
| Second backend origin | **Pending provider selection** — there isn't a first one yet |

## How failover works (gateway, and later Cloudflare LB)

1. **Detect:** monitors call each origin's `GET /health/ready` (every 60 s proposed). The origin must check its
   critical dependencies and answer 503 when it can't serve.
2. **Threshold:** `OriginHealthTracker` — 3 consecutive failures → `unhealthy`; 1 failure → `degraded`
   (still used); slow (>1.5 s) → `degraded`; 2 consecutive successes → healthy again. One bad check never
   moves traffic; flapping never marks an origin down (tested).
3. **Remove** unhealthy / drained origins from new-traffic selection.
4. **Route** new requests to the next origin by priority (or by weight under the weighted policy).
5. **Preserve state:** bookings, trips, offers and payments live in the database, not in an origin, so a
   trip in progress keeps working when traffic moves (contract test).
6. **Reconnect:** realtime clients reconnect with backoff and resynchronise from the authoritative state
   (docs/REALTIME_ARCHITECTURE.md).
7. **Record** a health transition event (`OriginHealthEvent`) and the failover time on the origin.
8. **Notify** operators (alert policy in docs/MONITORING_OBSERVABILITY.md).
9. **Recover gradually:** a recovered origin's weight ramps from 10% to 100% over 5 minutes.

When **no** origin is usable: `503 no_healthy_origin` with `Retry-After: 30`. When no origin is configured:
`503 backend_not_configured` (today's state).

## Never replay uncertain operations

The gateway never re-sends a booking, driver assignment, offer or payment to another origin unless it carries
an `Idempotency-Key` **and** the first origin refused the connection. A timeout is treated as "maybe
succeeded": the client checks the authoritative status with its idempotency key. A payment resent after a
reconnect is answered from the idempotency record, not charged twice (contract test).

## Routing failover is not database failover

Moving traffic between origins only helps if the *origin* failed. If both origins use the same database and
that database is down, failing over restores nothing — both answer 503 on `/health/ready`. Real high
availability needs, per the backend chosen:

- a database with a replica / standby in another zone or region, automated failover and tested promotion;
- application state outside the process (database, cache, queue), so any origin can serve any user;
- realtime state externalised (pub/sub), with resumable subscriptions instead of sticky sessions;
- payment provider webhooks idempotent and replayable;
- backups and restore drills (docs/BACKUP_DISASTER_RECOVERY.md).

Until those exist, GoBye should not claim high availability.

## Session affinity

None. State is in the database; clients reconnect and resync. Sticky sessions would hide failures and break
draining.

## Draining

Set an origin's `maintenance: true` (traffic switcher "Drain origin"): it gets no new requests; in-flight
requests finish; realtime clients are told to reconnect and land on another origin.

## Tests (all simulated)

- core `src/__tests__/traffic-routing.test.ts`: primary down → secondary; both down → 503; recovery ramp;
  hysteresis/flapping; weighted split; maintenance/emergency; no replay without idempotency; active trip
  during transition; duplicate payment after reconnect.
- `infra/cloudflare/test/failover-gateway.test.ts`: unhealthy primary → secondary; refused connection → one
  retry for reads / idempotent writes; booking POST not replayed; timeout → 504 without replay; both down;
  recovery; origin 5xx bodies sanitised; maintenance blocks new bookings only.

Passing these proves the logic, **not** real failover. Real failover is tested only after two origins exist
in staging (docs/INFRASTRUCTURE_TEST_PLAN.md).
