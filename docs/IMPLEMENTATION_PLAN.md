# GoBye — Implementation Plan

Status values: `Not started` · `In progress` · `Done (mock)` · `Done` · `Blocked`. Update at the end of every session (see `CLAUDE.md`). Last updated 2026-10-21.

| Phase | Deliverable | Depends on | Acceptance criteria | Status |
|---|---|---|---|---|
| 0A | Official-source research (Apple, Expo, Android) | — | `RESEARCH_SOURCES.md` lists every source with date and decision | Done |
| 0A | Expo skills verification | — | Result recorded in D-013 / LOG | Done (plugin not installable in cloud session; enabled via `.claude/settings.json`) |
| 0B | MingCute install + name verification + `<Icon>` wrapper | 1 | Registry names compile against installed package; no direct MingCute imports outside `packages/ui` | Done (66 icons, Regular + Filled, render-tested) |
| 0C | Documentation set | 0A | All files from the brief exist and agree with each other | Done |
| 1 | Monorepo architecture, shared packages, typed services, mocks | 0C | `npm run typecheck` passes for all workspaces | Done (mock) |
| 2 | Design system tokens + shared components | 1 | Components documented in `DESIGN_SYSTEM.md`; component tests pass | Done |
| 3 | Rider app: auth, permission, home, search, options, Quick Match, Negotiate, trip, payment, receipt, rating | 2 | Full mock journey navigable end to end; core logic tests pass; Android/iOS bundles export | Done (mock) — not yet device-verified |
| 3 | Rider account area (history, places, wallet, notifications, rewards, safety, support, settings, delete account) | 3 | All R17–R28 reachable and functional with mock data | Done (mock) — not yet device-verified |
| 3b | Testing feedback & UI update brief (appearance, onboarding, home/pickup, pricing, matching, active trip, payment stage, completion, Wallet tab, referrals, Account) | 3 | Brief §1–15 items implemented on mocks; typecheck, tests and bundles pass | Done (mock) — device verification pending |
| 4 | Driver app (onboarding, verification, dashboard, requests, negotiation, trip lifecycle, earnings, account) | 2, 3 | D01–D17 functional with mock services; background-location flow documented and gated | In progress (configured shell + placeholder screen only) |
| 5 | Maps provider evaluation & live location | Q-007 | Provider chosen, keys configured per app, `MapService` HTTP impl | Not started (mock map done in 3) |
| 6 | Payments/pricing integration | Q-001, Q-002, backend | Backend quotes; provider SDK/webview; receipts from server | Not started |
| 7 | Motion polish & Reduce Motion audit | 3, 4 | Every animation has reduced-motion path | Not started |
| 8 | Testing: device matrix, accessibility audit | 3, 4 | `DEVICE_TEST_MATRIX.md` rows executed | Not started |
| 9 | Release readiness (EAS, TestFlight internal, Play internal testing) | 8, approvals | `APP_STORE_COMPLIANCE.md` checklist complete; owner authorisation | Not started |
| 10 | Management platform specification (`docs/management/`) | owner brief 2026-10-21 | Every module covers users, screens, fields, actions, approvals, transitions, effects, jobs, states, acceptance | Done (draft for owner review) |
| 11 | Management prototype (`apps/admin`) on test data | 10 | All workspaces clickable per role; permissions, approvals, ledger and audit simulated; tests pass | Done (prototype, test data) |
| 12 | Management backend: phases 1 to 7 of `docs/management/10-implementation-and-acceptance.md` | backend, Q-056 to Q-061 | Commands, events, jobs and integrations live; journeys J-01 to J-15 pass | Not started |
| 13 | Infrastructure foundation (D-051): config, API client, file pipeline + R2, API gateway, traffic switching, realtime client, observability, Vercel headers | owner brief 2026-10-23 | Brief §20 acceptance criteria; all infra tests pass; nothing deployed without approval | Done in code, tested locally (`INFRASTRUCTURE_REPORT.md`). Pending: backend/database/auth selection (Q-064, Q-065), credentials, staging deployment, scanner (Q-067), realtime (Q-066), CI |
| 14 | Admin and staff dashboard UI/UX redesign (`ADMIN_DASHBOARD_REDESIGN.md`, D-053) | 11, owner brief 2026-10-23 | Tokens light/dark, role-aware shell, search, notifications, every page on the shared kit, responsive 1440/1024/768/375, WCAG 2.2 AA checks, tests pass | Done (prototype, test data). Pending: backend for real search, staff alerts and sign in |
| 15 | Payment configuration and Automation Centre (`PAYMENTS_AUTOMATION_ARCHITECTURE.md`, D-054, D-055) | 11, 13, owner brief 2026-10-23 | Provider-independent adapter, versioned fee schedules with approval and disclosure, separated money figures, credit/payout/switch guards, automation registry with protected retries, admin screens, tests | Done in code on test data. Pending: provider (Q-042) and adapter, fee values (Q-073), backend and job runner (Q-064, Q-074) |
| 16 | Premium white admin redesign + 3D icons + subscriptions, staff workspaces, infrastructure costs (D-056, D-057) | 14, 15, owner briefs 2026-10-23 | White rule everywhere, elevation, new shell, metric variants, 23 dimensional assets, new modules, QA at 4 widths, tests | Done (prototype, test data). Pending: art direction review of the 3D assets, map provider, billing integrations, backend |
| 17 | One driver pass timeline for the Driver App and admin (D-058): stacking, voids, idempotent writes, shared API response | 16, owner brief 2026-10-23 | Tests for every stacking, duplicate, refund and expiry case; both apps render the same response | Done (prototype). Pending: backend table and verification job, pro-rata refunds and grace (Q-043) |

## Testing requirements per phase

- Phases 1–3: Jest unit tests for every rule in `BUSINESS_RULES.md` that the client enforces (pricing, ranges, expiry, selection locking, state transitions, validators); `tsc --noEmit` clean; `expo export` bundles for iOS and Android.
- Phase 3+: component tests for accessibility roles/labels/states of shared components.
- Phase 8: manual device tests recorded in `DEVICE_TEST_MATRIX.md`.

## Next tasks (in order)

0. Infrastructure (D-051): rotate the credentials shared in chat; add CI (typecheck, tests, `check:env`); wire `publicConfig` + `assertMocksAllowed` into both apps; then the ordered list in `INFRASTRUCTURE_REPORT.md` §8.
1. Run the Rider app on real devices via Expo Go (SDK 57) — iOS and Android — and record results in `DEVICE_TEST_MATRIX.md`; fix layout issues found.
2. Product owner decisions still needed: Q-001 cash, Q-042 payment provider & real fees, Q-043 package billing, Q-044 Google Maps cost projection (then accept D-025), Q-046 name/tagline, Q-047 palette, Q-048 font, Q-049 navigation. (Resolved 2026-10-21: Q-002, Q-012; partly: Q-001, Q-007, Q-008.)
3. Phase 4 — Driver app (UI built end to end on simulated services 2026-10-22; remaining: device testing, development build with `expo-task-manager` for background location, backend contracts): onboarding & verification (D02–D08), dashboard with online toggle and background-location explanation (D09–D10), requests & negotiation (D11–D12), trip lifecycle (D13–D14), earnings/account (D15–D17). Add `expo-task-manager` and a development build profile.
4. Accessibility audit on device (VoiceOver, TalkBack, largest text sizes, Reduce Motion).
