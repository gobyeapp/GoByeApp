# GoBye admin and staff dashboard — UI/UX redesign

Owner brief: "GoBye — Admin & Staff Dashboard Complete UI/UX Redesign" (received 2026-10-23).
Scope: **UI and UX only.** Routes, permissions, business rules (`@gobye/core`, `workspaces/*/logic.ts`), the
test dataset and the connected demo relay are kept as they are. Nothing in this redesign connects a backend,
takes real money or sends real messages; the prototype banner and "Simulated" labels stay.

Decision: the admin web uses **Jade Green `#0B7A5B` as its primary action colour**, Deep Aubergine `#251632`
for brand surfaces and Tangerine `#FF8A3D` as a sparing highlight (D-053). The mobile apps keep D-034/D-050.
Final brand colours are still Q-008; every colour is a token in `apps/admin/src/styles.css`, so a change is
one edit.

---

## 1. Audit — what exists (before)

App: `apps/admin` — Vite 7 + React 19 + react-router 7 (HashRouter), TypeScript strict, vitest + jsdom.
About 15.7k lines in 60 source files. Icons: MingCute through `src/ui/Icon.tsx` (`@mingcute/icons`, Core Regular).
Data: `PlatformProvider` (`src/data/store.tsx`) over `createPlatformDataset()` with simulated latency and
failures; `SessionProvider` (simulated staff sign in, `can()`, city scope); `FilterProvider` (city + date range);
`RecordProvider` (shared trip / passenger / driver panels).

Before screenshots: `docs/qa-screenshots/admin/before/`.

### 1.1 Page inventory (33 routes, all kept)

| Route | Page | Main roles | Purpose |
|---|---|---|---|
| `/overview` | Business overview | owner, admin, operations, finance, auditor | Health, attention list, money, quality, approvals, integrations |
| `/approvals` | Approvals | owner, admin, finance, auditor | Two-person decisions |
| `/staff` | Staff and access | owner, auditor | Staff, roles, city scope, invites |
| `/audit` | Activity and audit | owner, admin, finance, developer, auditor | Audit trail |
| `/reports` | Reports | owner, admin, finance, marketing, auditor | Exports |
| `/demo` | Connected demo | owner, admin, operations, onboarding… | Relay: rider app + driver app + admin (D-049) |
| `/live` | Live operations | operations, owner, admin | Searching / late pickups / active trips |
| `/trips` | Trips | operations, care, safety, finance | Every trip (Quick Match and Negotiate) |
| `/passengers` | Passengers | care, safety, operations | Accounts, restrict |
| `/drivers` | Drivers | onboarding, operations, safety | Review queue, documents, expiry |
| `/cases` | Support cases | care | Case queue and work |
| `/safety` | Safety | safety | Urgent incidents |
| `/finance/*` (8) | Collections, wallets, earnings, withdrawals, refunds, settlements, reconciliation, ledger | finance | Money operations |
| `/config/*` (5) | Service areas, categories, fares, packages, referrals | admin, owner | Versioned settings |
| `/comms`, `/promos`, `/events` | Announcements, promotions, events and partners | marketing | Growth |
| `/payments`, `/developer`, `/developer/events`, `/infrastructure/traffic` | Payments setup, integrations, events and failures, traffic | developer | Technical |

### 1.2 Roles (`packages/core/src/platform/permissions.ts`, unchanged)

owner · admin · operations · onboarding · care · safety · finance · marketing · developer · auditor (read only).
Access is the union of a staff member's roles; city scope narrows records. The brief's example roles map onto
these: super admin → owner; operations manager / dispatcher → operations; verification officer → onboarding;
support agent → care; safety officer → safety; finance → finance; marketing → marketing; engineer → developer;
read-only analyst → auditor. No new roles were invented.

Role landing pages (`ROLE_HOME`, kept): owner/admin → Home, operations → Live operations, onboarding → Drivers,
care → Support cases, safety → Safety, finance → Collections, marketing → Announcements, developer →
Integrations, auditor → Activity and audit.

### 1.3 Components (`src/ui/kit.tsx`)

PageHead, Section, Card, Stat, Pill, Button (async busy state), IconButton, Notice, Empty, Skeleton,
ErrorState, Table, SearchInput, Select, Segmented, Tabs, Field, KV, Timeline, Drawer, ConfirmDialog
(reason → audit), Bars, Meter. Shared record panels in `src/data/records.tsx`.

