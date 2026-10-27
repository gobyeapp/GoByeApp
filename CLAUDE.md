# CLAUDE.md — GoBye

Persistent instructions for Claude Code sessions on this repository.

## Project

GoBye is a mobile-first ride-hailing platform for Nigeria ("Your ride. Your say."). Two apps — **GoBye** (Rider, `apps/rider`) and **GoBye Driver** (`apps/driver`) — built with React Native, Expo (SDK 57), Expo Router and TypeScript, sharing `packages/core` (pure TS domain logic + mock services) and `packages/ui` (design system + MingCute icons). Booking modes: **Quick Match** (accept platform fare) and **Negotiate** (propose fare, receive accepts/counteroffers). Current scope: complete functional frontend on **mock services**; backend integration later.

## Required reading order at the start of every session

1. `CLAUDE.md` (this file) 2. `AGENTS.md` 3. `README.md` 4. `LOG.md` 5. `docs/IMPLEMENTATION_PLAN.md` 6. `docs/DECISIONS.md` 7. Relevant sections of `docs/PRODUCT_REQUIREMENTS_DOCUMENT.md`, `docs/SRS.md`, `docs/ARCHITECTURE.md` 8. Inspect the actual source files 9. Identify completed vs incomplete work 10. Continue from the current state — never rebuild completed functionality.

## Brand rules

- Colour (D-034): a monochrome interface (black, white, neutral greys) with brand accents aubergine `#351A40` and tangerine `#FF751F` used only for logo details, illustrations, route lines, ratings and rewards. Status colours (success/warning/error) are separate and always paired with text or an icon. Use semantic tokens from `@gobye/ui` (DESIGN_SYSTEM §11), never raw hex in screens.
- Typography: Inter only, via `Text` from `@gobye/ui`.
- Do not invent logo geometry; brand assets are placeholders until supplied (`docs/ASSET_INVENTORY.md`). The owner's `Go-Bye_Working_Brand_Assets.zip` (received 2026-10-21) contains **working concepts only** — final colours, typography and vector logos are pending (Q-008); do not treat its green direction as final.
- No random gradients, extra shadows or decoration that competes with booking.
- Appearance: Light / Dark / System chosen in Account → Appearance (D-028); light pages are pure white. Follow the `layout` tokens and alignment rules in `docs/DESIGN_SYSTEM.md` §10.
- Payment is a separate stage after the trip (D-030): never ask for a method on the pricing screen, never show "Paid" before confirmation, and a bank transfer not yet seen is *pending*, not failed.

## Development standards

