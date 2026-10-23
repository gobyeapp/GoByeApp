# Infrastructure costs (D-051)

**Staging (Phase 1.5): the consolidated estimate is in `STAGING_COST_ESTIMATE.md`**: $0 + SMS on free tiers, or ≥ $25 + StackShift quote + SMS on paid tiers. Nothing paid is active.

## Backend Phase 1: requirements and expected monthly cost (2026-10-23)

**Actual costs incurred by Phase 1: none.**
- No StackShift service, Supabase project, plan upgrade or Cloudflare product was created.
- The estimate below uses published list prices on the dates shown. Taxes and FX are not included.
- Prices change: re-check before buying.
- Record real bills as expenses (`POST /v1/costs/expenses` once deployed, or the admin Costs page) so break-even uses actual numbers.

### What the backend needs

| Component | Staging | Production (launch) | Why |
|---|---|---|---|
| API container | 1 × 0.5 vCPU / 512 MB | 2 × 0.5–1 vCPU / 1 GB (two for zero-downtime and failover) | Measured need comes from test R3 in `DEPLOYMENT_STACKSHIFT.md` |
| Worker container | 1 × 0.5 vCPU / 512 MB | 1 × 0.5 vCPU / 512 MB | Jobs and schedules (no public ingress) |
| PostgreSQL + Auth | Supabase project, Micro compute | Supabase project, Small compute, daily backups; PITR decision pending | Separate projects: staging never shares data or keys with production |
| Object storage | R2 `gobye-staging-*` | R2 `gobye-prod-*` + backup copy | Driver documents, evidence, public media |
| Edge gateway | Cloudflare Workers | Cloudflare Workers Paid | Gateway, upload signer, media gateway |
| Website + admin | Vercel | **Vercel Pro** | Hobby does not allow commercial use |
| Not needed yet | — | — | **No Redis, ClickHouse, Kubernetes or load balancer:** no measured need (`BACKEND_ARCHITECTURE.md` §10) |

### Estimate (USD per month, list prices)

| Item | Price used | Launch estimate | Source (date) |
|---|---|---|---|
| Supabase Pro organisation | $25 per organisation, includes $10 compute credit; 8 GB database, 250 GB egress, 100,000 MAU included | $25 | [CloudZero, Supabase pricing (27 Aug 2026)](https://www.cloudzero.com/blog/supabase-pricing/) |
| Supabase compute | Micro $10, Small $15 per project | Production Small $15 + staging Micro $10 − $10 credit = **$15** | same |
| Vercel Pro | $20 per seat, $20 usage credit per seat | 1 seat = **$20** (each extra developer seat +$20) | [Makerkit, Vercel cost (21 May 2026)](https://makerkit.dev/blog/saas/vercel-cost) |
| Cloudflare Workers Paid | $5 minimum per account; 10 M requests and 30 M CPU-ms included | **$5** (Free allows 100,000 requests per day; Paid is recommended for production) | [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Cloudflare R2 | $0.015 per GB-month; Class A $4.50 per M, Class B $0.36 per M; 10 GB, 1 M A and 10 M B free each month; no egress fee | **≈ $0** at launch (under 10 GB); 100 GB ≈ $1.35 | [Filebase, R2 pricing (20 Jul 2026)](https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/) |
| StackShift (API + worker, staging + production) | **Not published on the public pricing page** when checked (prices did not load). Plans: Free, Ignite, Pro, Enterprise; Naira or dollar billing. | **Unknown: get a written quote** (Q-075). The Free plan is too small (2 projects, 512 MB). | [stackshift.cloud/pricing](https://stackshift.cloud/pricing) |
| SMS for phone OTP | Per message, from the SMS provider connected to Supabase Auth | Unknown: depends on provider and volume (Q-065) | — |
| **Known subtotal** | | **≈ $65 per month + StackShift + SMS** | |

**Notes**
- **Supabase usage overage:** egress beyond 250 GB is $0.09/GB, and MAU beyond 100,000 is $0.00325 each. Neither is expected at launch.
- **Marketing:** excluded from break-even by agreement. Infrastructure costs above are operating costs and count.
- **What break-even means at these figures:** ≈ $65/month plus StackShift and SMS is covered by a handful of monthly passes (₦60,000 each) once converted at the month's rate. The admin's break-even report computes this from recorded expenses, not from this estimate.

---


**Actual costs incurred by this work: none.** No Cloudflare resource, bucket, Worker, DNS record, load
balancer or paid plan was created or activated. Prices change; this page lists what drives cost, not numbers.
Check current Cloudflare and Vercel pricing pages and the account's plan before any decision.

| Component | What drives cost | Notes for GoBye | Status |
|---|---|---|---|
| Vercel (website, admin) | Plan tier, bandwidth, build minutes, team seats | Static site + static admin SPA; no serverless functions today | Existing (website); admin not deployed |
| Cloudflare DNS + proxy | Plan tier (Free/Pro/Business) for WAF rules, rate-limiting rules, certificates | Two-level staging names (e.g. `media-staging.gobye.app`) may need an extra certificate (Q-070) | Pending approval |
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
