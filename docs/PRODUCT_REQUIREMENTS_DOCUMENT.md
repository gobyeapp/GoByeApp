# GoBye — Product Requirements Document (PRD)

**Products:** GoBye (Rider app) · GoBye Driver · future Operations/Admin integrations
**Tagline:** Your ride. Your say.
**Status:** Draft, 2026-10-21. Nothing in this document is implemented unless `SCREEN_INVENTORY.md` says so. All prices, timers and percentages referenced are **mock placeholders** (`BUSINESS_RULES.md`, D-007), except the product-owner decisions of 2026-10-21: launch payment methods Wallet + bank transfer (D-023), 0% per-trip commission with driver access packages at provisional prices (D-024), driver location policy (D-026). Google Maps Platform is a **proposed** provider (D-025). All success-metric targets are **proposals**.

Related: `SRS.md` (testable requirements), `USER_FLOWS.md`, `UI_STATES.md`, `BUSINESS_RULES.md` (BR-xxx), `SCREEN_INVENTORY.md` (Rxx/Dxx), `OPEN_QUESTIONS.md` (Q-xxx).

---

## 1. Vision

A Nigerian ride-hailing service where passengers choose how they agree a price: accept a transparent platform fare (**Quick Match**) or propose their own within safeguards (**Negotiate**). Drivers see what they will earn before accepting. Both apps are native mobile experiences (React Native/Expo), map-first, accessible, and honest about anything simulated.

## 2. Business objectives

| ID | Objective | Measure (see §10) |
|---|---|---|
| OBJ-1 | Give passengers price control without unsafe haggling | Negotiate adoption, offer-to-match rate |
| OBJ-2 | Fast, predictable matching for passengers who don't want to negotiate | Quick Match time-to-match |
| OBJ-3 | Transparent driver earnings to attract and retain drivers | Driver weekly active, acceptance rate |
| OBJ-4 | Trust and safety: verified drivers, clear fares, fee disclosure before cancel | Verified-driver ratio, dispute rate |
| OBJ-5 | Store-compliant, privacy-respecting apps (Apple/Google, NDPA — legal review) | Zero compliance rejections |
| OBJ-6 | Backend-ready frontend: swap mocks for real services without UI rewrites | Service interfaces unchanged at integration |

## 3. Scope of the current phase

The current phase delivers **frontend apps with mock services** (ARCHITECTURE §5). Simulated data (drivers, ETAs, payments, verification) is labelled "Simulated" in the UI (BR-104). Mock builds may go to TestFlight internal testing only (`APP_STORE_COMPLIANCE.md`).

## 4. Personas

| ID | Persona | Context | Needs | Pain points | Primary features |
|---|---|---|---|---|---|
| P-R1 | **Tolu, Lagos commuter** (32, office worker, Ikeja → Victoria Island) | Daily commute, traffic-heavy routes, mid-range Android/iPhone, intermittent data | Reliable pickup, predictable price, quick booking | Surge surprises, drivers cancelling, wrong pickup pins | Quick Match, saved places (Home/Work), trip tracking |
| P-R2 | **Ada, budget-conscious student** (20, UNILAG) | Price-sensitive, low-end Android, small data bundle | Cheapest fair price, control over spend | Fixed prices too high at peak; fear of being overcharged | Negotiate, Keke/Go categories, cash payment (cash not a launch method — open, Q-001; bank transfer/wallet at launch) |
| P-R3 | **Musa, Keke rider** (conditional — Keke availability is Q-004) | Short neighbourhood trips, cash-first | Cheap short hops, fast pickup | Long waits, unclear fares | Keke category, Negotiate, cash (open, Q-001) |
| P-D1 | **Emeka, full-time driver** (40, owns a Toyota Corolla) | 8–10 h/day online, earnings is livelihood | Steady requests, clear earnings, fast payouts | Low offers, idle time, commission opacity | Online toggle, earnings preview (full fare, 0% commission — D-024), monthly access package, counteroffers, payouts |
| P-D2 | **Funmi, part-time driver** (28, drives evenings/weekends) | Online in short windows; battery and data conscious | Easy online/offline, request choice | Battery drain, background tracking concerns | Online toggle with background-location explanation, decline freely |
| P-A1 | **Ops admin** (future) | Internal web console (not in this project) | Verify drivers, resolve disputes, adjust pricing config | — | US-A stories (backend/admin dependencies only) |

