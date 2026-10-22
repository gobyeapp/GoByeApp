# DNS plan for gobye.app (PROPOSED — not applied)

Status: **Pending deployment / pending owner approval.** Nothing in this folder has been applied to the live zone.
Machine-readable list: `records.proposed.json`.

## Rules

1. **The website stays on Vercel, directly.** `gobye.app`, `www.gobye.app` (and `admin.gobye.app` if the admin is hosted on Vercel) are **DNS only (grey cloud)**. Putting Cloudflare's proxy in front of Vercel would double-CDN the site, can break Vercel certificate renewals and cache purges, and hides real client IPs from Vercel. Vercel's own docs recommend against it.
2. **Backend hostnames are proxied (orange cloud).** `api.` (and `realtime.` if split out) terminate at Cloudflare, run the gateway Worker / WAF / rate-limit rules, then reach origins. Origin addresses are never DNS records; they live in the gateway's `ORIGINS_JSON` binding or a Load Balancer pool.
3. **TLS:** SSL/TLS mode **Full (strict)** for proxied hostnames, so Cloudflare → origin is verified TLS. "Flexible" is never used (it downgrades to HTTP and causes redirect loops). Always Use HTTPS + HSTS once every hostname is confirmed HTTPS.
4. **Staging is separate:** `api-staging.gobye.app` with its own Worker, secrets, buckets and origins.
5. **Preserve verification records:** existing TXT/MX/Vercel verification records are kept as they are.

## Order of work when approved

1. Confirm where the zone is hosted today and export the current records (backup).
2. If moving DNS to Cloudflare: add the zone, check the imported records against the export, keep Vercel records DNS-only, then switch nameservers at the registrar. Expect up to 24–48 h for propagation.
3. Add `api-staging` → staging gateway, test, then `api` → production gateway.
4. `media.` only after the public media bucket exists and holds approved content.

## Checks after any change

- `dig gobye.app` / `dig www.gobye.app` answer Vercel addresses (not Cloudflare) for DNS-only records.
- `curl -I https://gobye.app` → `server: Vercel`, valid certificate, no redirect loop.
- `curl https://api.gobye.app/health/live` → `{"data":{"status":"ok"}}` from the gateway.
