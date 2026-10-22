# Infrastructure audit (D-051)

Audit of the repository on 2026-10-23, **before** the infrastructure foundation work, then a summary of what
changed. Every finding cites the file or command it comes from. Findings without evidence are listed as
open questions, not vulnerabilities.

Status words used across the infrastructure docs: **Implemented** (code exists) · **Tested locally**
(automated tests pass in this repo) · **Simulated** · **Configured (template)** · **Pending credentials** ·
**Pending provider selection** · **Pending deployment** · **Future enhancement**. Nothing in this work is
deployed to staging or verified in production.

## 1. What existed before

### Frameworks and runtimes

| Part | Evidence | Version |
|---|---|---|
| npm workspaces monorepo | root `package.json` (`apps/*`, `packages/*`) | Node 22 in this environment |
| Rider app `apps/rider`, Driver app `apps/driver` | `package.json` | Expo SDK 57 (`expo ~57.0.30`), React Native 0.86, Expo Router, TypeScript strict |
| Shared logic `packages/core` | `package.json` "Pure TypeScript — no React Native imports" | jest tests |
| Design system `packages/ui` | MingCute icons via `@mingcute/react-native` | — |
| Admin / management prototype `apps/admin` | `package.json`, `vite.config.ts`, `src/App.tsx` (HashRouter) | Vite 7, React 19, vitest; runs on clearly labelled test data |
| Public website `apps/web` | `index.html`, `app.js`, `site.config.js`, `vercel.json` | Static HTML/CSS/JS, vendored three.js, no build step |

### Hosting and deployment configuration

- **Vercel:** `apps/web/vercel.json` only: `cleanUrls`, `Cache-Control` for `/assets/*`, `X-Content-Type-Options`
  and `Referrer-Policy`. No CSP, HSTS or framing headers. No Vercel config for `apps/admin`.
- **CI / GitHub workflows:** none. There is no `.github/` directory, so tests, typechecks and secret checks
  only run when someone runs them locally.
- **Infrastructure as code:** none. No Wrangler, Terraform or Cloudflare configuration.
- **Supabase:** `supabase/migrations/20261022_waitlist.sql` (insert-only waitlist table for the website) and
  `20261022_demo_relay.sql` (optional demo tables, see risks). Whether either was applied is not visible from
  the repo.

### Environment variables

| Variable | Where | Kind |
|---|---|---|
| `EXPO_PUBLIC_DEMO_RELAY_URL`, `EXPO_PUBLIC_DEMO_RELAY_KEY` | `apps/rider/src/state/relay.ts`, `apps/driver/src/state/relay.ts` | Public (bundled) |
| `VITE_DEMO_RELAY_URL`, `VITE_DEMO_RELAY_KEY` | `apps/admin/src/workspaces/demo/Demo.tsx`, `src/vite-env.d.ts` | Public (bundled) |
| Supabase URL + anon key | `apps/web/site.config.js` (`waitlist.supabase`) | Public by design; the comment forbids the service_role key there |

No server-side secrets are referenced anywhere in code (`grep -rn "process.env\|import.meta.env"`).
`.env.local` is git-ignored (`.gitignore`).

### Authentication

Simulated only (`packages/core/src/mocks/services.ts` → `AuthService`; D-008, D-045, D-048). Tokens are
mock strings stored with `expo-secure-store` (`apps/*/src/state/storage.ts`). The admin "sign in" is a test
staff picker (`apps/admin/src/App.tsx`). There is no real session, refresh or revocation yet.

### API services and network requests

- Service interfaces in `packages/core/src/services/types.ts` (`AuthService`, `MapService`, `PricingService`,
  `MatchingService`, `TripService`, `PaymentService`, `WalletService`, …) with mock implementations in
  `packages/core/src/mocks/services.ts`. Apps receive them through `ServicesProvider`. No HTTP client existed.
- Demo relay (D-049): `packages/core/src/relay/client.ts` talks PostgREST-style REST to the local relay
  (`tools/demo-relay/server.mjs`) or optional Supabase `demo_*` tables.
- Website: `app.js` posts waitlist sign-ups to Supabase with the anon key; loads Google Fonts
  (`index.html`), and `qrcode.js` from `cdnjs.cloudflare.com` for the QR card.

### Files and media

- No upload pipeline. The driver app's `PhotoCapture` (licence, identity, vehicle papers) keeps photos on the
  phone; only `hasPhoto: true` is shared through the demo relay (`packages/core/src/relay/rides.ts`
  `shareApplication`).
- Media is bundled assets (videos in `apps/*/assets/video`, website `apps/web/assets`). No Cloudflare R2.

### Cloudflare

No integration of any kind (`grep -ri cloudflare` found only the cdnjs script URL and the brand-colour
naming).

### Security controls already present

- Secrets: none committed. Checked with `git log --all -S "github_pat_"`, `-S "ghp_"`, `-S "c2VydmljZV9yb2xl"`
  (base64 of `service_role`): no matches in history. The only hits for secret-like words are comments and
  a test fixture's masked `sk_test_••••` hint in the admin developer workspace.
- Token storage: `expo-secure-store` on device; non-sensitive state in AsyncStorage (`storage.ts`).
- Demo relay shares masked ID/licence numbers and never photos (`maskNumber`, `shareApplication`).
- Payments are a separate stage and never "paid" before confirmation (D-030); cards not used at launch (D-023).
- Logging rules documented in `docs/SECURITY_PRIVACY.md` §8 (no enforcement code).

### Tests and docs

Before this work: core 149, rider 36, driver 14, admin 246 tests (LOG.md, TEST_PLAN.md). Extensive product
docs in `docs/`; no infrastructure docs.

## 2. Risks found (with evidence)