## 5. Feature overview

### 5.1 Rider (GoBye)

| ID | Feature | Screens | Rules | Phase |
|---|---|---|---|---|
| F-R01 | Onboarding & phone/OTP sign-in | R01–R05 | D-008 | 3 |
| F-R02 | Location permission (When In Use) & manual pickup | R06, R07, R08 | D-012 | 3/5 |
| F-R03 | Map-first Home ("Where are you going?") | R07 | — | 3/5 |
| F-R04 | Place search, saved & recent places, choose on map | R08, R21 | — | 3/5 |
| F-R05 | Route preview, distance, ETA (simulated label) | R09 | — | 5 |
| F-R06 | Vehicle category selection | R09 | BR-010, BR-011 | 3 |
| F-R07 | Fare quote & breakdown, quote expiry | R09 | BR-020–BR-023 | 6 |
| F-R08 | Quick Match booking & searching | R09, R12 | BR-030–BR-033 | 3 |
| F-R09 | Negotiate: offer, responses, counteroffers, selection | R11 | BR-040–BR-049 | 3 |
| F-R10 | Payment method selection (Wallet, bank transfer), separate processing-fee disclosure, wallet UI (simulated) | R10, R22 | BR-100–BR-106 | 6 |
| F-R11 | Active trip tracking, driver details, cancel with fee notice | R13 | BR-080–BR-081, BR-090 | 3 |
| F-R12 | Payment result (wallet auto-charge; bank transfer awaiting confirmation), failure recovery, receipt with fare and fee as separate lines | R14, R15 | BR-103, BR-105, BR-107, BR-108 | 6 |
| F-R13 | Rating | R16 | BR-111 | 3 |
| F-R14 | Activity (history), ride detail | R17, R18 | — | 3 |
| F-R15 | Account: profile, notifications, rewards/referral, safety (UI only), support, settings | R19–R27 | BR-110, BR-120 | 3 |
| F-R16 | Account deletion (initiation) | R28 | — | 3 |
| F-R17 | State recovery after app kill | all booking screens | ARCHITECTURE §4 | 3 |

### 5.2 Driver (GoBye Driver)

| ID | Feature | Screens | Rules | Phase |
|---|---|---|---|---|
| F-D01 | Sign-in (phone/OTP) & registration | D01–D03 | D-008 | 4 |
| F-D02 | Licence, identity, vehicle info & documents | D04–D07 | SECURITY §7 | 4 |
| F-D03 | Verification status (pending/approved/rejected) | D08 | BR-070, BR-071 | 4 |
| F-D04 | Dashboard: map, online/offline, earnings today | D09 | — | 4 |
| F-D05 | Location explanation & permission (When In Use + precise; never Always) | D10 | D-012, D-026 | 4/5 |
| F-D06 | Quick Match request: accept/decline with earnings preview | D11 | BR-060, BR-061 | 4 |
| F-D07 | Negotiation request: accept/counter/decline | D12 | BR-043–BR-045 | 4 |
| F-D08 | Trip lifecycle: to pickup → arrived → confirm passenger → in progress → complete | D13 | BR-090 | 4 |
| F-D09 | Trip complete: payment status & estimated earnings | D14 | BR-061 | 4/6 |
| F-D10 | Earnings, wallet & payouts UI | D15 | BR-060 | 4/6 |
| F-D11 | Trip history, ratings, documents, notifications, support, settings, delete account | D16, D17 | — | 4 |
| F-D12 | Access packages: buy Daily/Monthly access (provisional prices), status and expiry; required to go online | D09, D15 (screen TBD) | BR-062, BR-072, D-024 | 4/6 |
| F-D13 | Location session & tracking health: activity-based updates, stale/approximate/interrupted detection, requests paused with reason | D09, D13 | BR-073, D-026 | 4/5 |

### 5.3 Future Admin / Ops integrations (backend; no admin UI in this project)

