# GoBye — Open Questions

**Status:** 2026-10-21. Unresolved business, legal and technical decisions. Each has an owner and the phase it blocks (phases from the master brief: 3 Rider app, 4 Driver app, 5 Maps, 6 Payment & pricing, 8 Testing, 9 App Store/release; **BE** = backend integration; **Launch** = public launch). "Current assumption" is what the mock build does until answered — it is **not** a decision.

When a question is answered: record the answer and date here, add/supersede a decision in `DECISIONS.md`, and update `BUSINESS_RULES.md` / mock config in the same change.

## Summary

| ID | Topic | Owner | Blocks |
|---|---|---|---|
| Q-001 | Launch payment methods — **partly answered 2026-10-21 → D-023** (Wallet + bank transfer); **cash still open** | Product / Finance | 6, BE, Launch |
| Q-002 | ~~Commission rate~~ **Resolved 2026-10-21 → D-024** (0% per trip; driver access packages, prices provisional) | Finance | 6, BE |
| Q-003 | Launch city/cities | Product | 5, BE, Launch |
| Q-004 | Keke availability & cities | Product / Legal | 3, Launch |
| Q-005 | Route-change fare rule | Product | BE |
| Q-006 | Surge / demand pricing policy | Product / Finance | 6, BE |
| Q-007 | Map, geocoding & routing provider — **Proposed 2026-10-21 → D-025** (Google Maps Platform); open until Abuja/Lagos validation + cost projection | Eng / Finance | 5, BE |
| Q-008 | Brand assets — **partly answered 2026-10-21**: working-concept pack received and integrated as PREVIEW; vector logo, final palette and font pending | Product / Design | 9 |
| Q-009 | Legal entity & regulatory licences | Legal | 9, Launch |
| Q-010 | Trip start PIN | Product | 4, BE |
| Q-011 | Social login | Product | 3, 9 |
| Q-012 | ~~Driver iOS "Always" vs When In Use + background mode~~ **Resolved 2026-10-21 → D-026** | Product / Eng | 4 |
| Q-013 | Android predictive back | Eng | 3, 8 |
| Q-014 | Push notification provider | Eng | BE |
| Q-015 | Support channel | Product / Ops | 3, 9 |
| Q-016 | Data retention periods & deletion with balances | Legal | 9, BE |
| Q-017 | NDPA 2023 compliance | Legal | 9, Launch |
| Q-018 | Insurance | Legal / Finance | Launch |
| Q-019 | Negotiation range percentages & step | Product | 6, BE |
| Q-020 | Timers and rounds (quote, offer, response, search) | Product | 3, BE |
| Q-021 | Cancellation fees & windows | Product / Finance | 6, BE |
| Q-022 | Category rates & minimum fares | Product / Finance | 6, BE |
| Q-023 | Rating thresholds | Product / Ops | BE |
| Q-024 | Demo accounts for App Review | Product / Eng | 9 |
| Q-025 | Bundle identifiers | Product | 9 |
| Q-026 | Expo SDK 58 upgrade timing | Eng | 8, 9 |
| Q-027 | Sign-in method confirmation & OTP channel/provider | Product / Eng | 3, BE |
| Q-028 | In-app chat & masked calling | Product / Legal | BE |
| Q-029 | Selecting responses after offer expiry | Product | 3, BE |
| Q-030 | Rematch after driver cancellation | Product | 3, BE |
| Q-031 | Driver payout schedule & minimums | Finance | 4, BE |
| Q-032 | Wallet regulatory status | Legal / Finance | 6, Launch |
| Q-033 | ~~Cancellation during `in_progress` wording~~ **Resolved 2026-10-21 → D-019** | Product | 3 |
| Q-034 | Cash trips: commission collection & unpaid balances | Finance / Product | 6, BE |
| Q-035 | Dispute window | Product / Legal | BE |
| Q-036 | Admin console scope & ownership | Product / Eng | BE |
| Q-037 | Crash reporting & analytics SDK | Eng / Legal | 8, 9 |
| Q-038 | Search radius & dispatch strategy | Product / Eng | BE |
| Q-039 | Real safety features (SOS, share trip) | Product / Legal | Launch |
| Q-040 | Languages | Product | 3, Launch |
| Q-041 | Driver document expiry handling | Ops / Legal | 4, BE |
| Q-042 | Payment provider, bank-transfer virtual accounts & confirmation, real processing fees | Finance / Eng | 6, BE, Launch |
| Q-043 | Driver access package billing (how drivers pay, renewal, grace, refunds, VAT) | Finance / Legal / Product | 4, 6, BE |
| Q-044 | Google Maps Platform cost projection & usage caps | Eng / Finance | 5, BE, Launch |
| Q-045 | Driver location update-profile tuning from device tests | Eng | 4, 8 |
| Q-046 | Name styling and tagline: "Go-Bye" vs "GoBye"; "Your next move." vs "Your ride. Your say." | Product / Brand | 3, 9 |
| Q-047 | Final palette: Jade-led vs Aubergine/Tangerine-led | Product / Brand | 2, 9 |
| Q-048 | Typography: Plus Jakarta Sans (pack proposal) vs Inter (brief) | Product / Brand | 2, 9 |
| Q-049 | Navigation per UI concept: 4 tabs (Home, Trips, Wallet, Account), "For me" rider selector, "Rewards & events" entry | Product / Design | 3 |

