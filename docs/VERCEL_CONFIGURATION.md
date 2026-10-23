# Vercel configuration (D-051)

| Part | Status |
|---|---|
| Website `apps/web` on Vercel | **Implemented** (existing; owner deploys). Domain settings **unchanged** |
| `apps/web/vercel.json` security headers + CSP | **Configured, tested locally** (Chromium against a server applying these headers). Takes effect on the next deploy |
| `apps/admin/vercel.json` | **Configured** (install, build, output, ignore rule, headers). Admin is a separate Vercel project; first deployment is pending (owner) |
| Env validation `npm run check:env -- <file>` | **Implemented** (`tools/check-env.mjs`) |
| Preview deployments, error monitoring | **Pending** owner's Vercel project settings (below) |

## Website (`apps/web`)

Static site, no build step. Root directory in Vercel: `apps/web`. `cleanUrls: true` (kept).

Headers on every path:

| Header | Value / reason |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (no `preload` until every subdomain is confirmed HTTPS) |
| `X-Frame-Options` | `DENY` (plus `frame-ancestors 'none'`) |
| `X-Content-Type-Options` | `nosniff` (existing) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` (existing) |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb off |
| `Cross-Origin-Opener-Policy` | `same-origin` |

Why each CSP source is there (checked against the code):

- `cdnjs.cloudflare.com` — the QR library `app.js` loads only when `qr.url` is set.
- `fonts.googleapis.com` / `fonts.gstatic.com` — DM Sans stylesheet and files.
- `'unsafe-inline'` for **styles only** — the page sets `style="…"` attributes (CSS variables) in markup and
  `innerHTML`. Scripts stay strict: there are no inline scripts or `on…=` handlers.
- `https://*.supabase.co` — the waitlist POST (`site.config.js` → `waitlist.supabase.url`). **If the waitlist
  is switched to `waitlist.endpoint` (another host), add that host to `connect-src`**, or sign-ups will be
  blocked by the browser.
- Three.js (footer road) is vendored under `/vendor` and loaded with a same-origin dynamic import; WebGL needs
  no CSP source.

Tested locally: page renders, hero poster/video, waitlist dialog opens, footer canvas renders, a Supabase
request is allowed, a request to another host is refused (proving the CSP is enforced), no CSP violations from
the page itself. Google Fonts and cdnjs couldn't be fetched from the test sandbox's network, so those two are
verified by the absence of CSP violations rather than by a successful load — check them once after deploying.

Caching: `/assets/*` and `/vendor/*` 1 day. CSS/JS are referenced with `?v=` so browsers fetch new versions
after a deploy; bump the version in `index.html` when changing `styles.css`, `app.js`, `site.config.js` or `icons.js`.

Internal pages (`components.html`, `preview.html`, `driver-ui-source.html`, `feature-ui-source.html`) send
`X-Robots-Tag: noindex, nofollow`.

## Admin (`apps/admin`)

Vite SPA with hash routing; build `npm run admin:build` → `apps/admin/dist`. **Its own Vercel project** (`gobye-admin`), separate from the landing page.
- Root Directory: `apps/admin`.
- Install, build, output and ignore rules are set in `apps/admin/vercel.json`. Install covers the admin workspace only. A build is skipped unless `apps/admin` or `packages/core` changed.
- Later: `admin.gobye.app`, DNS only.
- Step-by-step setup and backend variables: `apps/admin/DEPLOY_VERCEL.md`.
Headers: `X-Robots-Tag: noindex, nofollow`, strict CSP (`script-src 'self'`, `connect-src 'self'
https://api.gobye.app https://api-staging.gobye.app https://*.supabase.co`), HSTS, `DENY` framing,
`no-referrer`; hashed `/assets/*` cached for a year (`immutable`), `index.html` `no-cache`.
The demo relay over a LAN address (`http://192.168…`) is for local demos only and is not allowed by this CSP.

## Environment variables

- Only public values in `VITE_*` (admin) and `EXPO_PUBLIC_*` (apps): they ship to every browser/device.
- Run `npm run check:env -- apps/admin/.env.production` before setting values in Vercel; it fails on
  secret-looking names/values (payment secret keys, service_role JWTs, GitHub tokens, private keys, DB URLs).
- Set separate values for Preview and Production in Vercel → Settings → Environment Variables.

## Owner settings to confirm in the Vercel dashboard (not changed by us)

1. Production branch `main`; Preview deployments on for pull requests (protect previews if they use real data).
2. Deployment Protection on previews; "Instant Rollback" is how to undo a bad deploy (Deployments → ⋯ → Promote
   previous).
3. Domains: `gobye.app` + `www` as configured today — no changes made.
4. Optional: Vercel Web Analytics / log drains to the monitoring stack (docs/MONITORING_OBSERVABILITY.md).