| ID | Capability | Consumed by apps as |
|---|---|---|
| F-A01 | Driver verification review (approve/reject with reason) | Verification status + rejection reason on D08 |
| F-A02 | Pricing config management (rates, ranges, TTLs, fees) | Quote and negotiation range from API |
| F-A03 | Dispute & support ticket handling | Ticket status in R26/D17 |
| F-A04 | Refunds & fee waivers | Receipt payment status, wallet transactions |
| F-A05 | Driver suspension / document expiry | Eligibility, D08 status |
| F-A06 | Service-area & category availability | Category availability on R09 (BR-010) |

## 6. User stories

Priority: **M** must (current phase), **S** should, **C** could, **F** future/backend.

### 6.1 Rider

| ID | Story | Pri | Acceptance criteria |
|---|---|---|---|
| US-R-001 | As a new rider, I want a short onboarding so I understand Quick Match vs Negotiate. | M | ≤ 3 pages; Skip available; "Get started" leads to sign-in. |
| US-R-002 | As a rider, I want to sign in with my Nigerian phone number and a one-time code. | M | Accepts `+234…`/`0…` formats, normalises to E.164; invalid number shows inline error; OTP 6 digits; resend has a cooldown; mock rejects `000000`. |
| US-R-003 | As a new rider, I want to enter my name and accept the terms. | M | First/last name required; terms & privacy links open; Continue disabled until valid. |
| US-R-004 | As a rider, I want to understand why location is needed before the system prompt. | M | R06 shows explanation and a single "Continue" button; system prompt only after Continue; no prompt at launch. |
| US-R-005 | As a rider who denied location, I want to still book by typing my pickup. | M | Home/search show "Enter pickup manually"; booking completes without location permission. |
| US-R-006 | As a rider with approximate location, I want to confirm my pickup pin. | M | "Your location is approximate" shown; pin confirmation required before quote. |
| US-R-007 | As a rider, I want to search for a destination or pick a saved place. | M | Results after typing; empty/no-results/error states; saved Home/Work one tap. |
| US-R-008 | As a rider, I want to see the route, distance and ETA before booking. | M | Route drawn; distance & duration shown; simulated values labelled "Simulated". |
| US-R-009 | As a rider, I want to compare vehicle categories and prices. | M | Each available category shows price; unavailable categories disabled with reason (BR-010). |
| US-R-010 | As a rider, I want a fare breakdown. | M | Base, distance, time, multiplier (if ≠ 1.0), total (BR-023). |
| US-R-011 | As a rider, I want to book at the suggested fare (Quick Match). | M | Book disabled during submission (BR-033); searching screen shown; matched driver shown with ETA. |
| US-R-012 | As a rider, I want to propose my own fare (Negotiate). | M | Offer limited to allowed range with ₦50 steps (BR-040/041); range hint visible; invalid offers explained. |
| US-R-013 | As a rider, I want to compare driver responses and pick one. | M | Each card shows driver, rating, trips, vehicle, fare, ETA, countdown; expired not selectable (BR-044); selection locks fare (BR-046). |
| US-R-014 | As a rider whose offer expired, I want to raise it, switch to Quick Match or cancel. | M | All three options offered (BR-042); max 3 rounds (BR-049). |
| US-R-015 | As a rider, I want to choose how to pay before booking. | M | *(Revised 2026-10-21, D-023.)* GoBye Wallet and Bank transfer shown (no cards; cash hidden while disabled); any processing fee shown separately from the fare (BR-105); wallet bookings blocked when the balance can't cover the total (BR-106); simulated label. |
| US-R-016 | As a rider, I want to track my driver's arrival. | M | Driver marker, ETA (simulated label), driver & vehicle details (plate prominent). |
| US-R-017 | As a rider, I want to know any cancellation fee before I confirm cancelling. | M | Free vs fee shown in confirmation dialog (BR-080/081); no fee charged without confirmation. |
| US-R-018 | As a rider, I want to follow my trip in progress. | M | Phase shown; cancel not offered after trip start; safety entry visible. |
| US-R-019 | As a rider, if my payment fails I want to retry or pay another way. | M | *(Revised 2026-10-21: cards/cash not launch methods.)* Wallet failure: "Try again" / "Use another method". Booking stays `payment_pending` until resolved (BR-103). |
| US-R-020 | As a rider, I want a receipt after the trip. | M | Fare, processing fee (separate line) and total paid, breakdown, payment method & status, times, distance; "Simulated" if mock (BR-105). |
| US-R-021 | As a rider, I want to rate my driver. | M | 1–5 stars; < 3 asks for reason; comment ≤ 300 chars; Skip allowed (BR-111). |
| US-R-022 | As a rider, I want my active trip restored if the app is killed. | M | On relaunch, gate routes to the active booking screen with correct state and timers derived from timestamps. |
| US-R-023 | As a rider, I want to see past rides. | M | Activity list with loading/empty/list states; ride detail opens receipt. |
| US-R-024 | As a rider, I want to save Home/Work. | S | Add via search; remove with confirmation. |
| US-R-025 | As a rider, I want to manage payment methods and see wallet history. | S | Default method selectable; transactions list; top-up by bank transfer simulated (add-card removed 2026-10-21, D-023). |
| US-R-026 | As a rider, I want to report a fare or safety issue. | S | Report from receipt/ride detail within 7 days (BR-110); submission confirmation. |
| US-R-027 | As a rider, I want to share my referral code. | C | System share sheet with code. |
| US-R-028 | As a rider, I want safety information and a trusted contact. | S | UI states no emergency service is contacted (BR-120); contact stored locally. |
| US-R-029 | As a rider, I want to delete my account in the app. | M | R28 explains deleted/retained data and outstanding balances; explicit confirmation; requested state. |
| US-R-030 | As a rider, I want to control notifications and open system permission settings. | S | Toggles; link to OS settings. |
| US-R-031 | As a rider paying by bank transfer, I want clear account details and to know when my transfer is received. | M | At trip end: bank, account number, account name and exact amount; "I've sent the transfer" → checking → paid, or "Transfer not received yet" with "Check again" / "Use another method"; "Pay with GoBye Wallet instead" available while awaiting; state survives app restart; production confirmation by provider only (BR-107, BR-108). |