---

## Details

### Q-001 — Launch payment methods
- **Question:** Which methods launch — cash only, digital only, or both (card, wallet, bank transfer, USSD)? Which provider (e.g. Paystack, Flutterwave)?
- **Why it matters:** Drives payment UI, failure flows (BR-103), settlement, PCI scope, App privacy details.
- **Owner:** Product / Finance · **Blocks:** 6, BE, Launch
- **Partial answer (2026-10-21, product owner):** "Our current scope includes GoBye wallet and bank transfer. Cash hasn't been agreed. Proposed launch scope is digital payments first; treat cash as an open decision." → Launch methods: **GoBye Wallet + bank transfer** (D-023). **Cards are not in scope.**
- **Still open (this question stays open for this only):** Is **cash** offered at launch or later, and if so with what settlement/unpaid-balance rules (see Q-034)? Provider choice moved to Q-042.
- **Current assumption:** Wallet + bank transfer enabled, simulated; `cash` exists in the type but is disabled in `MOCK_PAYMENTS_CONFIG.enabledMethods` (BR-100, BR-104).
- **Previous assumption (superseded):** UI showed Cash, Card, Wallet.

### Q-002 — Commission rate (RESOLVED 2026-10-21 → D-024)
- **Question:** Platform commission (flat %, per category, tiered, or subscription)?
- **Why:** Driver earnings preview and settlement (BR-060).
- **Owner:** Finance · **Blocks:** 6, BE
- **Answer (2026-10-21, product owner):** "0% per trip. Drivers pay for access through configurable packages. ₦2,000 daily and ₦60,000 monthly remain provisional. Any payment-processing charges must be disclosed separately."
- **Result:** `commissionRate = 0`; drivers keep the full fare; daily/monthly access packages (prices **provisional**); processing fees shown as a separate line (BR-060, BR-061, BR-072, BR-105). Package billing details → Q-043.
- **Previous assumption (superseded):** 15% mock, labelled "Estimated".

### Q-003 — Launch city/cities
- **Question:** Lagos only at launch? Which areas (mainland/island)? Next cities (Abuja, Port Harcourt…)?
- **Why:** Service area, pricing config per city, map bounds, App Store metadata (only list launched cities), regulatory permits per state.
- **Owner:** Product · **Blocks:** 5, BE, Launch
- **Assumption:** Lagos; mock places are Lagos landmarks. **Update 2026-10-21:** mock places also include approximate Abuja landmarks because the owner asked for pickup-accuracy validation in Abuja and Lagos (Q-007); this is not a launch-city decision.

### Q-004 — Keke availability
- **Question:** Is Keke offered, and in which cities/areas? (Some Lagos routes restrict tricycles.)
- **Why:** Category list, persona P-R3, regulation.
- **Owner:** Product / Legal · **Blocks:** 3, Launch
- **Assumption:** Keke shown as a category; may be unavailable by area (BR-010/011).

### Q-005 — Route-change fare rule
- **Question:** When the route changes materially mid-trip (rider-requested detour, extra stop), how is the fare recalculated, and who confirms it?
- **Why:** BR-091; disputes.
- **Owner:** Product · **Blocks:** BE
- **Assumption:** Final fare = locked/agreed fare.

### Q-006 — Surge / demand pricing
- **Question:** Will demand multipliers exist? Caps? Do they apply to Negotiate ranges?
- **Why:** BR-021 disclosure, trust, regulation.
- **Owner:** Product / Finance · **Blocks:** 6, BE
- **Assumption:** Multiplier 1.0; UI supports disclosure if > 1.0.

