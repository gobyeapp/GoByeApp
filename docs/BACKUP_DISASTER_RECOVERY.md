# Backup and disaster recovery (D-051)

**Everything here is a proposal.** No backend or database exists yet, so most of it can't be implemented or
tested. RPO = how much recent data we may lose; RTO = how long until service is back.

## What must be recoverable

| Data | Lives in (planned) | Backup (proposed) | RPO / RTO (proposals) |
|---|---|---|---|
| Application config (apps, website, admin) | git + Vercel / EAS builds | git history; Vercel keeps previous deployments | 0 / 15 min (redeploy previous) |
| Infrastructure config (Workers, R2 definitions, DNS plan) | git (`infra/cloudflare`) + Cloudflare | git; `wrangler rollback`; exported DNS zone file monthly | 0 / 30 min |
| Driver documents, profile photos | R2 `private-documents` | Daily copy to a separate account/bucket with different credentials | 24 h / 4 h |
| Incident evidence | R2 `private-evidence` | Daily copy as above; legal hold blocks deletion | 24 h / 4 h |
| Public media | R2 `public-media` | Source files in git or design storage | 0 / 1 h |
| File metadata (`FileRecord`) | database (pending) | with the database | as database |
| User accounts, ride history, payments, location events, audit logs | database (pending) | point-in-time recovery + daily snapshot in another region | 5 min / 1 h for bookings and payments; 24 h for location history |

R2 object names are not a database: metadata must be restored from the database backup, then reconciled
against bucket listings (orphans quarantined, missing objects flagged).

## Degraded safe mode for active trips

When something fails, prefer "keep trips safe" over "full service":
- Traffic policy **Maintenance** pauses new bookings, quotes and offers; trips in progress, safety and support
  keep routing (`traffic/model.ts` `ALWAYS_ALLOWED`; tested locally).
- Apps keep the last known trip, driver, plate and PIN on the device (rider booking state is persisted
  already) and show "Reconnecting…" rather than clearing the trip.
- Emergency number 112 and support contact stay reachable in-app without the backend.
- Payments are never marked paid while the provider is unreachable; they stay pending and are reconciled.

## Scenarios

| # | Scenario | Detect | Respond | Recover |
|---|---|---|---|---|
| 1 | **Frontend deployment failure** (website or admin) | Vercel deploy status; post-deploy check | Keep the previous production deployment live | Vercel "Promote" / instant rollback to the last good deployment; fix forward in a preview |
| 2 | **Cloudflare disruption** | Cloudflare status; gateway health alerts | Website on Vercel is unaffected (DNS-only), unless DNS itself is affected; apps show offline states | Wait / follow Cloudflare guidance; no alternate API path is designed yet (future: secondary DNS) |
| 3 | **Backend server failure** | `/health/ready` monitors; 5xx alert | Gateway (later LB) fails over to a healthy origin; with one origin, Maintenance policy | Restart / redeploy origin; ramp traffic back (10% → 100% over 5 min) |
| 4 | **Database outage** | Readiness checks fail on all origins | Failover between origins does **not** help (LOAD_BALANCING_FAILOVER.md); Maintenance mode; trips continue on-device | Promote replica / restore point-in-time; reconcile in-flight bookings by idempotency key |
| 5 | **Accidental file deletion** | Storage monitoring; user report | Stop the job / person deleting; no lifecycle deletes on documents (only cleanup rules) | Restore from the backup copy; restore `FileRecord` from DB |
| 6 | **Corrupted application config** | Startup config validation (`parsePublicConfig`, `parseOrigins`) refuses bad config | Apps fall back to safe defaults; gateway answers 503 rather than routing wrongly | Revert the config commit; redeploy |
| 7 | **Compromised API credentials** | Unexpected usage, alerts, report | Rotate immediately: `wrangler secret put …` (Workers), provider dashboards; revoke R2 tokens; invalidate sessions | Review audit and access logs; NDPA breach assessment with counsel |
| 8 | **Failed software deployment** (Worker or backend) | Error-rate alert after deploy | `wrangler rollback` / previous backend release; traffic switcher back to the previous origin | Fix and redeploy through staging |
| 9 | **Realtime service failure** | Disconnect-rate alert | Clients back off with jitter and fall back to polling the authoritative state (resync) | Restore provider; clients resubscribe from last sequence |
| 10 | **Payment provider outage** | Payment failure alert | Emergency policy with payments off; trips continue; payments stay pending | Reconcile with provider records; retry only via idempotent operations |

## Drills (to schedule once staging exists)

- Restore a document from backup into staging and download it through the signer.
- Fail the primary origin in staging and confirm failover and ramp-back.
- Rotate `ORIGIN_AUTH_SECRET` and `GATEWAY_ASSERTION_SECRET` without downtime (two-key overlap — future work).

Until those drills run, GoBye must not claim high availability or tested recovery.