### 6.2 Driver

| ID | Story | Pri | Acceptance criteria |
|---|---|---|---|
| US-D-001 | As a driver, I want to sign in with my phone number. | M | Same OTP behaviour as US-R-002. |
| US-D-002 | As a new driver, I want to register personal details. | M | Required fields validated; progress saved per step. |
| US-D-003 | As a new driver, I want to submit licence and identity documents. | M | Camera or system picker; upload progress; retake; numbers masked after submit; no local copy kept (SECURITY §7). |
| US-D-004 | As a new driver, I want to add my vehicle and documents. | M | Make, model, colour, plate, year, category; documents uploaded. |
| US-D-005 | As an applicant, I want to see my verification status. | M | pending / approved / rejected with reason and resubmit path. |
| US-D-006 | As an approved driver, I want to go online and offline. | M | Toggle on D09; blocked with explanation if not approved, location permission missing, **precise location off**, or **no active access package** (BR-072, BR-073); cannot go offline mid-trip ("Finish the trip first"). |
| US-D-007 | As a driver going online for the first time, I want to know why location is needed while I'm online. | M | *(Revised 2026-10-21, D-026.)* D10 explains use, "only while online", stops when offline; then the When In Use system request (precise); **no Always request**; decline path explained. |
| US-D-008 | As a driver, I want to see a Quick Match request with pickup, destination, fare and my estimated earnings. | M | Earnings = full fare (0% commission, D-024), labelled "Estimated" (BR-060/061); accept/decline; countdown. |
| US-D-009 | As a driver, I want to respond to a passenger's offer with accept or counter. | M | Counter ≥ offer and ≤ range max (BR-043); one live response (BR-045); 30 s validity (BR-044). |
| US-D-010 | As a driver, I want to know if the passenger chose someone else or the offer expired. | M | Request dismissed with message; driver returns to online_idle. |
| US-D-011 | As a driver, I want guided trip steps. | M | To pickup → Arrived → Confirm passenger (name) → Start → Complete; Start disabled before Arrived (BR-090). |
| US-D-012 | As a driver, I want to see payment status and earnings at trip end. | M | Wallet / bank-transfer status (incl. "awaiting transfer"); earnings "Estimated" until settled. |
| US-D-013 | As a driver, I want earnings, wallet and payout history. | S | Daily/weekly totals; payouts list (simulated). |
| US-D-014 | As a driver, I want trip history and my rating. | S | List + detail; rating average. |
| US-D-015 | As a driver, I want to manage documents and be told before they expire. | S | Expiry dates shown; expired docs make driver ineligible (BR-071). |
| US-D-016 | As a driver, I want to delete my account. | M | Same principles as US-R-029, incl. pending payouts. |
| US-D-017 | As a driver, I want to cancel an accepted trip with a reason. | S | Reason collected (BR-083); warning that it affects reliability (BR-082). |
| US-D-018 | As a driver, I want to buy a daily or monthly access package so I can go online. | M | Packages listed with price (labelled provisional while so), duration and expiry; purchase extends from current expiry if active; status visible on D09; reminder before expiry (timing Q-043). How drivers pay is open (Q-043). |
| US-D-019 | As an online driver, I want to know when I can't receive requests because of a location problem. | M | Reason shown (permission off, precise off, updates interrupted, stale position, weak GPS) with a fix action; new requests paused; active trip continues (D-026, BR-073). |