- TypeScript strict. No `any` without a comment explaining why.
- Route files in `src/app/` stay thin; feature UI in `src/features/`; business rules in `@gobye/core` with tests.
- Money is integer kobo (`Kobo`), formatted only with `formatNaira`.
- Use `npx expo install` for native packages (in a proxied environment: `EXPO_OFFLINE=1 npx expo install …`, which resolves from the SDK's bundled versions).
- Do not install unrelated packages. Record every new dependency in `docs/DEPENDENCIES_AND_LICENSES.md`.
- Never present mock data as live: use `SimulatedBadge` / "Simulated" copy for ETAs, driver location, payments, verification, emergency features.

## MingCute requirements

- Only `@mingcute/react-native` (Core Regular / Core Filled). Never `@mingcute/react`, icon fonts, or another icon library.
- Screens use `<Icon name="…" />` from `@gobye/ui`. Add new icons to `packages/ui/src/icons/registry.ts` after verifying the file exists in `node_modules/@mingcute/react-native/dist/styles/core-regular/`.
- Decorative icons are hidden from screen readers; the interactive parent has the label.

## Navigation conventions

- Expo Router JS `Tabs` (Rider: Home · Activities · Wallet · Account, D-032). Stack screens for booking steps; sheets (`Sheet`) for short choices, pages for long tasks.
- Android back must always do something sensible; booking-searching and active-trip screens confirm before leaving.
- Location pre-permission screens have one "Continue" button (HIG). Never request permissions at first launch.

## Restrictions

- Do not submit builds, create store records, or configure paid accounts without explicit authorisation.
- Do not use Apple In-App Purchase for ride fares.
- Do not hardcode pricing as confirmed policy — values live in `MOCK_PRICING_CONFIG` / `MOCK_PAYMENTS_CONFIG` and are documented as placeholders. Decided 2026-10-21: 0% per-trip commission and driver access packages (D-024; package prices provisional), launch payment methods Wallet + bank transfer with cash open and no cards (D-023). Processing fees are always shown separately from the fare.
- Driver location: When In Use + precise only; never request "Always" automatically (D-026).
- Maps: Google Maps Platform is only **proposed** (D-025); keep everything behind `MapService` / `MapCanvas` (D-004).
- Do not claim device testing that was not performed.
- Do not delete or replace documents without reading them.

## Infrastructure rules (D-051)

- Never put a secret in an `EXPO_PUBLIC_`, `VITE_` or `NEXT_PUBLIC_` variable, `.env.example`, `wrangler.*.toml` or git. Server secrets go in `wrangler secret put` / the backend's secret store. Run `npm run check:env` on env files.
- Apps and admin call the stable API (`https://api.gobye.app/v1`) through `createApiClient`; never hardcode a backend provider or origin in UI code.
- Files are uploaded only via a server-issued presigned URL **and** server-side completion (`/v1/files/*`); private files are never served from the public bucket or `media.gobye.app`. Unscanned files stay unreadable.
- No proxy in front of Vercel: website/admin DNS records stay DNS-only.
- Never retry a write with an uncertain outcome; look it up by idempotency key.
- Nothing is deployed, no DNS record changed and no paid service (e.g. Load Balancing) activated without explicit owner approval. Simulations (admin traffic page) must say so.
- Docs: `docs/INFRASTRUCTURE_*.md`, `API_GATEWAY.md`, `R2_STORAGE_ARCHITECTURE.md`, `DEPLOYMENT_RUNBOOK.md`.

## Backend API (D-059 to D-061)

- `apps/api`: NestJS on Fastify, Supabase PostgreSQL and Auth, StackShift as candidate host. Read `docs/BACKEND_ARCHITECTURE.md` first.
- Business rules come from `@gobye/core` (compiled into the API). Never re-implement them in the API.
- Migrations: forward-only SQL in `apps/api/migrations`. Never edit one after it is applied (`docs/DATABASE_MIGRATIONS.md`).
- Every write that creates or changes something takes an `Idempotency-Key` (`withIdempotency`) and writes its audit row in the same transaction.
- No real-money wallet, ledger, payouts or webhook endpoints until the reviews in `BACKEND_ARCHITECTURE.md` §9 are done.
- No Redis, ClickHouse, Kubernetes or new paid services without a measured need.
- Run `npm test -w apps/api` with PostgreSQL available. The database tests skip without it, so a pass without Postgres proves little. CI runs `npm run test:ci -w apps/api` with PgBouncer (`apps/api/test/pooler/start.sh`, `TEST_POOLER_URL`), where any skip fails.
- Database connections send **no session settings at start-up** (Supavisor transaction mode, C-1). Timeouts live on the role (`apps/api/db/roles.sql`) and in `SET LOCAL`.
- `npm run lint` (ESLint, root `eslint.config.mjs`) must be clean. Fix the code; don't disable rules to pass.
- WhatsApp quick booking (D-064, `docs/WHATSAPP_BOOKING.md`): the conversation lives in `@gobye/core` `whatsapp/`; WhatsApp only creates Quick Match rides, the app does everything else. Off unless `WHATSAPP_PROVIDER` is set.
- Staging is not ready until `docs/BACKEND_PHASE_1_VERIFICATION.md` §4.6 is all ticked. Never use the website/waitlist Supabase project for the backend.

## Documentation maintenance

At the end of each meaningful session: append to `LOG.md`; update `docs/IMPLEMENTATION_PLAN.md`, `docs/SCREEN_INVENTORY.md` statuses, `docs/DECISIONS.md`, `docs/TEST_PLAN.md` (tests actually run), `docs/OPEN_QUESTIONS.md`, `docs/BACKEND_HANDOVER.md` if contracts changed; state the next task. Code and docs must never disagree.

## Testing requirements

Before declaring work done: `npm run typecheck` and `npm test` from the repo root, and `npx expo export --platform android --platform ios` in the changed app(s). Add tests for every new business rule.

## Session continuation

The next logical task is always the first non-Done row of `docs/IMPLEMENTATION_PLAN.md` unless `LOG.md` "Next steps" says otherwise.
