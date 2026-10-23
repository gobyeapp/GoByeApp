# Deploying GoBye Management (admin) on Vercel

The admin is its **own Vercel project**, separate from the landing page (`apps/web`). Both come from the
same GitHub repository (`gobyeapp/GoByeApp`). For now the admin runs entirely on built-in **test data**.
It connects to the backend later through `https://api.gobye.app/v1` once the backend is chosen (Q-064).

## One-time setup (owner, in the Vercel dashboard)

1. **Add New → Project → Import** `gobyeapp/GoByeApp` (the same repository as the landing page; this creates a second project).
2. **Project name:** `gobye-admin` → address `gobye-admin.vercel.app`.
3. **Root Directory:** `apps/admin`. Directly under it, **"Include files outside the root directory in the Build Step" must be ON**. The admin uses the shared `packages/core` and the repository's lock file; without them the build stops (see Troubleshooting).
4. **Framework, install, build and output** come from `apps/admin/vercel.json`. Leave the dashboard fields on their defaults.
5. **Environment variables:** none needed today. Do **not** add `VITE_DEMO_RELAY_URL`: the live site uses its own test data.
6. **Deploy.**
7. **Settings → Deployment Protection:** turn on **Vercel Authentication** for Production too. Sign in is still simulated (any visitor could pick any staff role), so only people on your Vercel team should open it until real staff sign in exists.

## What `vercel.json` does

| Setting | Value | Why |
|---|---|---|
| `installCommand` | Checks the whole repository is present, then `cd ../.. && npm ci --workspace apps/admin --include-workspace-root=false` | Installs only the admin's packages from the shared lock file (about 230 packages in about 10 s), not the mobile apps |
| `buildCommand` | `npm run build` | Typecheck, then a Vite production build |
| `outputDirectory` | `dist` | Static files; hash routing (`/#/…`) so no rewrites are needed |
| `ignoreCommand` | `git diff --quiet HEAD^ HEAD -- . ../../packages/core` | Skips a build when a push changes neither the admin nor the shared core, so landing-page pushes don't rebuild the admin |
| `headers` | CSP `script-src 'self'`, HSTS, `DENY` framing, `noindex`, long cache for hashed assets | Same rules as the landing page (D-052) |

Fonts (Inter, SIL OFL) and the 3D icons are bundled in `src/assets`, so the build needs nothing from the
mobile apps.

## Checked before handing over (2026-10-23)

- **Clean clone build:** a fresh clone of the repository ran the exact install command (229 packages in 9 s) and `npm run build` (typecheck plus build) succeeded.
- **Under the real headers:** the built site was served with the headers from `vercel.json` and opened in Chromium on 5 pages:
  - no CSP violations or console errors;
  - all 4 font weights loaded;
  - 3D images displayed.
- **Not checked:** the build has not run on Vercel itself; Vercel can't be reached from the build workspace.

## Troubleshooting

**`npm error enoent Could not read package.json ... open '/package.json'`** (seen on the first deploy, 2026-10-23), or
**"GoBye admin needs the whole repository"**. Vercel uploaded only the `apps/admin` folder (the log says about
170 deployment files instead of about 780). Fix: **Settings → Build and Deployment → Root Directory**, turn on
**Include files outside the root directory in the Build Step**, save, then **Deployments → ⋯ → Redeploy**.
If you deployed with the Vercel CLI from inside `apps/admin`, deploy from the repository root instead, or use
the Git import.

**Node version warning.** `engines.node` is pinned to `22.x`, so Vercel uses Node 22 and does not jump to a new
major version on its own.

## Later: connecting the backend

When the backend exists, add these **public** variables per environment. They ship to every browser, so they must never hold a secret; run `npm run check:env` first.

| Variable | Example |
|---|---|
| `VITE_APP_ENV` | `staging` / `production` |
| `VITE_API_BASE_URL` | `https://api-staging.gobye.app/v1` / `https://api.gobye.app/v1` |
| `VITE_REALTIME_URL` | `wss://realtime.gobye.app/v1` |
| `VITE_MEDIA_BASE_URL` | `https://media.gobye.app` |
| `VITE_USE_MOCKS` | `false` |

You will also need to:
- Add any new API host to `connect-src` in the CSP.
- Replace the simulated sign in with real staff authentication.
- Point `admin.gobye.app` at this project with a **DNS-only** record (no proxy in front of Vercel, D-051), once `gobye.app` is on Cloudflare.

## Undoing a bad deploy

Deployments → choose the last good one → ⋯ → **Promote to Production** (Instant Rollback).
