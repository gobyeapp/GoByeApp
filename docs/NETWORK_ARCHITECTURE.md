# Network architecture (D-051)

| Area | Status |
|---|---|
| Website on Vercel (`apps/web`) | **Implemented** (existing). Security headers added in `vercel.json` — **Configured, tested locally**, live after the next Vercel deploy |
| Admin web app (`apps/admin`, Vite SPA) | **Configured** (`apps/admin/vercel.json`) — hosting on Vercel is **pending deployment** |
| DNS records for gobye.app | **Proposed, not applied** (`infra/cloudflare/dns/`) |
| API gateway Worker | **Implemented, tested locally; pending deployment** (docs/API_GATEWAY.md) |
| Backend origins / database | **Pending provider selection** |
| Demo relay (D-049) | **Simulated** test-data store on a laptop or Supabase demo tables; not part of production |

## Hostnames (proposed)

| Hostname | Serves | Proxy | Notes |
|---|---|---|---|
| `gobye.app`, `www.gobye.app` | Public website (Vercel) | **DNS only** | Vercel CDN, TLS, firewall and deploys stay in charge |
| `admin.gobye.app` | Management app (Vercel) | DNS only | Staff sign-in + MFA in the app/backend; `noindex`; optional Cloudflare Access later (would need proxying — decide separately) |
| `api.gobye.app` | API gateway Worker → origins / Load Balancer | **Proxied** | Single stable API address for all apps |
| `api-staging.gobye.app` | Staging gateway | Proxied | Separate secrets, origins, buckets |
| `realtime.gobye.app` | Realtime (if split from the API) | Proxied | WebSockets supported on proxied hostnames |
| `media.gobye.app` | R2 custom domain for **public** media only | Proxied (R2) | Private buckets never get a domain |
| `uploads.gobye.app`, `driver.gobye.app` | Future | — | Presigned uploads use the R2 S3 endpoint, not a custom domain |

## Boundaries

```
              ┌────────────── Vercel ──────────────┐
 browsers ──▶ │ gobye.app (website)  admin.gobye.app│   DNS only (no Cloudflare proxy in front)
              └─────────────────────────────────────┘
 apps / admin ──▶ api.gobye.app ──▶ Cloudflare edge ──▶ gateway Worker ──▶ origin(s) ──▶ database
                                         │                                 (private; reached only
                                         │                                  via the gateway / Tunnel)
 apps ──presigned PUT──▶ R2 S3 endpoint (private buckets)   media.gobye.app ──▶ R2 public bucket
```

- **Public:** the website, the admin shell (data still needs staff auth), `api.` (gateway), `media.`.
- **Private:** backend origins (never in DNS; reached through the gateway with a signed header, ideally via
  Cloudflare Tunnel or IP allowlist), the database, private R2 buckets, secrets.
- **Client IP:** from `CF-Connecting-IP` at the gateway only. Origins trust `X-Forwarded-For` only on
  requests carrying a valid gateway signature.
- **TLS everywhere:** Vercel-managed certificates for DNS-only Vercel hosts; Cloudflare edge certificates
  and **Full (strict)** to origins for proxied hosts. Never "Flexible" (HTTP to origin, redirect loops).
- **Staging vs production:** separate hostnames, Workers, secrets, buckets and origins. Mobile builds get the
  API base URL from build configuration (see docs/ENVIRONMENT_CONFIGURATION.md).

## Things deliberately not done

- No Cloudflare proxy in front of Vercel (double CDN, certificate/caching conflicts, wrong client IPs).
- No extra hop for uploads: files go straight from the app to R2 with a short-lived presigned URL.
- No DNS, Worker, bucket or load balancer has been created. See dns/plan.md for the order of work.
