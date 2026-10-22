# Realtime architecture (D-051)

| Item | Status |
|---|---|
| Provider-agnostic client `createRealtimeClient` (`packages/core/src/infra/realtime.ts`) | Implemented, tested locally with a mock transport |
| Mock transport (drop / duplicate / reorder / disconnect / refuse) | Implemented (tests) |
| Realtime provider / server (WebSocket service, Durable Objects, a managed pub/sub, …) | Pending provider selection |
| Connected demo (D-049) | Simulated: polling the demo relay every 2–3 s, not this client |
| Wiring into the rider / driver apps | Future (after a provider exists) |

## What travels in realtime

| Channel (`realtimeChannels`) | Events | Who may subscribe (server-enforced) |
|---|---|---|
| `trip:<rideId>` | matched, driver location, arrived, started, completed, cancelled, fare adjustment | The rider and the assigned driver of that ride; staff with `live.view` |
| `driver:<driverId>:requests` | incoming Quick Match requests, offers to answer, request withdrawn | That driver only, while online and approved |
| `ride:<rideId>:offers` | driver accepts / counters for a negotiated ride | The rider of that ride |
| `user:<userId>` | account notices, verification decisions, payment confirmations | That user |

Nearby-driver discovery for riders is **not** a live feed of driver positions: the server returns coarse,
delayed availability per area so drivers can't be tracked (THREAT_MODEL.md).

## Wire format

Client → server: `auth {token}`, `subscribe {channel, sinceSeq?}`, `unsubscribe`, `ping`.
Server → client: `event {channel, seq, type, version, at, data}`, `subscribed {channel, seq}`,
`denied {channel, reason}`, `auth_expired`, `pong`.

- `seq` increases by 1 per channel and is assigned by the server when the event is stored.
- `version` is the schema version of `data`; the client refuses versions above `supportedVersion`.

## Client behaviour

| Situation | Behaviour |
|---|---|
| Connect | `getCredentials()` for a short-lived token **every** connect, then `auth`, then `subscribe` each channel from its last `seq` |
| Disconnect | `reconnecting` with full-jitter backoff (0.5 s × 2^n, cap 30 s); no storm |
| Offline (`setNetworkAvailable(false)`) | Close and wait in `offline`; reconnect immediately when back |
| Background (`setAppActive(false)`) | Close and wait in `idle` (saves battery; the driver's location upload is a separate, permissioned path, D-026) |
| Resume / back online | Reconnect and call `resync(channel, lastSeq)` for every channel |
| Duplicate event (`seq` ≤ last) | Dropped |
| Out of order | Buffered and delivered in order |
| Gap not filled within 1.5 s | `resync` → authoritative state from the API, continue after its `seq` |
| `subscribed.seq` ahead of us | `resync` (we missed events while away) |
| Unknown schema version / failed `validate` | Dropped and logged; unknown version triggers `resync` |
| `denied` | Subscription removed, `onDenied(reason)` (UI falls back to polling the API or shows an error) |
| `auth_expired` | Reconnect with fresh credentials |

**Trip state never lives only in the socket.** The backend's ride record is the source of truth; the
socket is a hint to re-render quickly. `resync` is a normal API read (`GET /v1/rides/:id`), so a
dropped connection, a failover or an app restart all recover the same way.

## Security requirements for the future server

- Authenticate the socket with a short-lived token (minutes), scoped to the user; refuse anonymous.
- Authorise **every** subscribe against ownership: rider ↔ own ride, driver ↔ assigned ride / own
  request feed. A driver must never receive another driver's trips; a rider never another rider's
  location. Re-check on reconnect and when a ride changes driver.
- Validate every inbound frame; cap message size and rate per connection and per user.
- Revoke: closing a session or banning a user closes their sockets (`auth_expired`).
- Location events carry only what the counterpart needs during the trip; stop after completion.

## Load balancing and deploys

Prefer stateless socket servers with state in the database / a pub/sub, so any instance can serve any
client after reconnect (no permanent sticky sessions). During deploys, drain: stop accepting new sockets,
send close frames, let clients reconnect elsewhere (they resync). Cloudflare proxies WebSockets; confirm
idle timeouts and plan limits when the provider is chosen (LOAD_BALANCING_FAILOVER.md).

## Incidents

Alert `realtime-instability` (MONITORING_OBSERVABILITY.md). If realtime is down, apps keep working by
polling the ride every few seconds (degraded mode); safety and support stay reachable.

## Tests

`packages/core/src/__tests__/infra-observability-realtime.test.ts`: connect/auth/subscribe, ordering,
duplicates, gap → resync, reconnect with backoff and new credentials (resubscribe from last seq),
background/offline pause and resume with resync, unsupported version, failed validation, denied
subscription, expired auth, close.
