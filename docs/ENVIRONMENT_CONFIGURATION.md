# Environment configuration and secrets (D-051)

Status key: **Implemented** (code exists) · **Tested locally** (automated tests pass here) · **Simulated** · **Pending provider** · **Pending credentials** · **Future**.

| Item | Status |
|---|---|
| Typed public config `parsePublicConfig` (`packages/core/src/infra/env.ts`) | Implemented, tested locally |
| Secret detection for public bundles (`findSecrets`, `SECRET_ENV_NAMES`) | Implemented, tested locally |
| Rider / driver `src/state/publicConfig.ts` | Implemented, not wired into screens (no backend yet) |
| Staging / production API, realtime and media hosts | Pending provider (hostnames proposed, not live) |
| Server secrets (R2, payments, database, signing) | Pending credentials; never in this repo |

## Environments

| | development | staging | production |
|---|---|---|---|
| Purpose | Laptops, Expo Go, the demo relay | Pre-release testing with test providers | Real riders and drivers |
| `ENV` value | `development` | `staging` | `production` |
| API base (proposed) | `http://localhost:8787/v1` (default) | `https://api-staging.gobye.app/v1` | `https://api.gobye.app/v1` |
| Realtime (proposed) | `ws://localhost:8787/v1/realtime` | `wss://realtime-staging.gobye.app/v1` | `wss://realtime.gobye.app/v1` |
| Media (proposed) | `http://localhost:8787/media` | `https://media-staging.gobye.app` | `https://media.gobye.app` |
| Simulated services | On by default | On by default (switch off per test) | **Refused** unless a demo build passes `allowMocksInProduction` |
| Demo relay (D-049) | Allowed | Allowed | **Refused** |
| Credentials | Personal test keys only | Separate staging keys | Separate production keys |

Apps call the stable address only. Origin servers are chosen behind `api.gobye.app` (API_GATEWAY.md,
LOAD_BALANCING_FAILOVER.md), so moving the backend never needs an app release.

## Public variables (safe in bundles)

| Name (Expo / Vite) | Meaning | Rules |
|---|---|---|
| `EXPO_PUBLIC_ENV` / `VITE_ENV` | development, staging or production | Anything else is an error |
| `EXPO_PUBLIC_API_BASE_URL` / `VITE_API_BASE_URL` | Stable API base incl. `/v1` | https outside development; no private/LAN address outside development; no credentials, query or fragment; trailing `/` trimmed |
| `EXPO_PUBLIC_REALTIME_URL` / `VITE_REALTIME_URL` | Realtime endpoint | wss outside development |
| `EXPO_PUBLIC_MEDIA_BASE_URL` / `VITE_MEDIA_BASE_URL` | Approved public media only | https outside development; private files never use it |
| `EXPO_PUBLIC_USE_MOCKS` / `VITE_USE_MOCKS` | Simulated services | true/false; refused in production |
| `EXPO_PUBLIC_DEMO_RELAY_URL` / `VITE_DEMO_RELAY_URL`, `…_DEMO_RELAY_KEY` | Connected demo (D-049) | Development/staging only; the key is a Supabase **anon** key or empty |

`parsePublicConfig` returns every problem at once; `describeConfigProblems` turns them into lines for
logs. The apps fall back to a local, simulated configuration when the config is invalid, so a bad `.env`
can never point a build at an unintended server. `assertMocksAllowed(config)` is the guard to call
wherever mock services are wired.

Expo inlines each `process.env.EXPO_PUBLIC_*` reference at build time (one by one, see
`publicConfig.ts`); restart with `npx expo start -c` after changing `.env`/`.env.local`.

## Server-only secrets (never in an app, website or admin bundle)

`SECRET_ENV_NAMES`: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID_TOKEN`,
`CLOUDFLARE_API_TOKEN`, `PAYSTACK_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`, `DATABASE_URL`,
`ORIGIN_AUTH_SECRET`, `UPLOAD_SIGNING_SECRET`, `MEDIA_TOKEN_SECRET`, `SESSION_SIGNING_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`, `SMS_PROVIDER_API_KEY`, `GOOGLE_MAPS_SERVER_KEY`.

Also rejected in public variables, whatever the name: names containing SECRET, PRIVATE, SERVICE_ROLE,
PASSWORD, ACCESS_KEY, SIGNING, WEBHOOK, DATABASE_URL or ending `_TOKEN`; values that look like
`sk_live_`/`sk_test_` keys, GitHub tokens, `AKIA…` access keys, PEM private keys, Supabase service-role
tokens, or database URLs with a password.

Where they live (Pending provider / credentials): Cloudflare Worker secrets (`wrangler secret put`,
per environment) for the gateway, media gateway and upload signer; the chosen backend's secret store
for database, payments and SMS; never `.env` files committed to Git. `.env.example` files hold
placeholders only; `.env.local` is git-ignored.

## Incidents already recorded

- A GitHub personal access token and the Supabase service_role key were shared in chat on 2026-10-22.
  Neither is in the repository (checked with a pattern search of the working tree and history), but both
  must be rotated (DECISIONS D-045 note, OPEN_QUESTIONS).
- The website contains the Supabase **anon** key by design (insert-only RLS on `waitlist`; the demo
  tables are wider, see DEMO_CONNECTED.md).

## Tests

`packages/core/src/__tests__/infra-env-http.test.ts`: defaults, production config, every problem listed,
secret detection by name and value, mocks refused in production.