### 1.4 Issues found

| # | Area | Issue | Severity |
|---|---|---|---|
| A1 | Brand | Monochrome black primary; no brand colour on actions; black count badges read as errors | Medium |
| A2 | Shell | Sidebar fixed 252px, no collapse; 11 groups make a long scroll; no group for "People" or "Settings" | Medium |
| A3 | Shell | No breadcrumb, no global search, no notification panel; page title only inside content | Medium |
| A4 | Shell | Prototype tools (simulate failures, reset) sit in the navigation | Low |
| A5 | Responsive | At 375px the page scrolls sideways (topbar 24px, Overview 71px) | High |
| A6 | Data | Drivers badge (2) disagrees with Overview and the review queue (3): badge left out `documents_pending` | High |
| A7 | Data | Sidebar badges ignore the staff member's city scope | Medium |
| A8 | Format | Dates use the browser time zone, not Africa/Lagos (a UTC browser shows 21:00 for 22:00 WAT) | Medium |
| A9 | Layout | KPI grid (`auto-fill, 200px`) leaves a hole at the end of rows on wide screens | Low |
| A10 | Tables | No sticky header, no sorting, no row count/pagination on long lists | Medium |
| A11 | Settings | Config pages have no secondary navigation between them | Low |
| A12 | Charts | Bars are black; today highlighted with tangerine only (colour alone) | Low |
| A13 | Focus | Focus ring tangerine on white is 2.3:1 (below the 3:1 non-text contrast) | Medium |

## 2. Navigation (after)

| Group | Items |
|---|---|
| — | Home (`/overview`), Approvals |
| Operations | Live operations, Trips, Connected demo |
| People | Drivers, Passengers |
| Care and safety | Support cases, Safety |
| Finance | Collections, Passenger wallets, Driver earnings, Withdrawals, Refunds and disputes, Settlements, Reconciliation, Ledger |
| Growth | Announcements, Promotions, Events and partners |
| Insights | Reports |
| Settings | Service areas, Vehicle categories, Fare settings, Driver packages, Rewards and referrals |
| Administration | Staff and access, Activity and audit |
| Technical | Payments setup, Integrations, Events and failures, Traffic and origins |

Rules: a link shows only when the role can open the page (unchanged). Finance and Settings pages get a
secondary tab bar of their sibling pages. Every route path is unchanged, so bookmarks and tests keep working.

## 3. Design tokens

Defined once in `apps/admin/src/styles.css` (light + dark), documented in `DESIGN_SYSTEM.md` §12.

- Brand: jade `#0B7A5B` (press `#086348`), aubergine `#251632`, tangerine `#FF8A3D`, mint `#E7F5ED`.
- Surfaces: canvas `#F6F7F6`, surface `#FFFFFF`, sunken `#F1F3F2`; dark canvas `#0F0C13`, surface `#18141D`.
- Text: `#141A17` / secondary `#56605B` (6.5:1 on white) / dark `#F3F1F5` / `#ABA4B3`.
- Status (always with text or icon): success, warning, danger, info, neutral — each with a tinted background.
- Spacing 4px scale (`--s1` 4 … `--s10` 40); radii 8 / 12 / 16 (+ pill); shadows two levels; motion 120/200ms
  and off with `prefers-reduced-motion`.
- Layout: sidebar 240 / 64 collapsed, topbar 60, content max width 1280.
- Type: Inter; 12 / 13 / 14 / 16 / 20 / 24; tabular numbers on every figure.

## 4. Components (after)

New or reworked in `src/ui/`: `Shell` parts (Sidebar, Topbar, Breadcrumb, CommandPalette, NotificationsPanel,
UserMenu, SectionNav), `PageHead` (eyebrow, meta), `Stat` as KPI card (icon, tone, link), `FilterBar`,
`Table` (sticky header, optional sort, row count, pagination), `Pill` unchanged API, `Empty` (tone), `Drawer`
(focus trap), `Tabs` (keyboard arrows). Existing props were kept so every page compiles unchanged.

## 5. Accessibility

