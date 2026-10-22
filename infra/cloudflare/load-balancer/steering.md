# Steering and failover notes (PROPOSED)

Status: **Future enhancement / pending provider selection and approval.**

- Start with **failover by pool order** (primary, then secondary). Use weighted steering only for planned rollouts (e.g. 90/10 → 50/50 → 0/100), changed through the audited traffic switcher (docs/TRAFFIC_SWITCHING.md).
- Thresholds mirror the gateway's `OriginHealthTracker`: 3 consecutive failures → down, 2 consecutive successes → up; recovered origins ramp back gradually.
- No session affinity: bookings, trips and payments live in the database; realtime clients reconnect and resynchronise.
- **Routing failover is not database failover.** If both pools use the same database and it is down, failing over between pools restores nothing. See docs/LOAD_BALANCING_FAILOVER.md.
- Never auto-replay bookings, driver assignment or payments across origins; clients use idempotency keys and authoritative status lookups.
