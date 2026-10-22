# GoBye — Screen Inventory

Last updated 2026-10-21. Status legend: `Planned` · `In progress` · `Built (mock)` — implemented against mock services and type-checked · `Device-verified` — exercised on a real device (none yet).

Routes are relative to `apps/<app>/src/app/`.

## Rider app (GoBye)

| # | Screen | Route | Key components | Primary actions | States | Status |
|---|---|---|---|---|---|---|
| R01 | Launch gate | `index.tsx` | — | Redirect by session | loading | Built (mock) |
| R02 | Welcome | `onboarding.tsx` | Always dark; recorded 3D road loop (`assets/video/road-dark.mp4`, poster under Reduce Motion), agreed-fare chip, headline | Create account, Sign in | default, reduced motion, short screen | Built (mock) — redesigned 2026-10-22 (owner design) |
| R02a | Create account | `auth/signup.tsx` | Full name, email, phone (+234), password with show/hide, Apple / Google | Create account → verify phone | default, field errors, account exists, submitting | Built (mock) 2026-10-22 |
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
| D02 | Welcome / sign-in (phone + OTP) | `auth/*` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D03 | Registration: personal details | `onboarding/personal.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D04 | Driver's licence | `onboarding/licence.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D05 | Identity document | `onboarding/identity.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D06 | Vehicle information | `onboarding/vehicle.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D07 | Vehicle documents upload | `onboarding/documents.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D08 | Verification status (pending / approved / rejected) | `onboarding/status.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D09 | Dashboard (map, online toggle, earnings today) | `(tabs)/index.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D10 | Location explanation (When In Use + precise) | `permission-location.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D11 | Incoming Quick Match request | `request/[id].tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D12 | Incoming negotiation (accept / counter / decline) | `negotiation/[id].tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D13 | Active trip (to pickup → arrived → confirm passenger PIN → in progress → complete) | `trip.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D14 | Trip complete: payment status & earnings | `trip-complete.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D15 | Earnings & payouts | `(tabs)/earnings.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D16 | Trip history | `(tabs)/trips.tsx` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |
| D17 | Account: ratings, documents, notifications, support, settings, delete account | `(tabs)/account.tsx`, `account/*` | Built 2026-10-22 (simulated services; web QA walked, not device-tested) |

### Rider routes added during implementation

| Route | Purpose |
|---|---|
| `ride/[id].tsx` | R18 ride detail (shares `ReceiptView` with R15) |
| `trip-paid.tsx` / `trip-summary.tsx` | R14 success, R29b summary |

Rider navigation notes: finished flows (sign-in, booking, payment) reset the stack with `resetTo()` so Android back cannot return to them; Home and Activity show a "Current ride" entry while a booking is live.