WCAG 2.2 AA targets: text contrast 4.5:1, non-text 3:1 (focus ring jade/ink double ring), 24px minimum
targets (36–40px used), visible focus everywhere, skip link, landmark roles, `aria-current="page"`,
keyboard-only command palette and menus (Escape closes, arrows move), status never colour alone,
reduced motion respected.

## 6. Formatting

Money with `formatNaira` (₦, kobo integers). Dates and times in **Africa/Lagos** (`en-NG`) via `src/data/format.ts`.

## 7. Backend-dependent items (shown as pending, not faked)

Real staff sign in and sessions; live driver locations and map; real notifications/push to staff;
server-side search; live payments, payouts and provider webhooks; exports beyond CSV of loaded rows;
infrastructure control plane. These stay labelled "Simulated" / "Test data" / "Needs the backend".

## 8. Implementation checklist

- [x] Audit pages, roles, components and issues; before screenshots
- [x] Tokens for light and dark: spacing, radii, type
- [x] Shell: collapsible sidebar (remembered; starts as a rail below 1200px), filled icon on the active page, regrouped navigation
- [x] Topbar: breadcrumb; Ctrl/Cmd+K search over permitted pages and loaded records; notifications panel from real dataset counts; account menu (theme, prototype tools, sign out)
- [x] Secondary navigation for Finance and Settings
- [x] Kit: KPI card, FilterBar, Table sort/sticky header/paging, two-tone focus ring, Lagos time zone, drawer focus handling
- [x] Fixed A5 (375px overflow), A6/A7 (badge counts and city scope), A8 (time zone), A9 (KPI grid), A10, A11, A12, A13
- [x] Pages: Home command centre; Operations; People; Care and safety; Finance; Growth, Settings, Technical, Administration
- [x] QA at 1440 / 1024 / 768 / 375 in light and dark: 32 routes × 8 = 256 captures, no sideways scroll, no page errors; contrast pairs computed
- [x] Typecheck, admin tests (263), admin build
- [x] Docs: LOG, DESIGN_SYSTEM §13, SCREEN_INVENTORY, IMPLEMENTATION_PLAN row 14, DECISIONS D-053, TEST_PLAN

## 9. Implementation report

**A. What changed**
- `styles.css`: rewritten as tokens plus components, light and dark.
- `App.tsx`: new shell and sign-in screen.
- `nav.tsx`: regrouped. Badges are now scoped to the viewer's cities and share the review-queue rule.
- New `src/shell/`: `CommandPalette`, `Popover`, `attention`, plus tests.
- `ui/kit.tsx`: upgraded components.
- `ui/Icon.tsx`: Core Filled variants and nine new icons.
- `data/format.ts`: Lagos time.
- Every page under `workspaces/` moved to the kit, with page CSS files for overview, operations, people, care, finance, config, growth and developer.

**B. Preserved**
- All 33 route paths, every permission check, role landing pages, business logic and data.
- The demo relay, the prototype banner and every Simulated / Test data label.

**C. Fixed**
- A5 to A13 above. The visible ones: the drivers badge disagreed with the queue (2 vs 3); phones scrolled sideways by 24 to 71px; times showed in the computer's time zone.

**D. New capabilities (UI only)**
- Search with Ctrl/Cmd+K.
- Notifications panel.
- Deep links `?open=<id>` for support and safety cases.
- Sortable, paged tables.
- Roles and permissions matrix (read only).
- Audit timeline view.
- Finance workflow steps and rules callouts.

**E. Accessibility**
- Contrast pairs computed: §3 and D-053.
- Skip link; landmarks; `aria-current` and `aria-sort`.
- Keyboard: command palette (combobox + listbox), tabs with arrow keys, drawers with focus handling, menus closing on Escape.
- Status never shown by colour alone; reduced motion respected.

**F. Tests**
- Admin: 263 passed, including 8 new shell tests and 5 new care/safety page tests.
- Whole repo: `npm run typecheck` clean; `npm test` all green; `vite build` OK.
- Screenshots: `docs/qa-screenshots/admin/before/` and `after/`.

**G. Pending (needs the backend)**
- Real staff sign in.
- Server-side search across all records.
- Push or email alerts to staff.
- Live locations and map.
- Real payments, payouts and webhooks.
- Exports beyond the loaded rows.
- The infrastructure control plane.
- Device and screen-reader testing on real hardware has not been done.
