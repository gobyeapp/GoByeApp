# Traffic switching (D-051)

| Part | Status |
|---|---|
| Policies, change rules, audit contract, rollback (`packages/core/src/traffic/changes.ts`) | **Implemented, tested locally** |
| Admin page "Traffic and origins" (`apps/admin/src/workspaces/infrastructure/`) | **Implemented — Simulation.** A permanent banner says no production traffic changes |
| Live control plane (Cloudflare LB API or gateway config/KV) | **Future enhancement** — needs origins, credentials and approval |
| Server-side enforcement (permissions, MFA) | **Pending backend** — the admin's checks are UI-side until then |

## Policies

| Policy | Effect |
|---|---|
| Primary only | All new traffic → the highest-priority healthy origin; automatic failover to the next |
| Weighted | Split by weight across healthy origins (e.g. A 80 / B 20); recovered origins ramp up |
| Secondary only | New traffic → the second origin; falls back to the primary if it's unhealthy |
| Maintenance | **New bookings, fare quotes and offers paused** (`503 temporarily_unavailable`, `Retry-After: 120`). Trips in progress, safety and support keep working |
| Emergency restrictions | Switch off chosen operations (e.g. payments, file uploads). **Trips in progress, safety and support can never be switched off** |

Origin fields: id, endpoint (never shown to clients), region, provider label, health, weight, priority,
maintenance (drained), version, last healthy, last failover.

## Who can change it, and how

1. **Permission** `infra.traffic.manage` (admin preview maps it to owner / admin / developer; auditors can view).
2. **Recent MFA** (within 10 minutes) for the person proposing *and* the person approving.
3. **Reason** (10+ characters), saved in the audit event.
4. **Production needs a second person** who is not the proposer. Staging applies on the proposer's authority.
5. **Stale proposals refused**: a change proposed against version N can't apply to version N+1.
6. **Confirmation** dialog stating the effect.
7. **Audit event** per change: who, when, environment, reason, before/after version and policy, `simulated`.
8. **Rollback** to the previous version: needs permission, MFA and a reason, but no second approver (it is
   the safe direction and must be fast).

The public website and apps can never change routing. The control plane must enforce all of the above
server-side once a backend exists; the admin page is not the authority.

## Simulation vs production

`SimulatedControlPlane.live === false` and every result and audit event carries `simulated: true`. The admin
page shows "Simulation — no production traffic is changed", labels history entries "Simulated", and starts
with **no origins** (backend pending). "Load example origins (simulation)" adds two clearly fake origins
(`*.example.invalid`) to rehearse the flow. A live adapter will implement the same `TrafficControlPlane`
interface and must report `live: true`.

## Runbook (once live)

- **Primary failing:** check `/health/ready` and logs → if not auto-failed-over, propose "Secondary only"
  with the incident reference → second approver → watch error rates → when fixed, propose "Weighted 10/90"
  then back to "Primary only".
- **Database maintenance:** "Maintenance" during the window (active trips continue), then roll back.
- **Payment provider outage:** "Emergency" with Payments off; trips continue; payments stay pending
  (never shown as paid) and are reconciled later.
