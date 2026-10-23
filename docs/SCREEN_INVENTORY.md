# GoBye — Screen Inventory

Last updated 2026-10-21. Status legend: `Planned` · `In progress` · `Built (mock)` — implemented against mock services and type-checked · `Device-verified` — exercised on a real device (none yet).

Routes are relative to `apps/<app>/src/app/`.

## Rider app (GoBye)

| # | Screen | Route | Key components | Primary actions | States | Status |
|---|---|---|---|---|---|---|
| R01 | Launch gate | `index.tsx` | — | Redirect by session | loading | Built (mock) |
| R02 | Welcome | `onboarding.tsx` | Follows Light / Dark; recorded 3D road loop per scheme (`assets/video/road-dark.mp4` / `road-light.mp4`, poster under Reduce Motion), headline | Create account, Sign in | default, reduced motion, short screen | Built (mock) — redesigned 2026-10-22 (owner design) |
| R02a | Create account (journey) | `auth/signup.tsx` | Plum hero + route progress; steps You (name, Apple/Google) · City (tiles, state sheet) · Contact (email, phone) · Secure (password, strength) | Continue / Create account (brand CTA), round Back, Close | default, per-step errors, account exists, submitting | Built (mock) — rebuilt 2026-10-22 as the website waitlist journey (D-047) |
| R02d | Rider pass | `auth/pass.tsx` | RiderPass (plum top, name, city, member since, perforation, verified) | Start riding | default, reduced motion | Built (mock) 2026-10-22 |
| R02b | Sign in | `auth/signin.tsx` | Apple / Google, email or phone, password | Sign in → verify phone, Forgot password, Create account | default, field errors, wrong details (one neutral message) | Built (mock) 2026-10-22 |
| R02c | Reset password | `auth/reset.tsx` | Email → 6 digit code + new password | Send code, Resend, Save | default, invalid, wrong code, cooldown | Built (mock) 2026-10-22 |
| R03 | Your phone number (new Apple / Google account) | `auth/phone.tsx` | TextField (+234), privacy note | Send code | default, invalid, submitting, error | Built (mock) — redesigned 2026-10-22 |
| R04 | Verify your number | `auth/otp.tsx` | Icon tile, CodeBoxes, Button | Verify, Resend (cooldown), Change number | default, invalid, submitting, error, resend-cooldown | Built (mock) — redesigned 2026-10-22 |
| R05 | Name / profile setup | `auth/name.tsx` | TextField ×2, Checkbox (terms) | Continue | default, invalid | Built (mock) |
| R06 | Location pre-permission | `permission-location.tsx` | Illustration, Button ("Continue") | Continue → system prompt; "Enter pickup manually" | default, denied, restricted | Built (mock) |
| R07 | Home | `(tabs)/index.tsx` | MapCanvas (pickup pin with own photo), avatar button, "For me / Someone else" selector (PassengerSheet), bold "Where are you going?" + destination field, pickup row with edit pencil (PickupSheet), saved/recent places, Invite friends row | Search destination, edit pickup (search / map / current location), choose passenger, recenter | locating, located, permission denied/approximate, live ride, payment outstanding (blocks new booking) | Built (mock) — updated 2026-10-21 |
| R08 | Destination / pickup search | `booking/search.tsx` | TextField, results, saved & recent, "Choose on map" (pickup), tappable "From" row | Pick result, edit pickup, choose on map | empty, typing, results, no results, error | Built (mock) |
| R09 | Ride options | `booking/options.tsx` | MapCanvas (route), editable pickup/destination summary, CategoryCard (config category + car render), SegmentedControl (Quick Match / Negotiate), fare breakdown, "pay after the trip" note | Edit pickup/destination (re-routes and re-prices), choose mode, see breakdown, Book | quoting, quoted, quote expired (auto-refresh, error on failure), unavailable, unpaid trip blocks booking | Built (mock) — payment selection removed 2026-10-21 (D-030) |
| R10 | Choose pickup on map | `booking/pickup-map.tsx` | MapCanvas, fixed centre pin, address panel | Drag map, Confirm pickup | finding address, found, not found | Built (mock) — new 2026-10-21 (old payment picker route removed; method choice is a sheet on R14) |
| R11 | Negotiate | `booking/negotiate.tsx` | FareStepper, range hint, offer timer, DriverResponseCard list | Send offer, raise offer, select response, switch to Quick Match, cancel | composing, invalid, offer open, responses, response expired, offer expired, driver unavailable, max rounds | Built (mock) |
| R12 | Searching (Quick Match) | `booking/searching.tsx` | Pulse animation, category + fare | Cancel | searching, no drivers (rebook), error | Built (mock) — no driver shown until assigned |
| R13 | Matched / arrival / active trip | `trip.tsx` | MapCanvas (distinct markers, stale vehicle), driver photo/name/rating/trips, VehicleSummary (actual colour/model/plate), ETA progress from trip data, pickup PIN, pickup & destination rows, agreed fare (no meter), HelpSheet | Message/Call (simulated), share trip, safety, help (emergency 112, report, ask driver to end trip), cancel only before pickup | en route, arrived, in progress, reconnecting (stale location) | Built (mock) — updated 2026-10-21 |
| R14 | Payment successful | `trip-paid.tsx` | CompletionMark (green), amount paid once, method | Continue | shown only after verified payment; redirects to trip-complete otherwise | Built (mock), 2026-10-21 end-of-trip redesign (D-036) |
| R15 | Receipt | `receipt/[id].tsx` | Payment status badge, fare, fee line only if > 0, actual vehicle | Download/share PDF, Rate, Report issue | default | Built (mock) — branded ticket redesign 2026-10-22 |
| R16 | Rate driver | `rate/[id].tsx` | Star rating, chips, TextField | Submit, Skip | default, low-rating reasons, submitted | Built (mock) |
| R17 | Activities | `(tabs)/activity.tsx` | Current ride card, history rows with payment status badge and total | Open ride | loading, empty, list | Built (mock) |
| R18 | Ride detail | `ride/[id].tsx` | Receipt summary | View receipt, Get help | default | Built (mock) |
| R19 | Account | `(tabs)/account.tsx` | Avatar header (add/replace photo), ListGroup: Basic details, Preferences, Support & safety, Account actions | Navigate, change photo, sign out, delete | default | Built (mock) — regrouped 2026-10-21 |
| R20 | Profile | `account/profile.tsx` | TextField | Save | default, saving, invalid | Built (mock) |
| R21 | Saved places | `account/places.tsx` | ListItem | Add home/work (via search), remove | empty, list | Built (mock) |
| R22 | Wallet (tab) | `(tabs)/wallet.tsx` | Available / reserved / pending, Add money (DepositSheet with copyable transfer details), filter chips, TransactionRow with status | Add money, check deposit status (sheet or history row), filter, pull to refresh | loading, empty, error + retry, pending, successful, failed, reversed | Built (mock) — moved to a tab 2026-10-21 (D-032) |
| R23 | Notifications | `account/notifications.tsx` | ListItem | Mark read | empty, list | Built (mock) |
| R24 | Referrals | `account/rewards.tsx` | Code + link (CopyRow), share, rules from config, progress, Invited/Qualified/Rewarded counts, activity list | Copy, share | loading, empty, error, programme off | Built (mock) — rebuilt 2026-10-21 |
| R25 | Safety | `account/safety.tsx` | Info cards, trusted contact | Add trusted contact (local only) | default | Built (mock) |
| R26 | Support | `account/support.tsx` | Topic list, TextField | Submit request (simulated) | default, submitted | Built (mock) |
| R27 | Legal & licences | `account/settings.tsx` | Policies, open-source licences, brand palette preview | Open links | default | Built (mock) — non-working toggles removed |
| R28 | Delete account | `account/delete.tsx` | Warning, checklist, confirm | Request deletion (simulated) | default, confirming, requested | Built (mock) |
| R29 | Trip completed: pay | `trip-complete.tsx` | CompletionMark (neutral), amount due once, View breakdown sheet, method row with Change, PaymentMethodSheet, TransferSheet (copy account/amount/reference), DepositSheet | Pay ₦X (wallet charge or open transfer details), I've transferred, Check again, Try again, Add money, Check later (only while a sent payment awaits confirmation; no Pay later since 2026-10-22) | idle, wallet short (shortfall line), processing (label in button, controls locked), transfer pending (not received), failed, reversed | Built (mock), redesigned 2026-10-21 (D-036) |
| R29b | Trip summary | `trip-summary.tsx` | Rating card (Skip), compact driver and vehicle, receipt Download/Share, expandable Trip details and Payment details | Rate, Skip, Download, Share, Back to Home | unrated, rated, skipped | Built (mock), 2026-10-21 (D-036) |
| R30 | Appearance | `account/appearance.tsx` | RadioRow ×3 | Light, Dark, System (saved, applied immediately) | default | Built (mock) — new 2026-10-21 (D-028) |
| R31 | Location access | `account/location.tsx` | Permission state, approximate notice | Open Settings | granted, approximate, denied, undetermined | Built (mock) — new 2026-10-21 |