### 6.3 Admin (future — backend/ops; listed so app contracts anticipate them)

| ID | Story | Pri | Acceptance criteria |
|---|---|---|---|
| US-A-001 | As an ops admin, I want to review and approve/reject driver documents. | F | Decision + reason propagates to D08 and push notification. |
| US-A-002 | As an ops admin, I want to edit pricing configuration per city/category. | F | New quotes use new config; existing locked fares unaffected (BR-031). |
| US-A-003 | As an ops admin, I want to resolve fare disputes and issue refunds. | F | Refund appears in rider wallet/receipt status `refunded`. |
| US-A-004 | As an ops admin, I want to suspend a driver. | F | Driver forced offline; D08 shows status; excluded from matching. |
| US-A-005 | As an ops admin, I want to enable/disable categories per area. | F | R09 shows category disabled with reason. |
| US-A-006 | As an ops admin, I want to view audit logs of sensitive actions. | F | Document access, refunds, pricing changes logged (BACKEND_HANDOVER §11). |

## 7. Alternative flows and error states

| ID | Situation | Expected behaviour | Rule/Story |
|---|---|---|---|
| ALT-01 | Location denied/restricted | Manual pickup entry on Home/search; banner with "Open Settings" | US-R-005 |
| ALT-02 | Approximate location | Pin confirmation; temporary precise request (if supported) | US-R-006 |
| ALT-03 | Offline (no network) | Offline banner; actions requiring network disabled with reason; active trip shows last-known state | NFR-REL |
| ALT-04 | Quote expired | "Prices updated" + refresh before booking | BR-022 |
| ALT-05 | Category unavailable | Disabled card with reason | BR-010 |
| ALT-06 | No drivers (Quick Match timeout 60 s) | Retry, try Negotiate, or cancel | BR-032 |
| ALT-07 | Offer expired with no selection | Raise, switch to Quick Match, cancel | BR-042 |
| ALT-08 | Max offer rounds reached | Raise disabled with message; Quick Match or cancel | BR-049 |
| ALT-09 | Selected driver unavailable | "This driver is no longer available"; back to remaining live responses | BR-047 |
| ALT-10 | Response expired before selection | Card shows expired; not selectable | BR-044 |
| ALT-11 | Duplicate submit tap | Ignored; single booking | BR-033 |
| ALT-12 | Driver cancels after match | Rider notified; rematch or cancel (Q-030) | BR-082 |
| ALT-13 | Cancellation after free window | Fee shown before confirm | BR-081 |
| ALT-14 | Digital payment fails | Retry / use another method (cash not a launch method); `payment_pending` | BR-103 |
| ALT-15 | App killed mid-booking | Restored to correct screen and state | US-R-022 |
| ALT-16 | OTP wrong / too many attempts | Inline error; lockout message with retry time | FR-AUTH |
| ALT-17 | Driver verification rejected | Reason and resubmit path | US-D-005 |
| ALT-18 | Driver denies location / grants approximate only | *(Resolved 2026-10-21, D-026.)* Cannot go online; explanation + "Open Settings". iOS needs no separate background prompt (When In Use + background mode). If background updates are unavailable on a device, the driver is told to keep the app open | US-D-007 |
| ALT-19 | Server error / unknown | Generic error with retry; no stack traces or IDs beyond a short reference | UI_STATES |
| ALT-20 | Bank transfer not received yet | "Transfer not received yet"; Check again / Use another method; `payment_pending` | BR-107 |
| ALT-21 | Wallet balance doesn't cover fare + fee | Booking with Wallet blocked; Top up or pay by bank transfer; in Negotiate, unaffordable responses not selectable | BR-106 |
| ALT-22 | Driver location lost/stale/approximate while online | New requests paused with reason; active trip continues | BR-073, US-D-019 |
| ALT-23 | Driver access package expired | Cannot go online; buy package prompt | BR-072, US-D-018 |

