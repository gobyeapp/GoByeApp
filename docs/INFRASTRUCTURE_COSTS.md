# Infrastructure costs (D-051)

**Actual costs incurred by this work: none.** No Cloudflare resource, bucket, Worker, DNS record, load
balancer or paid plan was created or activated. Prices change; this page lists what drives cost, not numbers.
Check current Cloudflare and Vercel pricing pages and the account's plan before any decision.

| Component | What drives cost | Notes for GoBye | Status |
|---|---|---|---|
| Vercel (website, admin) | Plan tier, bandwidth, build minutes, team seats | Static site + static admin SPA; no serverless functions today | Existing (website); admin not deployed |
| Cloudflare DNS + proxy | Plan tier (Free/Pro/Business) for WAF rules, rate-limiting rules, certificates | Two-level staging names (e.g. `media.staging.gobye.app`) may need an extra certificate (Q-070) | Pending approval |
| Cloudflare Workers (gateway, signer, media) | Requests and CPU time; plan limits | File bytes go direct to R2, so Workers handle small requests only | Pending deployment |
| R2 storage | GB-month stored; Class A (writes/lists) and Class B (reads) operations | R2 charges no egress fees (documented R2 property). Documents and evidence grow with drivers and incidents; backups double that storage | Pending credentials |
| R2 backup copy | Second bucket/account storage + copy operations | Daily copy of documents and evidence (BACKUP_DISASTER_RECOVERY.md) | Proposed |
| Cloudflare Load Balancing | Paid add-on: per load balancer, origins, health-check frequency and regions | Only once a second real origin exists; verify on the account | Future enhancement (approval) |
| Cloudflare Rate Limiting / Durable Objects | Rules per plan; DO requests and storage | Needed for production-grade rate limits across isolates | Future |
| Cloudflare Stream (video) | Minutes stored and delivered | Only if adaptive streaming becomes necessary | Future |
| Malware scanning | Per scan or subscription | Required before real document uploads (Q-067) | Pending provider |
| Realtime provider | Connections and messages | Depends on choice (Q-066) | Pending provider |
| Backend + database | Compute, storage, replicas, backups | Biggest line item; drives HA cost (replica in another zone) | Pending provider |
| Observability | Log volume and retention, metrics, alerting channel | Structured logs with redaction keep volume down | Pending provider |
| SMS / OTP | Per message | Auth provider decision (Q-065) | Pending provider |

## How to keep it down

- Direct-to-R2 uploads (no Worker in the data path).
- Immutable, long-cached public media keys.
- No load balancer until there is a second origin worth balancing.
- Log sampling for high-volume location updates; never log bodies.

Record actual monthly costs here once anything is live (provider, month, amount, note).