## Driver app (GoBye Driver) — planned, Phase 4

| # | Screen | Route (planned) | Status |
|---|---|---|---|
| D01 | Launch gate (+ D02a welcome `welcome.tsx`, access pass `access.tsx`, trip detail `history/[id].tsx`) | `index.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D02 | Welcome (road video, Light / Dark) and accounts: Become a driver (You → City → Contact → Secure), Sign in (account → password), Reset password, phone (new Apple / Google), code, driver pass | `welcome.tsx`, `auth/signup|signin|reset|phone|otp|pass.tsx` | Rebuilt 2026-10-22 to match the rider app (D-048; simulated services; web QA walked, not device-tested) |
| D03 | Registration: personal details (prefilled, and saved from the driver pass, after sign up) | `onboarding/personal.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D04 | Driver's licence | `onboarding/licence.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D05 | Identity document | `onboarding/identity.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D06 | Vehicle information | `onboarding/vehicle.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D07 | Vehicle documents upload | `onboarding/documents.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D08 | Verification status (pending / approved / rejected) | `onboarding/status.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D09 | Dashboard (map, online toggle, earnings today); before approval a verification card: Register → Review → Drive, steps to do, flagged fixes, checks waiting on an outside office (D-049) | `(tabs)/index.tsx`, `features/verification/VerificationCard.tsx` | Built 2026-10-22; card 2026-10-22 (simulated or demo relay; web QA walked, not device-tested) |
| D10 | Location explanation (When In Use + precise) | `permission-location.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D11 | Incoming Quick Match request | `request/[id].tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D12 | Incoming negotiation (accept / counter / decline) | `negotiation/[id].tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D13 | Active trip (to pickup → arrived → confirm passenger PIN → in progress → complete) | `trip.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D14 | Trip complete: payment status & earnings | `trip-complete.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D15 | Earnings & payouts | `(tabs)/earnings.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D16 | Trip history; trip detail as a branded earnings statement (`history/[id].tsx`, `features/trip/TripStatement.tsx`) | `(tabs)/trips.tsx` | Built 2026-10-22; statement added 2026-10-22 (simulated; web QA walked, not device-tested) |
| D17 | Account: ratings, documents, notifications, support, settings, delete account | `(tabs)/account.tsx`, `account/*` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |

### Rider routes added during implementation

| Route | Purpose |
|---|---|
| `ride/[id].tsx` | R18 ride detail (shares `ReceiptView` with R15) |
| `trip-paid.tsx` / `trip-summary.tsx` | R14 success, R29b summary |

Rider navigation notes: finished flows (sign-in, booking, payment) reset the stack with `resetTo()` so Android back cannot return to them; Home and Activity show a "Current ride" entry while a booking is live.

## Management platform (admin web, `apps/admin`) — redesigned 2026-10-23

Prototype on test data (D-053, `ADMIN_DASHBOARD_REDESIGN.md`). Every page uses the shared shell and kit. Each was checked at 1440, 1024, 768 and 375 px in light and dark: none scrolls sideways and none shows a page error.

| Group | Route | Screen | Status |
|---|---|---|---|
| Home | `/overview` | Home: greeting, attention list, KPIs, money (kept separate), daily trips chart (Lagos days), cities, approvals, integration health | Redesigned |
| Home | `/approvals` | Approvals: request cards, two-person rule, decided table | Redesigned |
| Operations | `/live` | Live operations: KPIs, problem cards, availability, active journeys (simulated locations) | Redesigned |
| Operations | `/trips` | Trips: Quick Match / Negotiated KPIs, status chips, filter bar, sortable paged table | Redesigned |
| Operations | `/demo` | Connected demo (relay) | Restyled, behaviour unchanged |
| People | `/drivers` | Drivers: KPIs, review queue, documents progress, sectioned review sheet with pinned actions | Redesigned |
| People | `/passengers` | Passengers: KPIs, filter bar, sortable paged table, restriction notice | Redesigned |
| Care and safety | `/cases` | Support cases: queue KPIs, filters, sortable paged table, case sheet with pinned actions, `?open=` link | Redesigned |
| Care and safety | `/safety` | Safety: unacknowledged first, `?open=` link, restricted-info notices | Redesigned |
| Finance | `/finance/*` (8) | Collections, wallets, earnings, withdrawals, refunds, settlements, reconciliation, ledger: KPIs, workflow steps, rules callouts, filter bars, sortable tables | Redesigned |
| Growth | `/comms`, `/promos`, `/events` | Announcements, promotions, events | Redesigned |
| Insights | `/reports` | Reports: available exports (CSV of loaded test data) | Redesigned |
| Settings | `/config/*` (5) | Versioned settings: in force vs draft, before/after, three-step editor | Redesigned |
| Administration | `/staff`, `/audit` | Staff (people + roles and permissions matrix), activity (timeline / table) | Redesigned |
| Technical | `/payments`, `/developer`, `/developer/events`, `/infrastructure/traffic` | Payments readiness, integrations by state, events log, traffic simulation | Redesigned |
| Shell | all | Sidebar and rail, breadcrumb, Ctrl/Cmd+K search, notifications, account menu, Finance and Settings sub-navigation | New |

### Payments and Automation Centre (admin, 2026-10-23, D-054 / D-055)

| Group | Route | Screen | Status |
|---|---|---|---|
| Payments | `/payments` | Payment providers: readiness, adapter contract, capability coverage, safe provider switch, secrets notice | Built (test data) |
| Payments | `/payments/fees` | Fee configuration: schedule in force, versions, finance draft editor, owner approval, customer disclosure preview, confirmed pricing | Built (no fee set) |
| Payments | `/payments/health` | Gateway health: connection, webhooks, money in flight, reconciliation; monitoring not connected | Built (test data) |
| Payments | `/payments/operations` | Payment operations: five money figures apart, stuck items, safety rule per row | Built (test data) |
| Automation | `/automation` | Workflow registry (13 workflows) | Built (runner not connected) |
| Automation | `/automation/schedules` | Scheduled jobs | Built (runner not connected) |
| Automation | `/automation/runs` | Execution history | Built (simulated runs) |
| Automation | `/automation/failed` | Failed jobs: Retry / Look up / Cancel with protected rules | Built (simulated runs) |
| Automation | `/automation/settings` | Automation settings with approval | Built (placeholder values) |
| Automation | `/automation/audit` | Audit history for automation, fee and provider changes | Built |