### Q-007 — Map / geocoding / routing provider
- **Question:** Google Maps Platform, Mapbox, Apple+Google platform defaults, or other? Separate places/geocoding and routing providers?
- **Why:** Cost, Nigerian address quality, SDK constraints (Expo Go vs dev build), API keys, privacy disclosures.
- **Owner:** Eng / Finance · **Blocks:** 5, BE
- **Partial answer (2026-10-21, product owner):** "Not selected yet. Proposed starting provider is Google Maps Platform, with place search and Routes API for distance and journey estimates. Validate pickup accuracy in Abuja/Lagos and projected usage costs before committing."
- **Proposal (D-025, status Proposed):** Google Maps Platform — Maps SDK via `react-native-maps` `PROVIDER_GOOGLE`; Places API (New) for search/autocomplete; Routes API `computeRoutes` for distance/ETA with traffic-aware routing ([Routes API overview](https://developers.google.com/maps/documentation/routes/overview)). D-004 (`MapCanvas` / `MapService` abstraction) remains in force.
- **Still open until:** (1) pickup-accuracy validation in **Abuja and Lagos** on real devices (`DEVICE_TEST_MATRIX.md`), (2) projected usage cost and caps (Q-044). Then accept or replace D-025.
- **Current assumption:** `react-native-maps` with platform default provider; mocked geocoding/routing (D-004). Mock places now cover approximate Abuja and Lagos landmarks.

### Q-008 — Brand assets
- **Question:** Supply the brand board, logo files (SVG), app icons (iOS/Android adaptive), splash artwork and colour specs.
- **Why:** Brand board referenced in the brief was not supplied; placeholders cannot ship (D-016, App Review 2.1).
- **Owner:** Product / Design · **Blocks:** 9
- **Partial answer (2026-10-21, product owner):** the owner is supplying `Go-Bye_Working_Brand_Assets.zip` (brand boards, logo breakdown, applications, separate 3D-style images, animation, UI concepts). These are **working concepts**: final colours, typography and exact vector logo files are **still pending**, and the green direction is an exploration.
- **Received 2026-10-21** and integrated as PREVIEW (D-027): the preferred mark (curved G with destination dot) was extracted as a raster from the logo concept board and used for the in-app wordmark, app icons and splash; the four 3D-style renders (sedan, wallet, gift, destination) are used as illustrations. Pack README: aubergine/tangerine is the earlier working palette, green a later exploration, final palette undecided; proposed font Plus Jakarta Sans (not approved); no artwork is an authoritative vector master.
- **Still open:** vector logo master + export variants (incl. small-size/contrast checks), final palette (see Q-047), typography (Q-048), consistent final asset style, production motion. Settings → "Preview: brand colours" lets reviewers compare both palettes on device.

### Q-009 — Legal entity & regulatory licences
- **Question:** Which company entity publishes the apps and contracts with drivers? Which permits are required (e.g. Lagos State ride-hailing/e-hailing operator permits, driver permits, vehicle requirements)? Accepted driver ID documents?
- **Why:** App Store seller name, terms, privacy policy, driver onboarding fields, launch legality.
- **Owner:** Legal · **Blocks:** 9, Launch
- **Assumption:** None; no regulatory claims made in-app.

### Q-010 — Trip start PIN
- **Question:** Require a rider PIN to start trips, or name confirmation only?
- **Why:** Safety vs friction; affects D13 and API phase payload.
- **Owner:** Product · **Blocks:** 4, BE
- **Assumption:** Driver confirms passenger name (BR-090); `pin` field reserved in API.

### Q-011 — Social login
- **Question:** Add Google/Facebook/Apple sign-in?
- **Why:** If any third-party login is added, App Review 4.8 requires an equivalent privacy-preserving option (e.g. Sign in with Apple).
- **Owner:** Product · **Blocks:** 3, 9
- **Assumption:** Phone + OTP only (D-008).

### Q-012 — Driver background location on iOS (RESOLVED 2026-10-21 → D-026)
- **Question:** Request "Always", or use When In Use + `UIBackgroundModes: location` with updates started in the foreground?
- **Why:** Apple documentation indicates When In Use + background mode suffices for continuous tracking while online; Always mainly adds relaunch after termination. Fewer/lighter prompts improve opt-in and review. Also decide behaviour when the driver declines background (go online foreground-only vs blocked).
- **Owner:** Product / Eng · **Blocks:** 4
- **Answer (2026-10-21, product owner):** start a location session when the driver explicitly goes online; continue background updates while available for requests, approaching pickup, or carrying a passenger; stop operational tracking when offline with no active trip; request **When In Use** first — background tracking continues with this permission when properly configured and started in the foreground; **do not request Always automatically** ([Apple: `allowsBackgroundLocationUpdates`](https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates)); request precise location for dispatch/navigation, adapt update frequency to activity, flag stale positions; if permission or updates are lost, pause new matching and notify the driver; test locked-screen, background and interrupted-session behaviour on real devices.
- **Result:** D-026 (revises D-012's driver bullet). Logic in `packages/core/src/driver/locationSession.ts` (unit-tested; Driver app UI not yet built). Update-interval tuning → Q-045. Device tests → `DEVICE_TEST_MATRIX.md` (Untested).
- **Previous assumption (superseded):** D-012 as written; flagged for amendment (APP_STORE_COMPLIANCE §3).

### Q-013 — Android predictive back
- **Question:** Keep `predictiveBackGestureEnabled: false` (current template setting in both `app.json`) or enable it and test back interception on R11/R12/R13/D13?
- **Why:** Android 16 with targetSdk 36 enables predictive back by default unless opted out; interception behaviour differs.
- **Owner:** Eng · **Blocks:** 3, 8
- **Assumption:** Disabled (ANDROID_GUIDELINES AND-01).

### Q-014 — Push notification provider
- **Question:** Expo Push Service, direct FCM/APNs, or third-party (OneSignal etc.)?
- **Why:** Driver requests must reach backgrounded apps; affects backend, privacy disclosures, dev build config.
- **Owner:** Eng · **Blocks:** BE
- **Assumption:** In-app mock notifications only.

### Q-015 — Support channel
- **Question:** In-app tickets, WhatsApp, phone line, email? Hours? SLA? Public support URL?
- **Why:** R26/D17 design, App Store support URL, App Review 1.2 contact requirement if chat is added.
- **Owner:** Product / Ops · **Blocks:** 3, 9
- **Assumption:** In-app ticket form (simulated).

### Q-016 — Data retention periods
- **Question:** Retention per data class (raw location pings, trip records, payment records, verification documents, support/safety reports, logs); how account deletion handles wallet balances, unpaid fares and pending payouts.
- **Why:** Privacy policy (App Review 5.1.1(i)), deletion flow copy (R28), backend pipeline.
- **Owner:** Legal · **Blocks:** 9, BE
- **Assumption:** None decided (SECURITY_PRIVACY §6); deletion flow shows placeholders.

### Q-017 — NDPA 2023 compliance
- **Question:** Obligations under the Nigeria Data Protection Act 2023: lawful bases, data-subject rights, registration, DPO, breach notification, cross-border transfer for non-Nigerian hosting/SDKs.
- **Why:** Launch legality; architecture (hosting region, vendors).
- **Owner:** Legal · **Blocks:** 9, Launch
- **Assumption:** No obligations asserted; legal review pending.

### Q-018 — Insurance
- **Question:** Passenger/driver accident cover, vehicle insurance requirements, who provides it?
- **Why:** Onboarding fields (insurance documents), safety screen copy, regulatory permits.
- **Owner:** Legal / Finance · **Blocks:** Launch
- **Assumption:** Not shown in-app.

### Q-019 — Negotiation range & step
- **Question:** Confirm range percentages (mock 75%–150% of suggested), minimum-fare floor, step (mock ₦50); per category?
- **Why:** BR-040/041; fairness to drivers; abuse resistance.
- **Owner:** Product · **Blocks:** 6, BE
- **Assumption:** Mock values.

### Q-020 — Timers and rounds
- **Question:** Confirm quote TTL (5 min), offer TTL (90 s), response TTL (30 s), max rounds (3), Quick Match search timeout (60 s). Does a raise after expiry count as a round? Does raising restart the timer (BR-048 says yes)?
- **Why:** Core negotiation UX and backend enforcement.
- **Owner:** Product · **Blocks:** 3, BE
- **Assumption:** Mock values; each raise = new round with fresh 90 s.

### Q-021 — Cancellation fees & windows
- **Question:** Confirm free window (2 min after match), wait threshold (5 min), fee amount (₦500), per category? Driver no-show/late compensation for riders? Driver cancellation penalties?
- **Why:** BR-080–082; disclosure before confirm; cash-trip fee collection.
- **Owner:** Product / Finance · **Blocks:** 6, BE
- **Assumption:** Mock values; fee shown before confirm.

### Q-022 — Category rates & minimum fares
- **Question:** Base, per-km, per-minute and minimum fare per category and city.
- **Why:** BR-020; quotes.
- **Owner:** Product / Finance · **Blocks:** 6, BE
- **Assumption:** Mock table in BUSINESS_RULES §2.

### Q-023 — Rating thresholds
- **Question:** Minimum driver rating for eligibility (mock 4.0), deactivation policy, minimum trips before rating counts, rider rating consequences.
- **Why:** BR-070; driver fairness.
- **Owner:** Product / Ops · **Blocks:** BE
- **Assumption:** 4.0 mock.

### Q-024 — Demo accounts for App Review
- **Question:** Provision Rider and approved Driver demo accounts, reviewer OTP numbers/codes, and a reviewer test-trip path (sandbox city or simulated driver approved by Apple).
- **Why:** App Review 2.1(a); login-gated apps are rejected without demo access.
- **Owner:** Product / Eng · **Blocks:** 9
- **Assumption:** None provisioned.

### Q-025 — Bundle identifiers
- **Question:** Confirm `app.gobye.rider` and `app.gobye.driver` (iOS bundle IDs and Android package names), and ownership of the `gobye.app` domain for associated domains.
- **Why:** Cannot be changed after store publication.
- **Owner:** Product · **Blocks:** 9
- **Assumption:** Proposed IDs in `app.json`.

### Q-026 — Expo SDK 58 upgrade timing
- **Question:** When to upgrade from SDK 57 (D-001) — once Expo Go 58 ships, or before first TestFlight build?
- **Why:** Avoid upgrading mid-release; device test matrix reruns.
- **Owner:** Eng · **Blocks:** 8, 9
- **Assumption:** Upgrade after Expo Go 58 is in the stores, before release testing.

### Q-027 — Sign-in method & OTP channel
- **Question:** Confirm phone + OTP as the only method (D-008, Proposed). SMS, WhatsApp, or both? Which provider (e.g. Termii, Twilio)? Cost per OTP and fallback.
- **Why:** Deliverability in Nigeria; cost; security limits.
- **Owner:** Product / Eng · **Blocks:** 3, BE
- **Assumption:** Mock OTP, SMS wording in UI.

### Q-028 — In-app chat & masked calling
- **Question:** Rider–driver chat? Masked phone calls to avoid exposing numbers?
- **Why:** Privacy; App Review 1.2 (report/block/filter) if chat is added.
- **Owner:** Product / Legal · **Blocks:** BE
- **Assumption:** Call/message buttons simulated.

### Q-029 — Responses after offer expiry
- **Question:** Can a rider select a driver response that is still live after the passenger offer itself expired?
- **Why:** Edge case in R11 and server validation.
- **Owner:** Product · **Blocks:** 3, BE
- **Assumption:** Yes, until the response's own `expiresAt`.

### Q-030 — Rematch after driver cancellation
- **Question:** When a driver cancels after match, automatically search again (Quick Match) or return to options? For Negotiate, reopen the offer?
- **Why:** UI_STATES B27/B28.
- **Owner:** Product · **Blocks:** 3, BE
- **Assumption:** Automatic rematch at the same locked fare; no fee to rider.

### Q-031 — Driver payouts
- **Question:** Schedule (daily/weekly/on-demand), minimum amount, fees, supported banks, instant payout?
- **Why:** D15 UI and backend settlement.
- **Owner:** Finance · **Blocks:** 4, BE
- **Assumption:** Simulated payout history and "Request payout".

### Q-032 — Wallet regulatory status
- **Question:** Does a stored-value GoBye Wallet require CBN licensing or a licensed partner? Are balances refundable? Expiry?
- **Why:** Wallet may need to be removed or partnered at launch.
- **Owner:** Legal / Finance · **Blocks:** 6, Launch
- **Assumption:** Simulated wallet UI.

### Q-033 — Cancellation wording during `in_progress` (RESOLVED → D-019: no in-app cancel once in progress; BUSINESS_RULES §9 updated)
- **Question:** `BUSINESS_RULES.md` §9 says `cancelled` is reachable "before `in_progress` completes"; `UI_STATES.md` restricts rider cancellation to before `in_progress`. How is a mid-trip termination (safety, breakdown) handled?
- **Why:** Reducer guard and documentation consistency.
- **Owner:** Product · **Blocks:** 3
- **Assumption:** No rider/driver cancel from `in_progress`; mid-trip termination via support/backend (future).

### Q-034 — Cash trips and unpaid balances
- **Question:** How is commission collected on cash trips? Does an unresolved `payment_pending` or unpaid cancellation fee block the rider's next booking?
- **Why:** Settlement, rider UX, fraud.
- **Owner:** Finance / Product · **Blocks:** 6, BE
- **Assumption:** Commission netted from driver digital earnings; outstanding balance shown and blocks next booking.
- **Update 2026-10-21:** commission is 0% (D-024), so the commission-collection part no longer applies. Cash itself is not enabled at launch (D-023); this question now applies only if cash is approved (Q-001). The unpaid-balance part still applies to bank transfers left unconfirmed (BR-107).

### Q-035 — Dispute window
- **Question:** Confirm 7-day reporting window (BR-110) for fare vs safety issues (safety may need longer).
- **Owner:** Product / Legal · **Blocks:** BE
- **Assumption:** 7 days for all.

### Q-036 — Admin console
- **Question:** Who builds the ops/admin console (verification, disputes, pricing, refunds), and when?
- **Why:** US-A stories; driver approval is impossible without it.
- **Owner:** Product / Eng · **Blocks:** BE
- **Assumption:** Out of scope for this project.

### Q-037 — Crash reporting & analytics
- **Question:** Which SDK (e.g. Sentry, Firebase Crashlytics, PostHog), PII scrubbing, hosting region?
- **Why:** Privacy manifest, App privacy details, NDPA transfer rules, logging rules (SECURITY §8).
- **Owner:** Eng / Legal · **Blocks:** 8, 9
- **Assumption:** None installed.

### Q-038 — Search radius & dispatch strategy
- **Question:** Pickup search radius (mock 5 km), broadcast vs sequential dispatch for Quick Match, how many drivers receive a negotiation offer.
- **Owner:** Product / Eng · **Blocks:** BE
- **Assumption:** 5 km mock; simulated broadcast.

### Q-039 — Real safety features
- **Question:** SOS/emergency contact integration, live trip sharing links, safety team availability.
- **Why:** BR-120 currently UI-only; Apple 5.1.5 restricts location-based emergency services claims.
- **Owner:** Product / Legal · **Blocks:** Launch
- **Assumption:** UI only, clearly states no emergency service is contacted.

### Q-040 — Languages
- **Question:** English only at launch, or Nigerian Pidgin, Yoruba, Hausa, Igbo?
- **Why:** String externalisation (NFR-I18N-005), store metadata.
- **Owner:** Product · **Blocks:** 3, Launch
- **Assumption:** English only; strings centralised.

### Q-041 — Driver document expiry handling
- **Question:** On licence/vehicle document expiry, force offline immediately or allow a grace period? Re-review or document-only renewal?
- **Why:** BR-071; verification state machine (`UI_STATES.md` §6).
- **Owner:** Ops / Legal · **Blocks:** 4, BE
- **Assumption:** Forced offline; status returns to `in_progress` until renewed and re-reviewed.

### Q-042 — Payment provider, bank-transfer mechanism & real processing fees
- **Question:** Which provider (e.g. Paystack, Flutterwave, Monnify or a bank) powers wallet top-ups and bank transfers? How are virtual accounts issued (per booking, per passenger, dynamic vs static), how long do they stay valid, and how is a transfer confirmed (webhook, polling, reconciliation)? What are the real processing charges per method, who bears them, and are there caps?
- **Why:** BR-105/BR-107; replaces the **₦50 bank-transfer fee placeholder** in `MOCK_PAYMENTS_CONFIG`; settlement, refunds for over/under-payment, privacy disclosures.
- **Owner:** Finance / Eng · **Blocks:** 6, BE, Launch
- **Assumption:** Simulated virtual account ("GoBye Demo Bank", derived 10-digit number); ₦50 passenger-borne placeholder fee; wallet fee ₦0 platform-borne.

### Q-043 — Driver access package billing
- **Question:** How do drivers pay for packages (driver wallet, bank transfer, deduction from earnings)? Auto-renewal or manual? Grace period at expiry (especially mid-trip)? Refunds or pro-rating? Are ₦2,000 / ₦60,000 VAT-inclusive? Are packages configurable per city/category? Can a driver queue a package (the mock extends from current expiry)?
- **Why:** BR-072; Driver app onboarding/go-online flow; tax; App Store (packages are paid by drivers for a real-world service, not digital content — confirm no IAP is required, see APP_STORE_COMPLIANCE).
- **Owner:** Finance / Legal / Product · **Blocks:** 4, 6, BE
- **Partly resolved 2026-10-23:** prices confirmed: ₦2,000 for 24 hours from successful activation, ₦60,000 for 30 days.
- **To decide (stacking):** the driver app extends a pass bought while one is active from the current expiry (`subscribe`). The admin subscriptions view counts each pass from its own verified activation. Pick one rule and apply it to both.
- **Assumption:** Purchase while active extends from current expiry; no grace period; a trip already in progress at expiry may finish (assumption, not decided).

### Q-044 — Google Maps Platform cost projection & usage caps
- **Question:** Projected monthly Maps SDK loads, Places (New) autocomplete/details sessions and Routes `computeRoutes` calls per trip at launch volumes; which SKUs/field masks; budget alerts and per-key quotas; caching rules allowed by the terms.
- **Why:** D-025 cannot be accepted without it (owner condition).
- **Owner:** Eng / Finance · **Blocks:** 5, BE, Launch
- **Assumption:** None; no paid account configured.

### Q-045 — Driver location update-profile tuning
- **Question:** Final interval/distance/stale thresholds per activity and maximum accepted accuracy for dispatch, based on real-device battery and freshness measurements (iOS and Android, locked screen and background).
- **Why:** D-026; `UPDATE_PROFILES` and `MAX_DISPATCH_ACCURACY_M` are placeholders (available 15 s/50 m/stale 60 s; to_pickup 5 s/15 m/stale 20 s; on_trip 5 s/20 m/stale 20 s; 100 m).
- **Owner:** Eng · **Blocks:** 4, 8
- **Assumption:** Placeholder values.

### Q-046 — Name styling and tagline
- **Question:** The brand pack consistently writes **"Go-Bye"** with the tagline **"Your next move."**; the master brief uses **"GoBye"** and **"Your ride. Your say."** Which is correct for the app name, store listing, wordmark and copy?
- **Why:** Store names, bundle display names, all UI copy and the wordmark depend on it.
- **Owner:** Product / Brand · **Blocks:** 3, 9
- **Assumption:** App copy keeps "GoBye" / "Your ride. Your say." for now. The display name is one constant (`BRAND_NAME` in `packages/ui/src/brand.tsx`); app.json `name` is separate.

### Q-047 — Final palette
- **Question:** Jade-led (brief, green exploration) or Aubergine/Tangerine-led (earlier working palette, rider UI concept)? Exact hex values for each token.
- **Why:** Board colours sampled 2026-10-21 differ from the brief hexes (e.g. aubergine ≈ #3D163E vs #251632; tangerine ≈ #FD751C vs #FF8A3D; jade ≈ #007252 vs #0B7A5B; mint ≈ #88FBB6 vs #E7F5ED). Generated artwork varies, so samples are not authoritative.
- **Owner:** Product / Brand · **Blocks:** 2, 9
- **Assumption:** Brief hexes; Jade direction by default; both directions selectable in Settings (preview only).

### Q-048 — Typography
- **Question:** Adopt Plus Jakarta Sans (pack proposal, not approved) or keep Inter (brief)?
- **Why:** Font loading, metrics and Dynamic Type testing; licence (both OFL).
- **Owner:** Product / Brand · **Blocks:** 2, 9
- **Assumption:** Inter until approved.

### Q-049 — Navigation from the UI concept
- **Question:** The rider UI concept shows four tabs (Home, Trips, Wallet, Account), a "For me" selector (booking for someone else), a "Rewards & events" entry on Home and a notification bell. Adopt these? Booking for others needs its own rules (contact details, pickup verification).
- **Why:** Current build has three tabs (Home, Activity, Account) with Wallet and Rewards under Account.
- **Owner:** Product / Design · **Blocks:** 3
- **Assumption:** Current three-tab structure until confirmed.
- **Resolved 2026-10-21:** four tabs Home · Activities · Wallet · Account and a "For me / Someone else" selector (testing brief §13, D-032).

### Q-050 — Onboarding photography / footage
- **Question:** Can you supply licensed photography or short video for onboarding? Shot list: (1) a GoBye car moving through Lagos/Abuja traffic, (2) a driver pulling up at a pickup point, (3) a passenger checking the plate and getting in, (4) city movement at dusk. Portrait, at least 1290×2000 px (video: 6–10 s loops, no audio), with model releases.
- **Why:** The current scenes are 512 px crops from concept boards (D-033) and look soft on large phones.
- **Owner:** Brand / Product · **Blocks:** release polish
- **Assumption:** Interim crops stay until supplied.

### Q-051 — Profile photo storage and moderation
- **Question:** Where are passenger photos stored (upload API, size limits), and are they reviewed before drivers see them?
- **Why:** The build stores the chosen photo on the device only and shows it on Home, Account and the pickup pin before pickup.
- **Owner:** Backend / Trust & Safety · **Blocks:** backend phase
- **Assumption:** Device-only until an upload endpoint exists.

### Q-052 — Driver photo and payout account source
- **Question:** Which verified driver photo and bank account are shown to passengers, and how is the payout account verified (name match with BVN/NIN)?
- **Why:** Passengers pay drivers directly by transfer; a wrong account means lost money.
- **Owner:** Payments / Driver ops · **Blocks:** bank transfer at launch
- **Assumption:** Mock drivers have simulated accounts marked as not real.

### Q-053 — Unpaid trips
- **Question:** If a passenger leaves without paying, how long can a payment stay outstanding, do we remind them, and is the account restricted beyond "can't book until paid"?
- **Why:** The build lets the passenger "Pay later" and blocks new bookings until the trip is paid.
- **Owner:** Product / Payments · **Blocks:** launch policy
- **Assumption:** Block new bookings only.

### Q-054 — Dynamic Island / Live Activities
- **Question:** Do we want a Live Activity for trip progress (see `docs/DYNAMIC_ISLAND_SPEC.md`)? It needs a development build, an iOS widget extension and server push updates.
- **Owner:** Product · **Blocks:** nothing at launch
- **Assumption:** Not built; spec only.

### Q-055 — Apply the working palette and typeface?
- **Question:** The 2026-10-21 screen brief names working colours aubergine #351A40 / tangerine #FF751F and Plus Jakarta Sans. The owner asked to apply only layout and structure for now. When should the palette and font change?
- **Owner:** Product / Brand · **Blocks:** visual sign-off
- **Assumption:** Current tokens (Jade default + preview palette switch) and Inter stay until confirmed.


### Q-056 — Can passengers withdraw unused wallet money?
- **Question:** The owner's platform brief treats withdrawals as driver earnings only. Should passengers be able to withdraw (or get refunds of) unused wallet balances, and on what terms?
- **Owner:** Owner / Finance · **Blocks:** wallet policy, terms, finance screens
- **Assumption:** No passenger withdrawals; refunds of wallet funding only through a support case and finance approval.

### Q-057 — Who funds goodwill refunds and wallet corrections?
- **Question:** With 0% commission there is no trip revenue to reverse. Goodwill refunds and corrections are booked to "promotions and goodwill". Confirm, or name another account.
- **Owner:** Finance · **Blocks:** reports
- **Assumption:** Promotions and goodwill expense.

### Q-058 — Approval thresholds and approvers
- **Question:** Confirm the placeholder rules: every refund needs finance; withdrawals of ₦100,000 or more need review; ledger corrections, config publishing, payment activation and owner/finance/developer roles need the owner. With one owner, who approves the owner's own requests?
- **Owner:** Owner · **Blocks:** go live of finance and staff workspaces
- **Assumption:** Placeholders as coded; a second owner or a nominated deputy is needed before launch.

### Q-059 — Bank transfer for trips: collection account or the driver's own account?
- **Question:** The rider app currently shows the driver's payout account (D-030). The platform brief says direct transfers can't be verified and must not count towards withdrawable earnings. Should launch transfers go to a GoBye collection (virtual) account instead?
- **Owner:** Owner / Finance · **Blocks:** trip payment backend, driver earnings
- **Assumption:** The spec routes transfers through a collection account; direct transfers are recorded only.

### Q-060 — Settings stored in naira in the prototype
- **Question:** Configuration versions in the test data (fares, packages, cancellation) hold whole naira, unlike the rest of the platform (kobo). The backend should store kobo; confirm settings are entered in whole naira in the UI.
- **Owner:** Engineering · **Blocks:** backend schema
- **Assumption:** UI entry in whole naira, stored as kobo by the backend.

### Q-061 — Response targets and the safety rota
- **Question:** Care and safety screens show placeholder targets (acknowledge safety alerts within 5 minutes; urgent cases 15 minutes). Who is the safety lead, who is on call, and what are the real targets? Should the app's emergency button also raise an in-app alert to responders (today it only dials 112)?
- **Owner:** Owner / Safety · **Blocks:** safety workspace launch
- **Assumption:** Placeholders as shown; no in-app alert from the app yet.

### Q-062 — Final hero photograph
- **Question:** The website hero uses a still from the owner's reference video (low resolution, generated) with the real passenger home screen composited in. Who produces the final campaign photograph and portrait crop from the brief's prompt?
- **Owner:** Brand / Marketing · **Blocks:** public launch of the website
- **Assumption:** The stand-in is used for previews only.

### Q-063 — Waitlist backend and privacy notice
- **Question:** Which service stores waitlist sign-ups (and confirms them), and where is the privacy notice for collecting emails under the Nigeria Data Protection Act 2023?
- **Owner:** Engineering / Legal · **Blocks:** turning the waitlist on
- **Assumption:** The form stays in demo mode (nothing saved) until both exist.

### Q-064 — Backend and database provider
- **Question:** Which backend runtime/host and database will GoBye use (and in which region)? Needed for gateway origins, file metadata, idempotency records, backups and NDPA data location.
- **Owner:** Owner / Engineering · **Blocks:** staging deployment of the API gateway and upload signer (D-051)
- **Assumption:** None chosen; everything is behind provider-independent interfaces.

### Q-065 — Authentication provider and staff MFA
- **Question:** Which service issues sessions, sends OTPs, and provides staff MFA? It must also mint the short-lived gateway assertions the upload signer trusts.
- **Owner:** Engineering · **Blocks:** real sign-in, file uploads, admin with real data
- **Assumption:** Simulated auth; admin MFA is a simulated step.

### Q-066 — Realtime provider
- **Question:** WebSockets on the backend, a managed pub/sub, or Cloudflare Durable Objects for trip events and locations?
- **Owner:** Engineering · **Blocks:** live trips across devices in production
- **Assumption:** `createRealtimeClient` with a pluggable transport; the demo relay polls.

### Q-067 — Malware scanning for uploads
- **Question:** Which scanner checks driver documents and incident evidence before anyone can read them?
- **Owner:** Engineering / Security · **Blocks:** accepting real documents
- **Assumption:** Fail closed: nothing is readable until a scanner is connected.

### Q-068 — Cloudflare plan, Load Balancing and WAF
- **Question:** Which Cloudflare plan will the `gobye.app` zone use, and when (if ever) to buy Load Balancing, advanced rate limiting or extra certificates?
- **Owner:** Owner · **Blocks:** production edge hardening; failover between origins
- **Assumption:** Load Balancing not activated until a second origin exists.

### Q-069 — `/v1/rides` or `/bookings`
- **Question:** The API contracts name booking endpoints `/bookings…`; the gateway's route map uses `/v1/rides`. Which name does the backend use?
- **Owner:** Engineering · **Blocks:** backend routes
- **Assumption:** Gateway map `/v1/rides` (POST = new booking).

### Q-070 — Staging hostnames and certificates
- **Resolved 2026-10-23:** one-level names only (`api-staging.gobye.app`, `media-staging.gobye.app`, `admin-staging.gobye.app`), because Cloudflare's free Universal SSL covers `*.gobye.app` but not `*.staging.gobye.app`. All definitions updated.

### Q-071 — Retention periods (legal sign-off)
- **Question:** Confirm retention for driver documents (proposed: account life + 6 years), incident evidence (7 years or legal hold), location history and logs under the NDPA.
- **Owner:** Legal · **Blocks:** retention deletes and lifecycle rules in production
- **Assumption:** Proposals only; no destructive lifecycle rules applied.

### Q-072 — Infrastructure approvers
- **Question:** Who may approve production deployments, DNS changes and traffic switches (the second approver), and who is on call for alerts?
- **Owner:** Owner · **Blocks:** production traffic switching and alert routing
- **Assumption:** Owner approves everything until named.

### Q-073 — Wallet funding and withdrawal fee values
- **Question:** Does GoBye charge its own fee on wallet funding and withdrawals, and how much? Who pays the provider's charge (customer or GoBye), added on top or deducted? Limits (minimum, maximum, daily) and exemptions (e.g. first N withdrawals free each month)?
- **Why:** BR-130; fee schedules start with every fee "Not set", which blocks charging. Depends on the provider's real prices (Q-042).
- **Owner:** Owner / Finance · **Blocks:** live wallet funding and withdrawals
- **Assumption:** None. Nothing is charged until a schedule is approved.

### Q-074 — Job runner and scheduler
- **Question:** Which durable queue and scheduler runs the Automation Centre workflows (follows the backend choice, Q-064)? Who is on call for escalations, and should the automation timings (placeholders in the registry) be confirmed as listed?
- **Why:** D-055; nothing in the Automation Centre runs until a runner exists.
- **Owner:** Owner / Engineering · **Blocks:** subscriptions, wallet credits, payouts, reconciliation, expiry jobs
- **Assumption:** Timings in `AUTOMATIONS` are placeholders.