| # | Finding | Evidence | Classification | Status after this work |
|---|---|---|---|---|
| R1 | Demo relay is unauthenticated and plain HTTP on the LAN; anyone on the same Wi-Fi can read or change demo rows, including the pickup PIN | `tools/demo-relay/server.mjs` (no auth), `docs/DEMO_CONNECTED.md` | High **for real data**, accepted for demo test data only (D-049) | Unchanged. Production config now refuses a demo relay URL (`parsePublicConfig`) |
| R2 | Supabase `demo_*` tables, if the optional SQL was applied, let the anon key read and write them | `supabase/migrations/20261022_demo_relay.sql` | Medium (test data only) | Unchanged; the SQL file carries the drop statement. Owner to confirm whether it was applied |
| R3 | Credentials were pasted into chat on 2026-10-22: a Supabase service_role key and a GitHub personal access token | LOG.md, DECISIONS.md D-045 note | High until rotated | **Not in the repo or git history** (checked above). Rotation is an owner action and is still required |
| R4 | No CI: typecheck, tests and secret checks are manual | no `.github/` | Medium | Open. `npm run check:env` exists now but nothing runs it automatically |
| R5 | Website had no CSP / HSTS / framing protection | `apps/web/vercel.json` before | Medium | Fixed in config: CSP, HSTS, `X-Frame-Options`, Permissions-Policy, COOP (tested in Chromium; **pending deployment**) |
| R6 | Mock services could be shipped in a production build with nothing to stop it | `ServicesProvider` always uses `createMockServices` | Medium (before backend) | **Fixed 2026-10-23:** both apps call `assertMocksAllowed(publicConfig)` before creating simulated services, so a production build (`EXPO_PUBLIC_ENV=production`) refuses to start on mocks. Tested by typecheck and existing tests; a production build itself has not been run. |
| R7 | No HTTP client: no timeouts, request ids, idempotency or retry rules | `packages/core` had none | Medium (future) | Implemented: `createApiClient` |
| R8 | Driver documents have no storage path; when one is added it must be private | `PhotoCapture` | High (future) | Implemented as code: private buckets, presign + completion + scan, fail closed |
| R9 | Website config is public by design (Supabase URL + anon key in `site.config.js`) | file comment | Low (intended) | RLS allows insert only (waitlist SQL) |
| R10 | The admin is a browser prototype; permissions, approvals and MFA are UI-side | `apps/admin` BUILDING.md | High **if** deployed with real data | Unchanged; documented. The admin must not hold real data until a backend enforces them |

Not found / no evidence: committed credentials, public R2 buckets (none exist), server code (none exists).

## 3. Incompatible configurations and technical debt

- The website's waitlist sends to `*.supabase.co`; the new CSP allows exactly that host pattern. Moving the
  waitlist to another endpoint requires adding it to `connect-src` (`docs/VERCEL_CONFIGURATION.md`).
- `apps/admin/vercel.json` CSP allows the API hosts and `*.supabase.co`, not a LAN demo relay; the
  connected demo uses `npm run admin` (Vite dev, no Vercel headers), so it is unaffected.
- `docs/API_CONTRACTS.md` names bookings `/bookings`; the gateway's route map uses `/v1/rides`. The
  backend must pick one name; the gateway treats `POST /v1/rides` as booking creation (Q-069).
- Proposed staging hostnames use `api-staging.gobye.app` (one level), but media uses
  `media.staging.gobye.app` (two levels). A two-level name may need an extra certificate on Cloudflare; to
  confirm when DNS is planned (Q-070).

## 4. What changed (summary — details in INFRASTRUCTURE_REPORT.md)

- `packages/core/src/infra`: typed public config + secret detection, API client (request ids, timeouts,
  idempotency, safe retries), error model, health contracts, structured logging with redaction, metrics and
  alert interfaces, realtime client with reconnect / dedupe / resync. **Implemented, tested locally.**
- `packages/core/src/files`: file classes, policy, magic-byte validation, upload lifecycle, `FileService`,
  metadata repository, mock object store, fail-closed scanner, video interface. **Implemented, tested locally.**
- `packages/core/src/traffic`: origins, policies, health hysteresis, selection, privileged change rules,
  simulated control plane. **Implemented, tested locally.**
- `infra/cloudflare`: API gateway, upload-signer and media-gateway Workers; SigV4 presigner; R2 bucket,
  CORS and lifecycle definitions; DNS and load-balancer proposals. **Implemented / configured, tested
  locally against fakes. Pending credentials and deployment.**
- Vercel: hardened `apps/web/vercel.json`, new `apps/admin/vercel.json`. **Pending deployment.**
- Admin: "Traffic and origins" page. **Simulated.**
- Tooling: `tools/check-env.mjs` (`npm run check:env`), `npm run infra:test`.

## 5. Recommended next changes (by risk)

1. Rotate the Supabase service_role key and the GitHub token (R3) — owner, today.
2. Add CI (GitHub Actions) running `npm run typecheck`, `npm test`, `npm run check:env` on every push (R4).
3. ~~Wire `publicConfig` + `assertMocksAllowed` into both apps~~ — done 2026-10-23 (rider `state/services.tsx`, driver `state/session.tsx`).
4. Choose backend, database and auth provider (Q-064, Q-065); then deploy the gateway and signer to staging.
5. Choose a malware scanner (Q-067) before any real document is uploaded.
6. Confirm whether the Supabase demo tables were applied; drop them after demos (R2).

## 6. Implementation dependencies

Backend + database + auth selection → gateway origins, signer metadata store, caller assertions →
staging deployment → load balancing (needs a second origin) → production. Cloudflare account access and
DNS approval are needed for any deployment; Load Balancing is a paid add-on and needs separate approval.
