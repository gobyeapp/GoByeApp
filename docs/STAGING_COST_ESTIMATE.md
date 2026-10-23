# Staging: consolidated monthly cost estimate (Phase 1.5)

**Date:** 2026-10-23. **Spent so far: ₦0 / $0.** Nothing paid was activated by this work. The staging project, host and keys don't exist yet.

How to read the columns:
- **Free allowance:** what the provider's published free tier includes, read on the date above.
- **Confirmed charge:** a published list price that applies **only if** that paid item is approved and activated. Nothing here is being charged today.
- **Estimate:** our expected monthly amount for GoBye staging under that option. "Unknown" means no public price exists; a quote is needed.

Prices exclude VAT and FX. Re-check before buying. Sources at the end.

## 1. Two ways to run staging

| | **Option A: zero-cost staging** (recommended to start) | **Option B: paid, more reliable staging** (needs approval) |
|---|---|---|
| Who it suits | Team testing, Phase 2 development, smoke tests | Long soak tests (R1: 14 days of monitoring), pilot users |
| Monthly total | **$0 confirmed** + SMS per message (unknown price, small volume) | **≥ $25 confirmed** + StackShift (unknown) + SMS |

## 2. Line by line

| Area | Item | Free allowance | Confirmed charge (only if activated) | Option A estimate | Option B estimate |
|---|---|---|---|---|---|
| **Hosting** | StackShift: API, with the worker in-process (`WORKER_ENABLED=true`) | Free plan: 0.5 vCPU, 512 MB, 2 projects, 1 node, no backups | Ignite (1 vCPU, 1.5 GB), Pro (1.5 vCPU, 2 GB): **prices not published** | $0 (Free plan) | **Unknown: written quote needed (Q-075)** |
| **Database** | Supabase project `gobye-staging` | Free: 500 MB database, shared compute, 2 active projects per account | Pro organisation $25/month incl. $10 compute credit; Micro compute $10 (covered by the credit) | $0 | $25 |
| **Auth** | Supabase Auth: email/password, phone verification, staff TOTP | 50,000 MAU (Free); 100,000 (Pro) | Advanced MFA (Phone) add-on $75/month (first project). **Not proposed** (D-062). | $0 | $0 |
| **Auth** | SMS for phone OTP | None | Per message, depends on the provider (A-4) | Unknown price × ~100–300 OTPs/month of team testing | same |
| **API usage** | Cloudflare Workers (staging gateway, upload signer, media gateway) | 100,000 requests/day | Workers Paid $5/month minimum | $0 | $0 (Paid is for production) |
| **API usage** | Supabase egress | 5 GB (Free); 250 GB (Pro) | $0.09/GB over the allowance | $0 | $0 |
| **Storage** | Cloudflare R2 `gobye-staging-*` (only when `STORAGE_PROVIDER=r2`) | 10 GB-month, 1 M Class A and 10 M Class B operations per month; no egress fee | $0.015/GB-month beyond | $0 | $0 |
| **Storage** | Supabase file storage (not used by GoBye) | 1 GB | — | $0 | $0 |
| **Logging** | API JSON logs (2 lines per request at `info`; ~1,200 requests/s measured locally means log volume follows traffic) | Host's built-in logs (retention not published for StackShift); Supabase logs 1 day (Free) / 7 days (Pro) | — | $0 | $0 |
| **Monitoring** | External uptime check on `/health/ready` every 1–5 min | Free tiers exist from several monitors (not verified for GoBye's needs) | — | $0 (estimate) | $0 (estimate) |
| **Jobs** | PostgreSQL job queue (D-060) in the same database | Included | No Redis or queue service | $0 | $0 |
| **Domain and network** | `api-staging`, `admin-staging` under `gobye.app`; Cloudflare DNS and TLS | DNS and Universal SSL included on Cloudflare Free | Two-level names such as `media-staging.gobye.app` may need an extra certificate (Q-070) | $0 | $0 |
| **Domain and network** | Supabase IPv4 add-on (only for direct connections from IPv4-only hosts) | Pooler (Supavisor) is IPv4 and included | Paid add-on: **avoid**, use the pooler | $0 | $0 |
| **Domain and network** | Admin staging on Vercel | Hobby plan is **non-commercial** | Pro $20/seat | $0 (risk: commercial use on Hobby, see note) | $20 if Pro is approved |
| **Backup and recovery** | Database backups | None on Free | Daily backups, 7 days, included in Pro; PITR from $100/month (**not needed for staging**) | $0 (staging data is synthetic; migrations are re-runnable) | $0 extra (included in Pro) |
| **Security** | Turnstile CAPTCHA, Cloudflare WAF basics | Included on Free | — | $0 | $0 |
| **Security** | Malware scanner for uploads (Q-067) | — | Unknown; only needed before document uploads are tested | $0 (uploads off) | Unknown |
| **Total** | | | | **$0 + SMS** | **$25 (+$20 if Vercel Pro) + StackShift quote + SMS** |

**Note on Vercel:** the admin dashboard is already on a Hobby project. Vercel's Hobby terms do not allow commercial use, so the owner should decide when to move to Pro (A-7). That decision is not staging-specific.

## 3. Measured sizing that feeds the hosting estimate

Measured locally on 2026-10-23. The API image was built from the repository's Dockerfile on a stand-in base (see `BACKEND_PHASE_1_VERIFICATION.md` §4), limited to **0.5 CPU / 512 MB**, like StackShift's Free and Standard size:

| Measure | Result |
|---|---|
| Memory at idle | ≈ 50 MB |
| Memory under load | ≈ 61 MB, stable; no OOM, no restart |
| Throughput | 50 concurrent clients for 20 s on `/health/ready` (database round trip), `/v1/me` (401) and `/health/live`: 24,100 requests, ≈ 1,200 requests/s, 0 errors; p50 23 ms, p95 131 ms, p99 235 ms |
| CPU under that load | ≈ 50% of one core (the 0.5 CPU cap) |

These are **not** production numbers: there was no real sign-in, no network latency to Supabase and no TLS. They show that the smallest container is enough for staging. Test R3 on the real host decides production sizing.

## 4. What needs an owner decision or quote

1. StackShift written quote for Ignite and Pro, with region, bandwidth and SLA (Q-075).
2. Free vs Pro for the Supabase staging project (A-7). Free works if the account has a free project slot.
3. SMS provider and price per message to Nigerian numbers (A-4).
4. Vercel Pro timing (A-7).

## Sources (read 2026-10-23)

- Supabase pricing: https://supabase.com/pricing (Free/Pro allowances, compute, add-ons, spend cap)
- Supabase phone MFA: https://supabase.com/docs/guides/auth/auth-mfa/phone
- StackShift plans: https://stackshift.cloud/pricing (resources listed; prices not shown in the page text)
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Vercel pricing: https://vercel.com/pricing