## 8. Dependencies

| ID | Dependency | Needed for | Status |
|---|---|---|---|
| DEP-01 | GoBye backend (REST + WebSocket) | Real pricing, matching, trips | Not started; contracts proposed (`API_CONTRACTS.md`) |
| DEP-02 | SMS/WhatsApp OTP provider | Real sign-in | Open (Q-027) |
| DEP-03 | Maps, geocoding, routing provider | Production maps/ETA | Proposed: Google Maps Platform (D-025); validation + cost pending (Q-007, Q-044) |
| DEP-04 | Payment provider (e.g. Paystack, Flutterwave) | Wallet, bank-transfer virtual accounts, driver packages, payouts | Methods decided (D-023); provider open (Q-042) |
| DEP-05 | Push notification service | Request/trip alerts | Open (Q-014) |
| DEP-06 | KYC / document verification process or vendor | Driver approval | Open (BACKEND_HANDOVER §7) |
| DEP-07 | Brand assets (logo, app icon, splash) | Release | Working concepts announced 2026-10-21, not yet received; finals pending (Q-008, D-016) |
| DEP-08 | Legal: privacy policy, terms, NDPA, transport licences | Release | Open (Q-009, Q-017) |
| DEP-09 | Apple Developer / Google Play accounts, bundle IDs | Distribution | Open (Q-025) |
| DEP-10 | Development build (EAS) for Driver background location | Driver testing | Planned (ARCHITECTURE §10) |

## 9. Out of scope (current phase)

- Real backend, real payments, real OTP, real driver verification, real push notifications.
- Admin/ops console UI.
- In-app rider–driver chat and masked calling (UI placeholders only; Q-028).
- Emergency service integration (BR-120).
- Scheduled rides, multi-stop rides, ride sharing/pooling, delivery/courier.
- Tipping, promotions engine (referral UI only), loyalty tiers.
- Apple In-App Purchase for ride fares, wallet top-ups or driver packages (BR-101).
- Card payments (D-023). Cash at launch (open, Q-001).
- Tablet, landscape and web layouts.
- Languages other than English (Q-040).
- App Store / Play Store public submission of mock builds.

## 10. Success metrics (all targets are PROPOSALS — confirm with Product)

| Metric | Definition | Proposed target |
|---|---|---|
| Booking funnel conversion | Quotes viewed → booking submitted | ≥ 35% |
| Quick Match time-to-match | Submit → `matched`, median | ≤ 45 s |
| Quick Match no-driver rate | Searches ending `no_drivers` | ≤ 10% |
| Negotiate match rate | Negotiation bookings reaching `matched` | ≥ 60% |
| Negotiate rounds | Mean rounds per matched negotiation | ≤ 1.8 |
| Rider cancellation rate | Cancelled after match / matched | ≤ 8% |
| Payment failure rate | Digital charges failing first attempt | ≤ 3% |
| Driver acceptance rate | Requests accepted or countered / received | ≥ 70% |
| Trip completion rate | Completed / matched | ≥ 90% |
| Average rating | Rider→driver stars | ≥ 4.6 |
| Crash-free sessions | Per app, release builds | ≥ 99.5% |
| Accessibility defects | Open P1 a11y issues at release | 0 |
| Driver verification turnaround | Submit → decision, median | ≤ 48 h |
