# GoBye — Development Log

Chronological, append-only. Never record planned work as done.

---

## 2026-10-21 · Session 1 — Phase 0 → Phase 3 (Rider, mock services)

**Phase:** 0A research, 0B MingCute, 0C documentation, 1 architecture, 2 design system, 3 Rider app; Phase 4 shell.

### Work completed
- Inspected the project folder (`C:\Users\yatij\Downloads\GOBYE`): empty — no existing code, docs or brand assets. The brand board mentioned in the brief was not present (Q-008).
- Researched official sources (Apple HIG, App Review Guidelines updated 2026-10-16, Core Location, privacy manifests, upcoming requirements; Expo skills/agents/MCP, SDK 58 changelog, Router, maps, location, monorepos, EAS Submit; Android design, permissions, edge-to-edge, predictive back; MingCute). Register: `docs/RESEARCH_SOURCES.md`.
- Expo skills: official plugin `expo@claude-plugins-official` **not installed** in this cloud session (marketplace not configured; install needs owner permission). The Expo template's `.claude/settings.json` enabling the plugin is committed, so a local Claude Code session will offer to install it (D-013).
- Wrote the full documentation set (4 root files + 23 in `docs/`).
- Scaffolded an npm-workspaces monorepo from `create-expo-app --template default@sdk-57`: `apps/rider`, `apps/driver`, `packages/core`, `packages/ui`.
- Installed and verified `react-native-svg` 15.15.4 and `@mingcute/react-native` 3.0.2 (Apache-2.0); verified 66 icon file names in both Core Regular and Core Filled; built the `<Icon>` registry/wrapper.
- `@gobye/core`: types, kobo money + naira formatting, pricing (suggested fare, breakdown with rounding, negotiation range, quote expiry, earnings preview, cancellation fee), negotiation rules, booking state machine, validators, geo helpers, service interfaces, mock services (Lagos landmarks, simulated drivers/routes/payments).
- `@gobye/ui`: tokens (light/dark, contrast-checked), Text, Button, IconButton, TextField, ListItem, RadioRow, Checkbox, SegmentedControl, SwitchRow, Card, Badge, SimulatedBadge, Skeleton, EmptyState, ErrorState, Wordmark (placeholder), StarRating, Screen/ScreenHeader/Section, MapSheet, Toast.
- Rider app: all screens R01–R28 (see `docs/SCREEN_INVENTORY.md`), providers for services, session (token in SecureStore), account, location (foreground only), booking (state recovery via AsyncStorage).
- Driver app: separate identity (`app.gobye.driver`), placeholder screen, shared packages wired.
- Generated placeholder app icons/splash (PREVIEW, not approved).

### Files created / modified
All files in the repository (first session). Key: `packages/core/src/**`, `packages/ui/src/**`, `apps/rider/src/**`, `apps/*/app.json`, `docs/*.md`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `LOG.md`.

### Technical decisions
D-001 – D-022 in `docs/DECISIONS.md` (SDK 57, monorepo, JS tabs for MingCute, react-native-maps behind an abstraction, pure reducers, kobo, mock pricing config, phone OTP, custom map sheet, single-button location primer, "Keep ride/Cancel ride", no cancel in progress, stack resets, per-weight fonts, Keke placeholder icon).

### Environment notes
- `npx expo install` could not reach `api.expo.dev` through the build environment's proxy; used `EXPO_OFFLINE=1 npx expo install`, which resolves versions from the SDK's bundled module list. Re-run `npx expo install --check` and `npx expo-doctor` on an open network.
- `@gobye/ui` peer dependencies are marked optional to stop npm auto-installing a second `react-native-svg`.

### Bugs discovered / resolved
- BUG-001 (unit test): cancellation fee treated `matchedAt = 0` as unmatched — fixed.
- BUG-002 – BUG-012 (independent code review): navigation stack leaks, MapSheet hiding the Book button, Android back escaping payment, retry with expired quote, TalkBack live-region spam, back-handler churn, duplicate receipt, idempotency key reset — all fixed. Details in `docs/TEST_PLAN.md`.

### Tests executed
- `npm run typecheck` — 4 workspaces, 0 errors.
- `npm test` — core 59 passed; rider 12 passed (UI component accessibility tests, MingCute render test, 4 provider-level integration tests of Quick Match, Negotiate, cancel, and retry-with-requote).
- `npx expo export` — Rider iOS + Android, Driver Android bundles built.
- **Not executed:** any run on a physical device, simulator or emulator; VoiceOver/TalkBack; font scaling; contrast on device. `DEVICE_TEST_MATRIX.md` remains "Untested".

### Pending / open
- Product decisions: Q-001 payments, Q-002 commission, Q-003 launch city, Q-007 map provider, Q-008 brand assets, Q-012 driver iOS location mode, Q-013 predictive back (currently disabled in `app.json`).
- Driver app (Phase 4).
- Upgrade to SDK 58 once Expo Go 58 ships (Q-026).

### Next steps
1. Run the Rider app in Expo Go on an iPhone and an Android phone; record results in `docs/DEVICE_TEST_MATRIX.md`.
2. Start Phase 4 (Driver app) per `docs/IMPLEMENTATION_PLAN.md` "Next tasks".

---

## 2026-10-21 · Session 1 (continued) — Product-owner decisions & brand pack

**Phase:** applying Q-001, Q-002, Q-007, Q-008, Q-012 answers; Phase 2 brand update.

### Decisions received (product owner, 2026-10-21)
- **Q-001:** launch with GoBye Wallet + bank transfer; cash remains open; cards out of scope → D-023.
- **Q-002:** 0% per-trip commission; drivers buy access packages (₦2,000 daily / ₦60,000 monthly, provisional); processing charges disclosed separately → D-024.
- **Q-007:** Google Maps Platform (Places + Routes API) proposed, pending Abuja/Lagos pickup-accuracy validation and cost projection → D-025 (Proposed).
- **Q-008:** working brand pack supplied → D-027.
- **Q-012:** driver location session rules → D-026.

### Work completed
- `@gobye/core`: `payments.ts` (launch methods, separate processing-fee calculation, wallet cover check, driver access packages and subscriptions); `commissionRate = 0`; `driver/locationSession.ts` (session reducer, activity-based update profiles, stale/accuracy/permission issues that pause matching); Abuja landmarks added to mock places; `Booking.awaitingPaymentAction`, `paymentAttempts`; receipts carry `processingFee` and `totalPaid`.
- Rider app: wallet + bank transfer only; fee disclosed as its own line on options, payment picker, payment screen and receipt; wallet balance checked before booking, before locking a negotiated fare and when switching to wallet after a trip; bank-transfer flow with simulated virtual-account details and "I've sent the transfer" → check → paid / not received; card UI removed.
- Brand pack (staged from Downloads with the owner's folder approval): extracted the preferred mark as a raster (normal + light variant), regenerated preview app icons/splash for both apps, added `BrandMark`, `Illustration`, `BRAND_NAME`, and a preview Settings switch between Jade and Aubergine & Tangerine palettes; 3D renders used in onboarding, location primer, rewards, wallet and empty Activity.
- Documentation updated across the set (product, SRS, flows, states, API, backend handover, platform, compliance, security, device matrix, decisions, open questions Q-042–Q-049, asset inventory, design system).

### Bugs found / fixed
- BUG-013: integration tests leaked persisted bookings between tests (state recovery restored the previous ride) — storage cleared per test; recovery now has its own test.
- New integration test caught that a bank transfer would have been charged without the passenger confirming — fixed with `awaitingPaymentAction`.
- Wallet could be chosen after a trip without a balance check — fixed (payment screen and picker).

### Tests executed
- core **74 passed**; rider **17 passed**; typecheck 0 errors; Rider iOS+Android and Driver Android bundles export.
- **Not executed:** any device/emulator run.

### Open (new)
Q-042 payment provider & real fees · Q-043 package billing · Q-044 Maps cost projection · Q-045 location tuning · Q-046 "Go-Bye"/"GoBye" & tagline · Q-047 palette · Q-048 font · Q-049 four-tab navigation from the UI concept.

### Next steps
1. Run the Rider app in Expo Go on a phone; compare both palette directions in Settings.
2. Phase 4 Driver app using `payments.ts` (packages) and `driver/locationSession.ts`; add `expo-location` background config and a development build.

---

## 2026-10-21 · Session 1 (continued) — Testing feedback & UI update brief

**Phase:** 3b — applying the "App Testing Feedback and UI Update Brief" (§1–15) with the 18 reference images. Work done on mock services; **no device or simulator testing was performed.**

### Work completed
- **Foundations:** white light theme with neutral fills/borders/shadows; `layout` tokens and alignment rules; Light/Dark/System appearance saved and applied (D-028); maps follow appearance; new `Sheet`, `Avatar`, `ListGroup`, `StatusBadge`, `ProgressBar`, `KeyValue`, `CopyRow`, `VehicleSummary`, `CategoryCard`.
- **Core:** admin `ServiceConfig` (one enabled "GoBye Car" category, referral programme, pickup PIN) (D-029, D-031); payment after the trip with `PAYMENT_STARTED` duplicate guard, "not received yet" = pending (D-030); wallet ledger service (available / reserved / pending, deposits pending until confirmed, idempotent trip debit); referrals service; ETA/stale-location helpers.
- **Rider screens:** photo onboarding (interim crops, D-033); Home with avatar, passenger selector, editable pickup (search / map / current location); new choose-pickup-on-map screen; options without payment selection and with the config category card; searching; matched/arrival/active trip (driver photo, actual vehicle, ETA progress, PIN, reconnecting state, help sheet, no meter); Confirm payment; Trip complete (rating, receipt PDF, pay later); Wallet tab; Referrals; regrouped Account with profile photo, Appearance and Location access pages; Activities.
- **Navigation:** Home · Activities · Wallet · Account (D-032); old payment-picker and account-wallet routes removed.
- **Docs:** DECISIONS D-028–D-033; OPEN_QUESTIONS Q-049 resolved, Q-050–Q-054 added; DESIGN_SYSTEM §10; SCREEN_INVENTORY; ASSET_INVENTORY; TEST_PLAN; DEPENDENCIES; new `docs/DYNAMIC_ISLAND_SPEC.md` (spec only); CLAUDE.md; README.

### Bugs found / fixed (independent review)
Double wallet debit after a restart mid-payment; paid trip's receipt lost after a restart; booking with the old fare right after a pickup change; passenger trapped on trip-complete when unpaid; new booking possible while a trip is unpaid; "someone else" passenger dropped; pending deposit could not be re-checked; profile save failed after restart; unseen transfer shown as "failed"; price refresh failure left Book disabled; category names not from config; appearance not reset on account deletion; late auto-pickup overwrote the passenger's choice.

### Tests executed
typecheck 0 errors · core **84 passed** · rider **21 passed** · Rider iOS + Android and Driver Android bundles export. **Not executed:** device/simulator runs.

### Next steps
1. Device-verify on an iPhone and an Android phone: navigation, appearance persistence, editable pickup, profile photo, payment states, single car category (DEVICE_TEST_MATRIX).
2. Receive real onboarding photography/footage (Q-050) and the vector logo (Q-008).
3. Phase 4 Driver app (PIN entry, payout account, location session).

### 2026-10-21 18:25 — First device screenshots (iPhone, dark mode, Expo Go)
- Owner's screenshots at 17:30 show the **previous** build (Keke "Yellow TVS King" driver, old "Pay by bank transfer" screen with a ₦50 fee and a GoBye virtual account). The UI-update files reached the owner's folder at 17:55, so those screens are superseded; no code path in the current build produces them.
- Real issue seen: a disabled primary button ("Submit rating" before a star is chosen) looked like a faded, half-enabled green in dark mode. Fixed in `Button`: disabled primary now uses a neutral fill with grey text. typecheck 0 errors; tests 84 + 21 passed.

### 2026-10-21 19:10–20:00 — Screen layout brief (18 prompts), layout & structure only
- Owner instruction: apply **only the design layout and structure; do not change the font/typeface**. The brief's working colours (aubergine #351A40, tangerine #FF751F) and Plus Jakarta Sans were **not applied** — palette and font stay as they are (Q-047, Q-048 remain open).
- **Onboarding:** logo top-left with progress segments opposite; scene 1 = one dominant photo card with two partially visible cards behind and a tangerine route curve; scenes 2–3 = one large rounded frame; fixed-height text area so buttons don't move; "Get started" + "Already have an account? Log in"; gentle auto-advance and drift, still and manual under Reduce Motion. New headlines ("Your next move starts here.", "A ride that fits your journey.").
- **Pricing:** journey card (pickup/destination with vertical route indicator and edit), pickup note sheet (gate/landmark), prominent suggested fare with time and distance, Quick Match / Negotiate as two selectable cards with explanations, config category card, expandable breakdown; action reads "Find a driver at ₦X" or "Make an offer".
- **Driver found / arriving:** white scrolling page in the reference's order (compact live map with approach line and recentre, status, large ETA + clock time, data-driven progress, vehicle, driver card, PIN, journey card with pickup note), Message/Call anchored, cancel secondary; states approaching / arrived / delayed / reconnecting with location freshness.
- **Trip in progress:** map-led with SOS and recentre; panel with status, ETA, time and distance left, journey-progress bar, driver/vehicle, agreed fare, Share trip and Safety & help.
- **Payment:** "Pay with" and "Pay to" (driver + trip reference) sections, insufficient-balance and already-paid states, "Pay ₦X" action, transfer payment reference with copy, "Awaiting confirmation" until received, journey summary with route details.
- **Trip completed:** date + trip reference, "Total paid" only when paid (else "Total due" + Pay), Download/Share receipt, Back to Home / View in Activities.
- **Wallet:** balance-led with Add money / History tiles, deposit-in-progress banner, transaction detail sheet with next actions, reversal naming.
- **Invite friends:** code + link with Copy/Share, summary figures, 3-step qualification, new `qualifying` ("In progress") referral state, empty state.
- **Account:** centred identity; groups Profile · Preferences · Security · Account actions; photo preview / saving / error / permission states in the sheet.
- **Sheets:** discard confirmation for passenger details, pickup note and deposit amount.
- **Not built (outside the Rider app or not buildable in Expo Go):** iOS trip-status surfaces (§15, see `docs/DYNAMIC_ISLAND_SPEC.md`), driver payout setup (§10) and driver vehicle/map panels (§18) — Driver app, Phase 4.
- Tests: typecheck 0 errors; core 84, rider 21 passed; Rider iOS + Android bundles export. **No device run.**

### 2026-10-21 19:31–20:30 — Monochrome colour system (D-034)
- New semantic tokens in `@gobye/ui` for both themes (white/#171717 light, black/#FAFAFA dark; neutral greys; separate status colours; brand accents aubergine #351A40 / tangerine #FF751F only for logo, illustrations, route lines, ratings, rewards).
- Components: black/white primary, grey secondary, neutral disabled; radio rows add a weight change; switches keep a contrasting thumb in dark mode; inverse toasts; inputs follow the keyboard appearance; sheets get a hairline border in dark mode; neutral avatars; active tab = filled icon + semibold label.
- App: palette preview switch removed; splash held until the saved appearance is applied; root/Android navigation background follows the theme; vehicle marker monochrome (grey when stale); neutral dark map style; monochrome receipt PDF.
- Brand raster marks and both apps' icons recoloured to the new hexes; splash backgrounds #FFFFFF / #000000 (driver splash no longer aubergine). Driver app gets a theme-following status bar.
- Admin console republished with the same token set.
- Tests: new contrast test (every text/status pair ≥ 4.5:1 in both themes) replaces the palette-switch test. typecheck 0 errors; core 84 + rider 21 passed. **No device run** — dark/light screens still need checking on a phone.

### 2026-10-21 19:38–21:00 — Full UI, UX and responsiveness audit
- **Screens audited:** 31 routes plus 8 sheets (inventory in `docs/UI_AUDIT.md`); Driver app shell and admin console checked for colour and copy.
- **Rendered:** web build in headless Chromium, 41 screens/states × 10 widths (320 to 480) × light/dark, two passes of 664 captures each (`docs/RESPONSIVENESS_AUDIT.md`, samples in `docs/qa-screenshots/`, harness in `tools/qa-web/`). Not on a phone.
- **Fixed:** type scale tightened with per variant text scaling caps; large button 52 pt; disabled primary neutral; all dashes removed from visible copy (apps, mocks, admin); TextField overflow; onboarding at 320×568; Home sheet height and address wrapping; options fold, mode cards stacking and route connector overlap; searching cancel cut off; trip complete footer at 320; wallet row squeeze; Personal details empty after restart (real bug); switch thumb contrast; toast and sheet surfaces.
- **Blue gear in screenshots:** Expo Go's developer tools button, not app code; absent from real builds.
- **QA only additions:** `react-native-web`, `@expo/metro-runtime`, `react-dom` for the Rider web QA build; `MapCanvas.web.tsx` placeholder; web fallback for the session token store. Native bundles unchanged (checked).
- **Tests:** typecheck 0 errors; core 84 and rider 21 passed; Rider iOS + Android export.
- **Remaining:** device checks (keyboard, safe areas, OS text size, native maps, gestures); app wide offline notice; account recovery; no drivers and reconnecting states not captured in the render runs.

### 2026-10-21 20:12–22:10 — Reference-led redesign, brand-coloured floating nav, skeletons (D-035)
- Floating navigation tray; selected tab in the brand colour (aubergine light, tangerine dark) with filled icon and semibold label.
- Shared skeleton system in `@gobye/ui`, applied to Wallet, Home (pickup and places), Search, Options, pickup on map, Activities, Notifications, Invite friends, Account, Negotiate responses, Searching, Driver arrival, Trip in progress, Trip completed, Receipt/ride detail and the payment screen.
- Screens rebuilt against their references: Wallet (benchmark recreation), Onboarding, Searching, Driver arrival / pickup coordination, Trip in progress, Trip completed, Payment confirmation (Review, Paying, Done), Payment method sheet, Bank transfer and deposit sheets, Login steps (Step N of 3, six-box OTP), Location primer, Negotiate, Home, Search, Options, Pickup on map, Activities, Account + all sub pages, Invite friends. Shared `Sheet` refined (centred title, optional hero).
- Screenshots per screen, light and dark, at 390 wide in `docs/screens/` (web QA build, headless Chromium). Not on a phone.
- Tests: typecheck 0 errors; core 84 and rider 21 passed.
- Not captured in renders: insufficient balance / failed / reversed payment states, delayed and reconnecting arrival states, skeletons (mock data loads too fast to catch on screen). The QA script's passenger and pickup sheet steps need updating for the new Home layout.

### 2026-10-21 21:00–21:40 — Premium search input and receipt placement
- **Search input:** new shared `SearchField` (`packages/ui/src/components/SearchField.tsx`) with reusable `inputElevation` tokens: white surface (dark: raised grey) with a hairline border and three layered low-opacity shadows, radius 20, height 60, inset circular arrow action (40), pressed state settles (scale 0.985, shallower shadow, none under Reduce Motion), focused state adds a soft outline ring. Dark mode uses a faint outline ring plus surface lift instead of visible shadow. Used for the primary search on Home and on the Search screen (clear action while typing); ordinary fields keep the flat `TextField` so primary search stays the most emphasised input. New MingCute icons: `arrowRight`, `download`.
- **Receipt placement:** Trip completed no longer shows a receipt section while payment is pending; paying is the single primary action. Once payment is verified, a compact secondary receipt row (Share, Download, "Also in Activities") appears. Trip history keeps the receipt with a secondary "Download or share receipt" action.
- Tests: typecheck 0 errors; core 84 and rider 21 passed. Rendered Home, Search and Trip completed (unpaid) at 320 and 390, light and dark, in the web QA build. The paid state wasn't captured because the QA script's payment step needs updating for the new payment screen. No phone run.

### 2026-10-21 21:08–21:30 — Copy reduction across all screens
- Every Rider screen, sheet, toast and error, the Driver placeholder and the admin console reviewed against the owner's brief: one heading per screen, short direct sentences, no repeated amounts or headings, short actions ("Continue", "Find a driver", "Offer your fare", "Pay ₦X", "Add money", "Message"), optional explanations moved behind toggles or info sheets (e.g. deposit "How it works", referral terms sheet), empty states reduced to a heading and one action, errors shortened to what happened and how to fix it.
- Kept visible: pickup and destination, driver and vehicle identification, fare and charges, payment status, reward conditions, safety (112) instructions, the location permission purposes, and "Simulated" disclosures (shortened).
- No layout, size or colour changes. typecheck 0 errors; core 84 and rider 21 passed; Rider web, iOS and Android bundles build; screens rendered at 390 wide in the web QA build. No phone run.

### 2026-10-21 21:19 — Compact shortcut tray on Home
- Home, Work and Saved are now one shortcut tray: pale grey rounded container (radius 18, 6 pt padding and gaps) holding three equal white items (dark: neutral grey items in a darker grey tray with a hairline border), radius 12, height 56, 18 pt outline icons over a short label. Address previews and "Add" subtitles removed; the address shows on the next screen (options or the add address search). Pressed state uses the secondary pressed fill. Skeleton mirrors the tray.
- typecheck 0 errors; core 84 and rider 21 passed; Rider web, iOS and Android bundles build; Home rendered at 320 and 390, light and dark, in the web QA build. No phone run.

### 2026-10-21 21:22 — Home promo card and wallet refinement
- **Home promo card** (`features/promo/PromoCard.tsx`): placed right after the location notice ("Use my location for pickup"), aligned with the pickup panel margins. Aubergine card (radius 24) with eyebrow, bold headline, one sentence, a white "View offer" pill on the left and the 3D gift render on the right over a soft tangerine glow and faint route arc; layered shadow in light, hairline highlight in dark. Content is the genuine admin configured referral campaign ("Earn ₦500 per friend", "When a friend takes their first paid trip."), the spoken label includes the limit, and the CTA opens Invite friends. Replaces the small Invite friends row. Shown only when the programme is enabled.
- **Wallet deposit card:** the solid orange banner became a calm status card: white (dark: raised grey) surface, soft tangerine outline, small tangerine status dot, "Deposit in progress", the amount large with quieter kobo, one sentence, a compact "Pending confirmation" badge and a quiet "View status →" action. No illustration.
- **Recent activity:** rows now show only what happened, when, the amount and a status only when it matters (Pending, Failed, Reversed). Smaller 32 pt neutral icons, medium weight titles ("Bank transfer", "Trip to …", "Payment reversed"), relative time, amounts right aligned in text colour, no "Successful" labels, thinner inset separators, lighter container shadow.
- typecheck 0 errors; core 84 and rider 21 passed; web build rendered Home and Wallet (with a pending deposit) at 320 and 390, light and dark. No phone run.

### 2026-10-21 21:32 — Promo card trimmed, motion on 3D renders, Home opens to the shortcuts
- Promo card made compact (min height 84, radius 20): no "Referral reward" eyebrow, no "View offer" button (the whole card opens Invite friends), no coloured glow or arc behind the render; headline + one sentence on the left, 72 pt gift on the right.
- All 3D illustrations (`Illustration` in `@gobye/ui`) now float gently (slow up/down drift with a slight tilt, random phase per instance); still under Reduce Motion or with `still`. MingCute UI icons are not animated.
- Home sheet opening height is measured so the first view shows "Where are you going?" through the Home, Work and Saved tray at every screen size (capped at 80% of the screen); it still expands for recents.
- Jest: the Reanimated mock is extended with inert `useReducedMotion`, `withDelay` and `cancelAnimation`.
- typecheck 0 errors; core 84 and rider 21 passed; Home rendered at 320, 390 and 430 (light and dark) in the web QA build. No phone run.

## 2026-10-21 (late): transaction colours, promotions carousel, notifications, delete account

- **Transaction direction vs status (Wallet + Activities):** new `features/common/Money.tsx` (`SignedAmount`, `TxStatusBadge`). Money in is green with "+", money out is red with "−"; failed/reversed amounts are grey and struck through. Status is a separate `StatusBadge` (icon and label) shown only when it isn't a normal completed item, so a pending debit stays red and also reads "Pending". Activities trips are shown as debits. Tokens: light `warning` #92400E on `warningSurface` #FEF9C3 (dark amber on pale yellow); dark `warning` #FCD34D on #2B2108.
- **Promotions:** `ServiceConfig.promotions` (admin configurable: `autoAdvanceSeconds`, items with placements, art, details, action). `PromoCarousel` is swipeable with dots and auto advance. It pauses on touch, on drag and while an offer is open, and stays still under reduced motion; a single promo is static with no dots. Each promo opens `/promo/[id]`. It sits on Home after the location notice and on Wallet (replaced by the deposit card while a deposit is pending). Content is real features only: referral, wallet top up, book for others.
- **Notifications:** inbox at `/notifications` from the bell (Home and Wallet), with one dot per unread state. Settings keeps "Notification preferences". Tab badge removed.
- **Referrals:** summary (Invited, Qualified, Total earned) in a compact nested container at the top.
- **Delete account:** separate destructive section at the bottom of Account. The confirm page needs a checkbox before the final button is enabled, then processing, failure (Try again) and success states. Nothing is deleted on the first tap.
- Removed the dead `Banner`/`LOW_BALANCE` from wallet.tsx.
- Checks run: `tsc` clean, Jest 105 tests passing (21 + 84), web export plus Playwright screenshots at 320/390 in light and dark (Home, Activities, Wallet, Account, Referrals, Notifications, Delete, Promo), native android+ios export OK. Not run on a real device. A pending wallet row and a trip row were not captured in screenshots: the seeded account has no pending transaction and a new account has no trips.
- Next: tick the delete checkbox and capture the confirm state in QA; fix the selector drift in `tools/qa-web/run.js`; add promotions editing to the admin console.

## 2026-10-21 (night): end-of-trip redesign (D-036)

- `trip-complete.tsx` rebuilt as step 1, focused on payment: a neutral CompletionMark, "You've arrived" and the destination, the amount due once with "View breakdown" (sheet), the method row with Change, a status line only when needed (shortfall, transfer not received, failed, reversed) and one primary action. "Pay later" stays as a quiet text action.
- New `trip-paid.tsx` (green CompletionMark, "Payment successful", amount once, Continue) and `trip-summary.tsx` (rating with Skip, compact driver and vehicle with plate, Download/Share receipt, expandable Trip details and Payment details, Report an issue, Back to Home, which calls `finish()`). `trip-payment.tsx` removed; routes registered in `_layout`; `liveRoute` and the `app/index.tsx` restore route updated.
- PaymentMethodSheet: no subtitle or footnote; the wallet row shows the balance and the shortfall. TransferSheet: titled "Bank transfer", only bank, account name, account number, amount and reference (each with Copy), then "I've transferred" and one short line. CopyRow gained `spoken`. `paymentReference()` in `features/trip/live.ts`.
- `features/trip/CompletionMark.tsx`: spring pop plus one fading ring (about 0.6 s); still under reduced motion.
- `Button.loadingLabel` (packages/ui) shows a spinner with words ("Paying", "Checking transfer").
- Checks: rider and driver typecheck clean, Jest 105 passing, web export, Playwright run through a full booking at 320 and 390 in light and dark (trip completed, method sheet, transfer sheet with the copy toast, checking, payment successful, summary with details expanded). In the mock the transfer was confirmed on the first check, so the "not received" pending line was not captured. Not tested on a device.

## 2026-10-21 (late night): payment confirmation audit and fixes

Defects found and fixed:
1. **Stuck on "Paying" forever** if a payment request never answered. The provider now times out after `PAYMENT_TIMEOUT_MS` (25 s) and sets the payment to *pending, not confirmed* (`paymentNotice: 'not_confirmed'`), never "failed", because money may have moved. "Check again" retries; the wallet charge is idempotent per booking.
2. **Transfer details unreachable** once a transfer was "not received". The status line now has a "Details" link.
3. **A failed transfer check offered "Pay ₦X" again**, which invites a second transfer. Now it offers "Check again".
4. **Double payment by switching method** after "I've transferred" (or after a wallet payment that didn't confirm). Switching now asks first ("Already sent the transfer?", Keep / Use anyway).
5. **False shortfall when the wallet failed to load** (₦0 treated as the balance). It now shows "Balance unavailable. Retry" and no shortfall, in both the screen and the method sheet.
6. **The reducer allowed a method change during processing or after payment.** `SET_PAYMENT` is now rejected in both cases (core test added).
7. **Home and Activities banners said "Payment outstanding" while a payment was confirming**, and "Current ride" for a paid trip. New `liveBannerCopy()`: Confirming payment / Payment pending (Check) / Payment outstanding (Pay now) / Trip paid (View). The Home toast for a blocked booking also says when the last payment is still being confirmed.
8. **A paid trip with its summary still open blocked nothing**, but starting a new booking from Home would sit on top of it. Home now records it (`finish()`) before a new booking.
9. **"Pay later" while a transfer was pending** now reads "Check later", with the toast "Payment pending. Check again from Home."
10. **A second quick tap** no longer shows a "payment already in progress" error toast. **Copying a kobo amount** now copies two decimals.

Tests: new `trip-payment-screen.test.tsx` (transfer not received → Check again, Details, Check later, switch guard) and `trip-payment-timeout.test.tsx` (request never answers → pending, not confirmed, Check again); a provider flow test for the timeout; the core reducer guard. Rider 24 tests and core 84 tests pass; typecheck clean; web and native exports OK. The pending states were checked in tests, not in browser screenshots: the simulated bank's randomness can't be steered from the web build.

## 2026-10-21 (night): GoBye Management platform (specification + prototype)

Owner brief: one management platform with workspaces and permissions per team over the same records; backend pending, so a complete specification plus connected frontend flows. Owner chose a new admin web app and the spec in the repo.

- **Shared model** in `@gobye/core` `platform/`:
  - `permissions.ts`: 10 roles as permission groups, 49 permissions, city scope, read only auditor.
  - `ledger.ts`: double entry, idempotent by reference, wallet funding, trip charge, withdrawal reserve, settle and release.
  - `workflows.ts`: status tables for withdrawals, refunds, cases, verification, collections, announcements, campaigns, integration connection states, and config versions in force.
  - `approvals.ts`: four eyes rules, `canDecide`, `postApprovedAdjustment`.
  - `mockPlatform.ts`: a seeded test dataset with shared ids. It has 13 staff, 48 passengers, 36 drivers and 160 trips, plus cases, a balanced ledger, collections, withdrawals in every status, refunds, settlements, 12 integrations (none live), config versions, campaigns, announcements, approvals, events and audit.
  - Tests: 101 core tests pass, including ledger balance, duplicate webhooks, no double spend, reserves, transitions, a dataset consistency check and approved corrections.
- **`apps/admin`** (Vite + React):
  - **Simulated sign in:** you pick a test staff account. Data persists across staff switches in the tab so cross team flows can be followed.
  - **Navigation:** the nav is driven by permissions, with role homepages, global city and date filters, and light, dark and system themes.
  - **Shared record panels:** trip, passenger and driver panels show the same record from every workspace, with contact details, money and safety location tailored by permission.
  - **Workspaces:**
    - Oversight: Overview, Approvals, Staff, Audit, Reports.
    - Operations: Live, Trips, Passengers, Drivers.
    - Care and safety: Cases, Safety.
    - Finance: Collections, Wallets, Earnings, Withdrawals, Refunds, Settlements, Reconciliation, Ledger.
    - Configuration (versioned with effective dates and approval): Service areas, Categories, Fares, Packages, Referrals.
    - Growth: Announcements, Promotions, Events.
    - Technical: Payments setup, Integrations, Events and failures.
  - **How it was built:** the workspaces were built in parallel against `apps/admin/BUILDING.md`.
- **Specification** in `docs/management/`: README, 01-foundation through 10-implementation-and-acceptance. Every module follows the 10 point template, with backend needs and open questions.
- **Integration fixes after the parallel build:**
  - Approved ledger corrections now post (a structured `adjustment` on approval requests, plus a `suspense` account for reconciliation differences).
  - Test data aligned to D-024 package prices (₦2,000 / ₦60,000) and the ₦500 cancellation fee.
  - Wallet funding fees are now posted to processing costs.
  - Cards were removed from the Paystack capabilities (D-023).
  - Dashes were removed from empty values.
  - Brand colour is no longer used for statuses.
  - The phone width topbar no longer overflows.
  - The promotions preview now matches the app card (no button, no art background).
- **Checks run:**
  - Admin: typecheck clean; Vitest 240 tests (16 files).
  - Core: Jest 101 tests. Rider: 24 tests.
  - Admin production build OK.
  - Playwright tour of 30 screens across 10 roles in light and dark, plus phone width.
  - A cross role journey passed: finance requests a wallet correction, cannot approve it themselves, the owner approves, the ledger posts it and the audit records it.
  - Not tested against any real provider, bank or device. Sign in and permissions are UI only until the backend enforces them.
- **Docs:** D-037 and D-038, Q-056 to Q-061, implementation plan rows 10 to 12, dependencies, README.
- **Known deviations still open:**
  - Config values are whole naira (Q-060).
  - `canDecide` checks roles, not `approvals.decide`.
  - Staff changes don't alter the simulated sign in list.
- **Next:** owner review of `docs/management/` and Q-056 to Q-061, then backend phase 1 (staff auth, permissions, audit).

## 2026-10-22 (morning): GoBYE website (hero + trust) and a Home sheet fix

- **Website** in `apps/web` (D-039). It is static HTML, CSS and JS, with the content model in `site.config.js`.
  - **Hero:**
    - Nav with the logo, the "GoBYE" wordmark and a "Join the waitlist" pill.
    - Headline "Your next move." (72 / 56 / 42 px), supporting text and the "Coming to Lagos and Abuja." line.
    - A full-bleed photo with the brief's overlay (dark top, lighter around the phone, black fade at the bottom).
    - A tangerine "Join the waitlist" CTA.
    - Entry motion: headline fades up 20 px over 600 ms, supporting text +100 ms, photo settles over 800 ms, still under reduced motion.
    - Desktop is one viewport. On mobile the copy stacks above a portrait crop and the hero grows past one screen.
  - **Waitlist dialog:** email, city and ride/drive, with inline validation. Success shows only after a 2xx from `waitlist.endpoint`. With no endpoint it states "Demo only: not saved". Errors keep what was entered.
  - **Store badges and QR card:** badges replace the waitlist only when `launch.status` is `live` and both store links are real. The QR card is hidden until it has a real URL and a caption.
  - **Trust (white):** "MEET GOBYE" with three product cards.
    - The verified social proof (rider count with definition, two rating badges with source links, two opposing marquee rows of permissioned testimonials) renders only from verified config data.
    - The marquee has a pause control, pauses on hover and focus, and its loop copy is hidden from screen readers. Reduced motion gives static scrollable rows.
    - `components.html` previews the verified components with labelled placeholders.
  - **Hero image:** a stand-in.
    - Source: frame 0 of the owner's reference video, upscaled 2×.
    - Composite: the current passenger home screen at 3× density, perspective-warped into the phone screen. A skin mask near the edges keeps the thumbs on top. A status bar and a faint glass reflection were added.
    - Final photography is pending (Q-062).
  - **Checked:** Playwright at 1440×900, 1920×1080, 1024×768, 768×1024, 390×844 and 360×740. There is no horizontal overflow, the copy, phone and CTA don't overlap, and the form shows its errors and the demo result. Plus Jakarta Sans couldn't load in the sandbox browser, so the screenshots use the fallback face.
- **Rider Home fix:** the sheet opened too low on the web build and the Home/Work/Saved tray sat under the floating tab bar.
  - Cause: on the web, `onLayout` only fires on size changes, so the tray's position went stale once the promo carousel finished sizing.
  - Fix: the opening snap now measures the whole block from the title to the tray, so the tray ends at 750 px against the bar at about 776 px on a 390×844 screen.
  - Checks: rider typecheck, 24 tests and the native export pass.
- **Docs:** D-039, Q-062 and Q-063, ASSET_INVENTORY website section, `apps/web/README.md`.
- **Hero changed to a video box (owner request):**
  - Layout: black stage, then nav and copy, then the video in its own rounded box (radius 28, 1280:778, at most 1120 px wide, sized so the CTA stays on screen at desktop sizes), then the CTA.
  - Video: rebuilt from the owner's reference footage with the real passenger home screen tracked into the phone on all 96 frames, and a seamless loop.
  - Behaviour: there is a pause/play control. Reduced motion shows the poster and does not autoplay. If autoplay is blocked, the control switches to play.
  - Checked at 1440×900, 1366×768, 1920×1080, 1280×720, 1024×768, 768×1024, 390×844 and 360×740. The box, headline and CTA share one centre line, the CTA is visible on every desktop and tablet size, there is no overflow, and the video plays (WebM fallback in the open-source Chromium used for tests).
  - Cleanup: the hero stills `hero-desktop.jpg` and `hero-mobile.jpg` were removed.
- **Owner request: use the uploaded video as is.** `hero.mp4` is now the original upload (frames unchanged; faststart, audio removed), with a VP9 WebM of the same video as a fallback and its first frame as the poster. The box is 16:9; on phones it is zoomed towards the phone (46% from the left). The composited version is no longer used.
- **Website redesign (owner prompt `gobye-landing-page-prompt.md`; hero video section kept unchanged):**
  - **Type and layout:** DM Sans outside the hero, with tight headlines. White and #F4F4F4 sections, 32 px cards and a 1100 px content width. The brand gradient (tangerine to apricot for CTAs, aubergine to plum for highlight cards and accent text) replaces the prompt's blue/violet.
  - **Sticky navbar:** logo, "For riders | For drivers" toggle and a gradient waitlist pill. It is transparent over the black hero and turns white once past it. There is no language selector because the site is English only.
  - **Audience toggle:** switches the steps, features, statement, comparison and banner between riders and drivers, and preselects ride or drive in the waitlist. The choice is remembered per browser.
  - **Step by step:** a pinned deck of 4 cards that tilt in (rotateX/rotateZ) and flatten as they land, alternating white and gradient. Rider cards use real app crops (`assets/ui/`). Driver cards are text only because the driver app is not built.
  - **Additional features:** a carousel of 6 cards (300 or 480 px wide, 360 px tall) that can be dragged, swiped or moved with the arrow buttons and keys. Cards use real app crops and 3D renders.
  - **Social proof:** verified only, with no laurel wreaths. The prelaunch "MEET GOBYE" block shows until real data exists.
  - **Statement:** fills word by word as you scroll.
  - **Comparison:** 5 ✕ against 7 ✓, the last 3 in gradient text, with no prices.
  - **Final banner:** 40 px radius, using the hero poster blurred.
  - **Founder card:** shown only when `founder` config is real.
  - **Footer:** white, with only real links; the apps are marked "Coming soon".
  - **Not built (would be fake):** the AI chat bubble and the floating founder card.
  - **Reduced motion:** no pinning, tilt or fill. **Phones:** stacked cards and a swipeable carousel.
  - **Checked:** Playwright at 1440×900, 1366×768, 768×1024, 390×844, and 1440×900 with reduced motion. The hero box size and position are identical to before, there is no horizontal overflow, and the driver toggle works. DM Sans cannot load in the sandbox browser, so the screenshots use the fallback face. No real-device testing.
- **Website: spacing pass and people photos (owner request):**
  - **Step by step:** the headline now sits inside the pinned stage with the deck, which removes the empty screen between them. The headline size scales with the viewport height, and the scroll per card dropped from 62vh to 55vh.
  - **Spacing:** section padding is 120px (statement 160px), with tighter gaps above the rail and the comparison and below the banner.
  - **New "Built for the way your city moves" photo section:** three tiles cut from the owner's hero video (hand with the GoBYE app, people on a Lagos street, the road at sunset), each with a GoBYE app notification drawn over the photo.
  - **Banner:** the background is now much less blurred, so the street reads.
  - **Prelaunch "Meet GoBYE" cards:** removed. The social proof section is now hidden until verified data exists.
  - **`docs/PHOTO_BRIEF.md`:** the shot list for a branded shoot and an AI prompt to replace the video stills.
  - **Checked:** Playwright at 1440×900, 1366×768, 768×1024, 390×844 and with reduced motion. No overflow, and the hero is unchanged.
- **Website: driver step cards now show screens (owner request).** The driver app isn't built yet (only a placeholder screen), so there were no screens to capture.
  - Four design previews were drawn in the rider app's style (Inter, MingCute icons) and rendered at 2× to `assets/ui/drv-*.jpg`: documents review, daily/monthly pass (no prices: "Prices confirmed at launch", D-024), new trip request at the agreed fare with Accept/Counter offer, and trip completed with ₦0 commission.
  - Each shows a "Design preview" pill so it isn't read as a shipped app. They use the same example trip as the rider screens.
  - Source: `apps/web/driver-ui-source.html` (excluded from Vercel). Replace them with real captures once the driver app exists.
- **Website: owner's photos in the people section.** "Golden Hour City Commute" is now `rider.jpg` (Book from the roadside), "Golden-Hour Curbside Conversation" is `street.jpg` (Meet your driver at the kerb) and "Sunset Airport Departure Moment" is `road.jpg` (Pay when you arrive). They were matched by content and are 1122×1402 JPGs. Alt text and focal points were updated. The images are generated, so treat them as illustrations until a real shoot replaces them (PHOTO_BRIEF.md).
- **Website: photo bento fixed (owner feedback: labels badly placed, bento not right).**
  - Layout: one large portrait tile on the left spanning two rows, with two landscape tiles stacked on the right (600 px tall in total). On phones the tiles stack.
  - Labels: the GoBYE notifications now sit inside each photo, top left 20 px in. The kerb photo has it top right (`noteRight`) to keep it off the rider's face. The copied text now reads "GoBYE Where are you going?" with a space.
  - Focal points were set per photo so the faces stay in frame.
  - Checked at 1440, 1024, 768 and 390.
- **Website: white hero and premium soft buttons (owner request).**
  - Hero: white background with a faint warm glow, ink headline in DM Sans (Plus Jakarta Sans dropped, so the site uses one typeface), muted supporting text and a white city pill. The video box is unchanged in size and position and now has a soft aubergine shadow.
  - Navbar: dark text from the start; it becomes frosted white once the page scrolls.
  - CTAs (`.btn-primary`, `.btn-grad`): a soft tangerine gradient (#FFB27E to #FF8438) with an inner top highlight, a hairline border and a low, wide shadow, set in weight 600. The hero and banner CTAs have a white arrow chip. On phones the hero CTA puts its arrow at the right edge, and the small navbar button has a lighter shadow.
  - Checked at 1440×900, 1366×768 and 390×844. The CTA stays above the fold and there is no overflow.
- **Website: Additional features redesigned (owner: "looks nice but feels a bit off").**
  - Problems fixed: visuals tilted at random, floating chips, 3D objects cropped at the card edges, app crops double-framed (their own border inside the card), uneven text, and placeholder bars on the driver cards.
  - One layout for every card: white card (radius 32), title and line on top, then a tinted stage (warm and lilac alternating) with a clean app snippet rising out of it. An optional 3D object sits in front and lifts on hover.
  - Snippets were redrawn in the app's style to `assets/ui/feat/*.webp` (source `feature-ui-source.html`, excluded from Vercel). Rider snippets mirror the built app and keep its "Simulated" and "Preview terms" tags. Driver snippets carry "Design preview".
  - A progress bar was added beside the arrows. Checked at 1440 and 390 for riders and drivers. The rail scrolls to the last card.
- **Website: subtle micro interactions (owner request).** All of them are off when the visitor prefers reduced motion (`js-motion` is not set; verified).
  - **Scroll reveal:** headings, photo tiles, the first feature cards, the comparison, the banner copy and the footer ease up 18 px once, staggered.
  - **Audience switch:** a sliding black thumb in the riders/drivers toggle, and a 180 ms crossfade of everything that changes.
  - **Comparison:** ticks and crosses appear one by one, with the circle marks popping in.
  - **Buttons:** the CTAs get a light sheen sweep on hover and a press scale, and the arrow chip nudges right. The round controls scale on hover and press.
  - **Cards:** feature cards lift 4 px with a deeper shadow and the snippet rises. Photo tiles zoom slowly on hover, and their GoBYE notifications drift gently.
  - **Footer and form:** footer links get a sliding underline, and the waitlist choices press in.
  - **Checked (Playwright, 1440):** after scrolling, nothing that should be visible stays hidden (the only hidden element is the empty Company column). The swap ends at full opacity, and reduced motion shows everything statically.
- **Website (owner requests):**
  - Removed the hero line "Be first to hear when GoBYE launches in your city." (markup and `hero.ctaSupporting`). The waitlist dialog keeps its own subtitle.
  - Navbar condenses on scroll: once the page scrolls, the full-width bar animates into a centred floating pill (660 px wide, 12 px gutters on phones, frosted white, hairline ring and soft shadow) with the logo, toggle and CTA close together. It returns to full width at the top. Checked at 1440 and 390 with no overflow. With reduced motion it switches without animating.
- **Website: Additional features is now a static bento grid (owner request; card design kept).** A 12-column grid with three rows alternating narrow and wide (5/7, 7/5, 5/7) at 1100 px max. Tablet (860 px and below) uses two equal columns; phones (760 px and below) a single column at 380 px tall. The arrows, progress bar, drag and snap code were removed, and the `wide` flags were dropped from the config because JS sets the rhythm. Checked at 1440 (riders and drivers), 820 and 390 with no overflow.
- **Website ready for going live (owner: no "Demo", "Design preview" or similar on the public site), plus a new Safety and security section.**
  - **Labels removed from the visuals:** the "Simulated estimate" band was cut from `assets/ui/fare.jpg`; the driver step screens (`drv-*.jpg`) were re-rendered without "Design preview"; the feature snippets were re-rendered without "Design preview", "Simulated" or "Preview terms". The invite snippet now shows counts (Invited, Joined, Rewards) rather than a ₦ reward amount, since the referral terms are not final. Alt texts no longer say "Design preview". A scan of the rendered page text finds no "simulated", "design preview", "preview terms" or "demo".
  - **Still in place on purpose:** the waitlist dialog's "Demo only: not saved" notice appears only while `waitlist.endpoint` is null. It disappears once a real endpoint is set, and must not be hidden before then, because visitors would believe they had joined.
  - **New "Safety and security" section** (dark, after Additional features; follows the rider/driver toggle; linked from the footer as "Safety"). Every claim is backed by the docs or the app:
    - Riders: in-trip Help (call 112, safety centre, report an issue, share trip; mirrors `HelpSheet.tsx`/`InTripView.tsx`), verified drivers (F-D02/F-D03), driver, car and plate before pickup (R13), pickup PIN (D-031), and fare agreed first.
    - Drivers: passenger PIN confirmation (F-D08, D-031), passengers with phone-linked accounts (F-R sign-in), fare set before accepting, payment through the wallet or bank transfer (D-023), and location only while online (SECURITY_PRIVACY §6, D-026).
  - Checked at 1440, 820 and 390 for riders and drivers with no overflow.
- **Website: Safety section redone (owner: the dark version was too heavy and didn't follow the page).** It is now three white cards on #F4F4F4 with a lilac icon tile, title and one line, matching the other sections. It is placed after the comparison and before the final banner, and follows the rider/driver toggle.
  - Riders: Verified drivers, Pickup PIN, Help on every trip (call 112 or share your trip).
  - Drivers: Confirm every passenger (PIN), Fare agreed upfront, Less cash to carry.
  - The dark styles and the large Help snippet were removed. The banner regains its 16 px top margin. Checked at 1440, 820 and 390 with no overflow and no test labels in the page text.
- **Website: interactive 3D footer (owner brief "Premium Interactive 3D Footer").**
  - **Layout:** a centred "Every journey starts with GoBYE." with supporting copy and the CTA; then an oversized GoBYE wordmark (pale aubergine to peach) with a full-bleed WebGL canvas layered over its lower half; then clean navigation (brand line, Riders, Drivers, Get the app; Company and help appear when real URLs exist), with thin dividers, copyright and cities. The final banner section was folded into the footer to avoid two stacked CTAs, and the founder card slot moved into the footer top (still hidden until real details exist).
  - **Scene (`footer3d.js`, plain Three.js r160 vendored):** a procedural rounded road slab swept along a CatmullRom S curve that runs off both screen edges, with edge lines and instanced centre dashes. Miniature sedans, SUVs and compacts are built from rounded boxes with clearcoat paint, glass cabins, head and tail lights, and wheels with visible spokes that rotate with distance. Two lanes run in opposite directions, driving on the right.
  - **Traffic:** speed drift, easing off behind a slower car, suspension bob and pitch on acceleration, and contact plus directional shadows. The loop is seamless because cars wrap off screen.
  - **Behaviour:** gentle cursor camera on fine pointers, canvas reveal and wordmark parallax on entry, and rendering paused off screen or in a hidden tab. Reduced motion gets a still frame. Phones get fewer cars, a closer camera and no shadow map. Without WebGL only the wordmark shows.
  - **Copy:** the CTA reads "Join the waitlist" before launch and switches to "Book a ride" only when the store links are live. "Reliable rides" was replaced with "fares agreed upfront" (no pre-launch reliability claim). Footer driver and rider links open the waitlist with the matching intent.
  - **Checked (Playwright with software WebGL):** frames differ over time (cars move), the scene runs on screen and pauses off screen, reduced motion shows a still frame, there is no overflow at 1440 or 390, and the links are unobstructed (the canvas has `pointer-events: none`). Software rendering is slow, so frame rate on real devices has not been measured.
- **Website: 3D footer refined (owner: "can it be better").**
  - **Cars:** rebuilt from side profiles extruded with bevels, so each has a real silhouette. Sedan: hood, sloped windscreen, roofline and boot. SUV: tall and upright. Compact: short hatch. Glass is a separate inset volume with a body-colour roof cap, and there is a dark sill. Geometry is shared per type.
  - **Road:** pale stone kerbs on both edges, softer paint lines, and a gentle mask that fades the road into the page at both screen edges.
  - **Light and camera:** a warm key light with a cool rim light from behind, slightly higher exposure, and a slow breathing camera drift on top of the cursor follow. The wordmark tint is a touch stronger.
  - **Tried and removed:** a planted verge with sculptural trees looked cheap and covered too much of the wordmark.
  - **Checked:** desktop and phone render, the scene runs, and there is no overflow.
- **Website: 3D footer whites cleaned up (owner: "the white over can be better").** The kerbs are now a thin lip (11 cm wide in scene units of 0.11, top 0.03 to -0.045) sitting on a slightly wider asphalt slab, so the road's side reads as one dark volume instead of a thick white band. The canvas edge fade uses an eased, 12-stop mask over 19% each side, so there is no visible start line.
- **Website: Safety section made premium (owner: plain cards not premium).** It now uses the same anatomy as the Additional features cards: a white card with title and line, and a tinted stage (lilac and warm alternating) with an app snippet rising out of it. Three columns on desktop, one on phones.
  - Riders: Verified drivers (new `r-driver` snippet: driver name with a "Verified driver" badge, car and plate, "Documents checked by GoBYE", with the 3D sedan), Pickup PIN (`r-pin`), and Help on every trip (`r-help`).
  - Drivers: Confirm every passenger (`d-pin`), Fare agreed upfront (`d-fare`), and Less cash to carry (new `d-paid` snippet: trip paid with the GoBYE wallet, "No cash to collect", with the 3D wallet).
  - The snippets are generated from `feature-ui-source.html`. Checked at 1440, 820 and 390 with no overflow and no test labels.
- **Website: comparison made premium (owner request).** Two 1000 px max cards in the page's card language, each with a stage on top showing the experience. "The old way" is muted grey: a roadside haggling exchange for riders (`r-haggle`) and a fare split with commission for drivers (`d-commission`, no invented percentages). "With GoBYE" is brand tinted: the agreed fare with Quick Match and Negotiate for riders (`r-fare`) and ₦0 commission earnings for drivers (`d-earn`).
  - Each card has a label pill ("The old way" / "With GoBYE" with the logo), a 30 px title (gradient on the GoBYE card), and an audience-specific subline.
  - The ✕ and ✓ lists sit under a hairline. The GoBYE card keeps the gradient border and warm glow, and the last three ticks are in gradient text. The old card copy was corrected to "Fare argued at the roadside".
  - Checked at 1440 (riders and drivers) and 390 with no overflow.
- **Website: step by step scroll effect on phones (owner: no scroll effect on mobile; each step should be a focus point).** At 760 px and below the step cards are now `position: sticky` under the navbar, each offset 10 px lower than the last. The next card slides over the current one, which eases back (scale to 0.93) and dims (brightness to 0.88) as it is covered, so the front card is always in focus.
  - Desktop covered cards now also dim slightly while the pinned deck builds.
  - Reduced motion keeps a plain list.
  - Fix found on the way: `inset: auto` after `top` had cancelled the sticky offset.
  - Checked at 390×844 across five scroll positions.
- **Website: phone fixes (owner: centre button text on mobile; black patch beside the logo on mobile).**
  - The hero CTA text is centred on phones, with the arrow chip pinned to the right.
  - Black patch, not reproducible in headless Chromium, so the three likely causes were fixed:
    1. The logo PNGs stored near-black RGB under transparent pixels and were downscaled from 512 px. Both were re-exported at 128 px with premultiplied resizing and white under full transparency.
    2. On phones, the scrolled navbar pill uses an almost opaque white with no `backdrop-filter`, avoiding Android GPU black-patch artefacts during its width transition.
    3. `<meta name="color-scheme" content="light only">` stops forced dark mode from darkening parts of the page.
  - Owner to confirm on the real device.
- **Website: "Demo only" banner removed from the waitlist dialog (owner request).** The word "demo" no longer appears anywhere on the page. With no `waitlist.endpoint`, submitting shows a neutral, truthful result: "Sign ups open soon. We aren't taking sign ups just yet, so {email} wasn't saved." It never says the visitor joined. A real endpoint is still required before launch, otherwise no sign ups are collected.
  - Fixed: a global `[hidden] { display: none !important }` rule. The dialog's result block (`display: flex`) had been overriding `hidden`, which showed a stray "Done" button under the form.
- **Website: phone hero redesigned on one spacing system (owner brief).**
  - 24 px gutters for the header, text, pill, image and CTA, with 8 px steps: header to headline 32, headline to paragraph 16, paragraph to pill 24, pill to image 32, image to CTA 24, 40 px bottom.
  - Header: 14 px plus safe area on top; the 32 px logo and the 40 px CTA share one centre line.
  - Headline `min(44px, 11.4vw)` stays on one line from 360 px. The paragraph is capped at 320 px with 1.55 line height. The pill has 8/16 padding.
  - The 4:5 image card has a 28 px radius and the full gutter width, and the 56 px CTA spans the same width.
  - Logo artefact: the header (phones) and footer now use `logo-mark-white.png`, an opaque logo on white, so no browser can show dark edges from transparency. Desktop keeps the transparent mark for the frosted bar.
  - Checked at 360, 390 and 430 with no overflow.
- **Website: waitlist connected to Supabase (D-042).** `site.config.js` `waitlist.supabase` holds the project URL and the public anon key. `app.js` POSTs to `/rest/v1/waitlist` with `Prefer: return=minimal`. 201 shows "You're on the list", 409 (duplicate email) shows "You're already on the list", and anything else shows the retry error, keeping the input. Emails are lowercased.
  - A hidden honeypot field was added.
  - `supabase/migrations/20261022_waitlist.sql` creates the table with checks, a unique `lower(email)` index, RLS, an insert-only policy for anon and column grants.
  - Tested in Playwright against a stand-in for the Supabase endpoint (201, 409, 500); the requests carry only the anon role.
  - Not yet tested against the live project: this workspace cannot reach supabase.co, and the SQL must first be run by the owner.
  - The service_role key was not used and must be rotated.
- **Website: premium waitlist window and compact desktop nav (owner request).**
  - **Header band:** a deep aubergine gradient with warm and lilac glows, the mark in a glass tile, an "EARLY ACCESS" eyebrow, a 30 px title and a glass close button that rotates on hover.
  - **Fields:**
    - Email with a mail icon on a soft fill that turns white with a plum focus ring.
    - City as chips (Lagos, Abuja, Another city), replacing the select.
    - Ride and Drive as 58 px options with icons and a plum selected state.
    - A full-width 56 px CTA with an arrow chip, and a privacy line with a shield.
  - **Behaviour:** errors clear as each field is fixed. Success shows a gradient check badge with a ring pulse, "You're on the list", and a primary Done. Phones (560 px and below) get a bottom sheet that slides up.
  - **Desktop nav:** the top state is now a 700 px centred group instead of full width, so the logo, toggle and CTA sit together.
  - **Checked:** Playwright at 1440 and 390 (empty, errors, filled, success); the Supabase stand-in tests still pass (201, 409, 500).
- **Website: waitlist now captures full name and phone number (owner request).**
  - **Form:** Full name (2 to 80 characters, spaces collapsed) and Phone number with a fixed +234 prefix. Accepted inputs are 0803…, 803…, +234 803… and 234803…, all normalised to E.164 `+234[789][01]XXXXXXXX`. Errors clear as each field is fixed, and the privacy line now says "details".
  - **Supabase:** `20261022_waitlist.sql` now creates `full_name` and `phone` (not null, checked). For tables created earlier, `20261022b_waitlist_contact.sql` adds both columns with NOT VALID checks (enforced for new rows) and grants anon insert on them.
  - **Tested:** Playwright against the Supabase stand-in with six phone formats, an invalid number and a short name. The payload is `{full_name, email, phone, city, intent, source}`.
  - Phone numbers are personal data: the privacy notice (Q-063) is now more pressing.
- **Website: waitlist redesigned as a four step journey (owner: "be very creative with the form").**
  - **Route header:** a route with four stops (You, Role, City, Contact); a white car chip drives along an orange fill and turns orange on arrival.
  - **One question per step, sliding horizontally:**
    1. Name ("First, what should we call you?").
    2. Ride or Drive as illustrated cards with the 3D pin and car; the question uses the visitor's first name.
    3. City tiles.
    4. Email and phone.
  - **Navigation:** tapping a card or tile moves on by itself; there is a back button; Enter continues; errors appear per step; the height animates to each step.
  - **Success:** an "Early access pass" ticket with name, role and city, a perforation and the confirmation line.
  - **Accessibility:** inactive steps are `inert`, a live region announces "Step n of 4", and reduced motion removes the transitions.
  - The Supabase payload is unchanged. Tested on desktop and phone: per-step errors, auto advance, back, the payload, the pass content and 409 handling.
- **Website: hero video pause/play button removed (owner request).** The video still autoplays muted and loops; with reduced motion it does not play and the poster shows. Note: WCAG 2.2.2 expects a way to pause motion lasting over 5 s; reduced-motion users are covered, others are not.
- **Website: state dropdown for "Another city" and a new phone header.**
  - **State dropdown:** choosing "Another city" reveals a "Which state?" dropdown of the other 35 states (Lagos and the FCT have their own tiles). Picking a state moves on, Continue asks for one if missing, and the pass and success message use the state name. The payload adds `state` (null for Lagos and Abuja).
  - **SQL:** `supabase/migrations/20261022c_waitlist_state.sql` adds the `state` column, a check tying it to "Another city", and the anon insert grant. It must be run before deploying.
  - **Phone header (owner reference image):** a full-width two-tab bar (For riders | For drivers, active tab lilac, inactive pale) sits above a white logo row with a hairline. The header CTA and the floating pill are hidden on phones, and the in-section toggle was removed (the tabs replace it). `--nav-h` is 116 px plus the safe area, so the sticky step cards sit below it.
  - **Checked:** at 390 px; the tabs switch content and there is no overflow.
- **Website: phone logo row restored.** "Join the waitlist" is back in the header beside the logo (32 px mark, 40 px button, 68 px row) under the audience tabs; the header totals 120 px plus the safe area. The gap from the header to the headline goes from 32 to 40 px.
- **Website: feature bentos cut to four cards each (owner request).**
  - Drivers: "Withdraw to your bank" and "PIN check at pickup" removed; kept Daily or monthly pass, Fare first, Counter offers, Earnings at a glance.
  - Riders, the matching pair: "Pickup PIN" (also in Safety) and "GoBYE wallet" removed; kept Book for someone else, Saved places, Pickup notes, Invite friends.
  - Two rows, narrow and wide then wide and narrow. The Safety section is unchanged.
- **Website: hero spacing rhythm (owner brief: more breathing room on desktop and mobile).**
  - Desktop and tablet: nav to headline 64, headline to text 20, text to pill 28, pill to image 48, image to CTA 32 (it was about 21 px under the nav before).
  - Short laptops (820 px or less tall): 40/16/20/32/24.
  - Phones: 48/20/28/40/28, with 24 px gutters.
  - Nav, video box and CTA share one `--stage-w`, so the nav's edges line up with the video's (1440: 381/381; 1366: 363/364).
  - The video formula was rebalanced so the CTA sits 24 px above the fold on 1920×1080, 1440×900 and 1366×768.
  - Checked at 8 sizes with no overflow.
- **Website: rider and driver content fully separated (owner: the two pages should differ).** The hero (headline, supporting line, CTA), the photo section (eyebrow, title, tile captions and notification chips, photo order) and the footer (title, line, CTA) now come from `audiences.{rider,driver}` and switch with the toggle. The step cards, features, safety, statement and comparison already did.
  - **Driver copy:**
    - Hero: "Drive more. Keep it all." / "See the fare before you accept, keep every naira you earn, and pay no commission on your trips." / "Join as a driver".
    - Photo section: "Your car, your hours, your earnings."
    - Footer: "Every trip pays you in full."
  - The driver CTA preselects Drive in the waitlist. The hero video is shared.
- **App design: auth flow canvas (Design artifact "GoBYE Auth Flow").** Six dark screens built on DESIGN_SYSTEM tokens: Welcome, Create account, Sign in, Phone number, Verify phone, Reset password. Per the owner, there are no background glows or gradients. The welcome hero is the live 3D road scene (the same `footer3d.js`, bundled), and `footer3d.js` gained `theme: 'dark'`: #262626 asphalt, #A3A3A3 lines, lighter dark cars, no shadow floor. The website footer is unchanged (light default).
  - **Open:** email, password, Apple and Google sign-in conflict with D-008 (phone + OTP only), so the owner must decide.

- **Driver app built end to end (D01–D17) on simulated services, reusing the rider app's building blocks.**
  - **Shared with the rider app (moved into `@gobye/ui`, rider imports re-export them):** sign-in steps (`AuthStepHeader`, `CodeBoxes` — now with a `length` for the 4 digit pickup PIN, `FieldMessage`), `MapCanvas` (+ web QA variant, at `@gobye/ui/src/map/MapCanvas` because it needs react-native-maps), `FloatingTabBar` (icons and haptic passed in), `JourneyBar`, `CompletionMark`, `VehicleSummary`, and the account `PageHeader` / `SettingsGroup` / `SettingsRow`. Icons added: power, chart, calendar, certificate, road, key, trendUp, userSecurity, ticket.
  - **New rules in `@gobye/core` (tested):** `driver/onboarding.ts` (licence, expiry, NIN/VIN/passport, plate, model year ≥ 2008 placeholder, NUBAN, step order, submit) and `driver/trips.ts` (requests and expiry, counter suggestions and limits, trip stages, pickup PIN with 3 tries then lock, no-show only after the waiting time, payment pending until confirmed, earnings by day/week/method, simulated request and history generators). 19 new tests.
  - **Screens:** welcome (owner's curbside photo), phone + OTP, registration checklist and 5 steps with camera/library capture, verification status (review auto-approves in the preview), Drive dashboard (map, today's earnings, access pass, Go online/offline with tracking issues), location explanation (When In Use + precise only), access pass purchase (daily ₦2,000 / monthly ₦60,000, provisional), Quick Match and negotiation requests (20 s countdown, accept / counter once / decline), active trip (to pickup → arrived → PIN → in progress → end, directions hand-off, masked contact and safety simulated), trip complete (payment pending → received), Earnings, Trips + detail, Account (documents, payout account, request preferences, appearance, haptics, help, delete, restart preview).
  - **Dependencies (driver, same versions as rider):** async-storage, expo-clipboard, expo-haptics, expo-image-picker, expo-location, expo-secure-store, react-native-maps, react-native-web, react-dom, @expo/metro-runtime. `app.json` has location (no background) and camera/photo purpose strings.
  - **Checked:** typecheck 0 errors; tests core 120, rider 24, driver 2; `expo export` iOS + Android for rider and driver; the whole driver journey walked in the web QA build in light and dark (sign-up → approval → pass → online → request → counter/accept → PIN → end → payment → earnings/trips/account). Not tested on a device.
  - **Next:** device test in Expo Go (`npm run driver`), then a development build with `expo-task-manager` for background location while online.
- **Rider: Change pickup sheet redesigned (owner brief: clear hierarchy).**
  - **Hierarchy:** "Search for an address" is the primary action: a raised card (hairline border, `shadows.card` in light, `surfaceSelected` in dark), 24 px search icon, headline label with a "Street, landmark or place" hint, a small chevron, and a pressed state. "Choose on map" ("Drag the map to pinpoint your pickup.") and "Use my location" are quieter rows: 20 px icons in the same 24 px column as the search icon, callout titles, caption details, no dividers or containers, and a soft pressed background. Rows are at least 56 px tall.
  - **Header:** the shared `Sheet` gains `headerAlign="leading"`: a left-aligned title3 heading with a small 32 px close button (48 px touch area) on the same line, and tighter spacing from the grabber. Other sheets are unchanged.
  - **Use my location** now always shows and handles each state in place: not yet asked → the pre-permission screen, which then sets the pickup (`next=pickup`); off → opens Settings; allowed → takes a fresh fix, looks up the address, sets the pickup and confirms with a toast. While it works it shows a spinner and "Finding you…"; if it fails, a message appears under the row and the current pickup is kept. The accuracy is supporting text ("Accurate to about 12 m"). Shared logic is in `features/home/useLocatePickup.ts`, and `useCurrentLocation().refresh()` now returns the fix.
  - Dismissing the sheet changes nothing. It still opens only from the pickup row on Home.
  - **Checked:** 5 new component tests (rider 29 passed). Screenshots in the web QA build at 390 px (light, dark, pressed) and 320×568 with location off. Typecheck passes and the rider export builds.
- **Rider: Activities more detailed, with filters (owner request).**
  - **Period switch:** Week, Month (the default) or All time. Weeks start on Monday.
  - **Spend summary for the period:** total spent in large type, then trips, distance and average fare (whole naira). Failed, reversed and refunded payments don't count as spend. A "n payments need attention" bar jumps to that filter.
  - **Filter chips with counts:** All, Needs attention (pending, confirming, failed or reversed), Wallet and Bank transfer.
  - **Trips grouped by day** (Today, Yesterday, then dates) with each day's total. Each row shows the destination, "From" pickup, time, distance, duration and driver first name, plus the amount and a written payment status. Trips needing attention get a tinted icon.
  - **Empty states:** no trips yet; nothing matching, with "Show all trips". The live-ride banner is unchanged.
  - **Rules:** in `@gobye/core` `booking/history.ts` (periodStart, filterHistory, needsAttention, summariseHistory, groupByDay), with 5 tests.
  - **Checked:** web QA at 390 px (light and dark) and 320 px, with every filter; typecheck passes; tests core 125, rider 29, driver 2; the rider export builds.
- **Rider: new welcome and full sign-up / sign-in from the owner's "GoBYE Auth Flow" design (owner: "Everything in design + the new onboarding").**
  - **Welcome (`onboarding.tsx`):** always dark. The website's 3D road scene was rendered frame by frame, blended into a seamless 12 s loop (250 KB mp4 plus poster) and plays muted with `expo-video`; the poster shows under Reduce Motion. Agreed-fare chip, "Your next move starts here.", then Create account and Sign in. On short screens the road shrinks and the chip hides. Signed-out riders, log out and delete account all land here.
  - **Create account:** full name, email, phone and password (show/hide), then verify the phone. Apple and Google sit below the form, with a terms line and a simulated-services note.
  - **Sign in:** Apple and Google first, then email or phone with password, then a phone code. "Forgot password?" leads to **Reset password**: email → 6 digit code + new password, with a resend countdown.
  - **Your phone number:** for a new Apple or Google account. **Verify your number:** icon tile, six boxes and resend countdown.
  - **Shared pieces:** `features/auth/AuthKit.tsx` (top bar, heading, password field, social buttons, "or" divider, text link). `TextField` gains `trailing`. Icons added: apple, google, eye, eyeClose.
  - **Core:** `validatePassword`, `validateFullName`, `parseIdentifier`; the mock auth gains signUp, signIn, socialSignIn, requestPasswordReset and resetPassword, with optional `authStore` persistence (the rider app saves simulated accounts to AsyncStorage). 8 new core tests and 4 screen tests.
  - **Checked:** web QA at 390 px (light and dark) and 320×568 for every screen and error state; typecheck passes; tests core 133, rider 33, driver 2; rider iOS + Android export with the video bundled. Note: Playwright's Chromium has no H.264, so the web check showed the poster frame; the loop itself was checked frame by frame and its seam matches a normal frame step. Not tested on a device.
  - **Decision:** D-045 (supersedes D-008 for riders). The driver app keeps phone + code.
- **Buttons refined across both apps (owner: "the buttons are not premium").**
  - **Shared `Button`:** now a pill, 56 pt tall at `lg`, with tighter letter spacing.
    - Primary: solid ink with a soft, low shadow in light mode that tightens when pressed.
    - Secondary: neutral fill with a hairline edge.
    - Press: a short spring to 97 % plus the pressed colour; under Reduce Motion, colour only.
  - **New options:**
    - `trailingIcon`: a contrasting round chip at the end, like the website's hero CTA, with the title kept centred.
    - `appearance`: forces the light or dark palette; the always-dark welcome uses it, so its buttons match the rest of the app.
  - **Where the arrow chip appears:** Create account (welcome and form), Sign in, Send code (phone and reset), and driver Get started.
  - **Checked:** web QA in light, dark and pressed. Typecheck and all tests pass, and the rider and driver iOS + Android exports build.
- **Rider: "Pay later" removed (owner).** Trip-complete shows only the payment actions. "Check later" appears only while a payment already sent awaits confirmation (D-046). Android back on an unpaid trip shows "Pay for this trip to finish it." The test was updated.
- **Fix attempt for "TypeError: Cannot read property 'split' of null" (owner's Expo Go log, no stack trace).** `formatPhone` is now null-safe: Account masks the number with `.split`, and a profile restored from older stored data can have no number. The welcome video now lives in its own component behind an error boundary, so a player failure leaves the still poster instead of crashing the welcome. Waiting on the owner's stack trace if it recurs.
- **Rider: receipt redesigned as a branded ticket (owner: "capture our branding and premium").**
  - **In app (R15 Receipt / R18 Ride details):**
    - Header: aubergine `brandBanner` band with the inverse mark, GoBye and "TRIP RECEIPT", plus the long date.
    - Amount: large total with "Total paid" only when confirmed, a payment status badge and a method pill.
    - Body: perforated tear lines with edge notches; a journey timeline (ink pickup, tangerine drop-off, with times); a Distance / Duration / Service strip; driver with rating, car and plate.
    - Fare breakdown: fee shown as separate from the fare, then the total, and the "GoBye takes no commission" note.
    - Footer: copyable reference `GB-XXXXXXXX`, and the rider's stars if rated.
    - Actions: Share receipt (primary), Rate trip, Get help.
  - **PDF (Share receipt):** same design in HTML for expo-print: embedded 96 px mark (offline-safe), Inter with a system fallback, colours kept in print. The share title includes the reference.
  - **Shared rules:** `receiptReference()` in core with a test; payment labels come from `PAYMENT_METHOD_LABELS`.
  - **Checked:** web QA in light and dark at 390 px and 320 px; a sample PDF rendered for review. Typecheck passes, all tests pass (core 134), and the rider iOS + Android export builds.
- **Rider: Create account rebuilt as the website's "Join the waitlist" journey (owner: "adopt the waitlist… down to the button and all").**
  - **Header:** a plum hero (website `.sheet-hero` gradient with warm and violet glows) holding the eyebrow "JOIN GOBYE", "Create your account", a close button and the route progress: a tangerine fill, four stops (You · City · Contact · Secure) and a car chip that drives to the current step.
  - **Steps:**
    - Name, with Apple and Google underneath.
    - City tiles (Lagos, Abuja, Another city → a sheet of the other 35 states). Tiles move on by themselves.
    - Email and phone.
    - Password with a strength meter.
  - Steps slide on a track and the viewport height follows each step. Fields are 60 pt, rounded 18, with a plum focus ring and icon; a round 56 pt back button sits beside the CTA.
  - **End:** after phone verification comes a new rider pass (`auth/pass`): plum top with the mark and "RIDER PASS", then name, city and member since, a perforation and "Phone verified". It rises in with a slight tilt, then "Start riding".
  - **Buttons:** new shared `Button` variant `brand`, the website's tangerine CTA (#FFB27E→#FF9652→#FF8438, dark ink label, white arrow chip, warm glow). It's used on every auth step: welcome Create account, Continue, Create account, Sign in, Send code, Verify, Save new password, Start riding.
  - **Core:** `OTHER_NIGERIAN_STATES` (same list as the website) and `passwordStrength`, with tests. The session remembers `homeCity`.
  - **Checked:** web QA in light and dark through the whole journey (Oyo via the state sheet) to the pass. Typecheck passes; tests core 136, rider 33, driver 2; the rider iOS + Android export builds.
  - **Brand note:** this journey uses gradients and tangerine CTAs at the owner's request, an exception to the app's monochrome rule (D-047).
- **Rider: sign up, sign in and reset password never scroll (owner: "everything should be a focus point").**
  - **New shared `JourneyFlow`:** the plum hero with route progress, then one step at a time on a sliding track that fills the space between hero and actions, then the round back button and tangerine CTA, with a one-line preview note under it. The hero compacts on phones under 740 pt tall. Each step is pinned to one viewport width. On the web QA build, the viewport also refuses the browser's focus-scroll, which had shifted the last step.
  - **Create account:** the same 4 steps, now on JourneyFlow without a scroll view.
  - **Sign in (2 steps):** "Good to see you again" (email or phone, Apple / Google, "New to GoBye? Create account") → "Enter your password" ("Signing in as …", Forgot password?).
  - **Reset password (3 steps):** Which account? (email) → Check your email (code boxes with resend countdown; moves on after 6 digits) → Choose a new password (strength bars). A wrong code returns to the code step.
  - **Checked:** every step on 390×844 and 375×667 with nothing cut off and no scrolling; tests updated (rider 33); typecheck passes; the rider iOS + Android export builds.
- **Buttons: arrow chip removed everywhere (owner).** The welcome, sign-in / sign-up / reset / verify CTAs, Start riding and driver Get started no longer show the arrow. The `trailingIcon` option stays in `Button` but is unused.
- **Rider: Apple and Google made prominent again; fare chip removed from the welcome (owner).** The welcome adds "or continue with" Apple and Google (solid logos via the new `Button` option `leadingIconFilled`). The first step of Create account and Sign in now leads with full-width Continue with Apple / Google, then "or", then the field. Those steps no longer open the keyboard, so nothing hides the buttons. The "Agreed fare ₦7,200" chip is gone. Checked at 390×844 and 375×667.

## 2026-10-22 — Auth: typing stays visible, lean copy, two-button welcome

- **Typing visibility (Journey):** while the keyboard is up the plum hero collapses to a slim bar (title, step count, thin progress), Apple/Google and secondary links hide, steps sit in a ScrollView inside a KeyboardAvoidingView, so the field being typed in stays above the keyboard. Verified on web only for layout; keyboard behaviour needs device testing.
- **Welcome:** Apple/Google removed (owner request); only Create account and Sign in. The road is a fixed band (0.62 × width, capped at 34% of height) with equal flexible space above and below; body copy shortened.
- **Copy:** removed eyebrows and repeated hints across sign up, sign in, reset, phone and OTP; one short question per step ("What’s your name?", "Where will you ride?", "How do we reach you?", "Set a password"; sign in shows the account on step 2; reset "Which email?" → "Enter the code" → "New password"). Preview note shortened to "Preview · simulated".
- Checks: `npm run typecheck`, `npm test` (rider 33, core 136, all pass), rider `npx expo export --platform android --platform ios` OK.

## 2026-10-22 — Sign up: state search, better password step

- **Another city → state search:** the state sheet has a pinned "Search state or city" field (new `Sheet` `top` slot in `@gobye/ui`). `searchStates` (core) matches state names (starts-with first, then contains) and capitals/big cities, so "Ibadan" finds Oyo and "Port Harcourt" finds Rivers; the city shows under the state. Clear button, empty state, Return picks a single match, the list keeps a steady height.
- **Password step (sign up and reset):** new `PasswordRules` card: animated three-part strength bar with its word (Too weak / Good / Strong) and the rule as three live ticks (8+ characters, A letter, A number) from core `passwordChecks`.
- Tests: core +2 (`searchStates`, `passwordChecks`), rider +1 (state search) and the password checklist asserted in the create-account test. `npm run typecheck`, `npm test` (core 138, rider 34) and the rider iOS/Android export pass. Checked on web at 390×844, light and dark.

## 2026-10-22 — Welcome follows Light / Dark

- The welcome (R02) no longer forces dark: it uses the theme tokens, so it follows Account → Appearance / the system setting. Buttons, brand mark and status bar follow the scheme.
- New light clip `assets/video/road-light.mp4` (244 KB, 12 s seamless loop, H.264) + `road-light-poster.jpg`, rendered from the website's 3D footer in its light look on white, the same way as the dark clip. The player is keyed by scheme so switching appearance swaps the clip.
- Checks: typecheck, `npm test` (rider 34), rider iOS/Android export pass; web screenshots at 375×667 and 390×844 in light and dark.

## 2026-10-22 — Driver app brought up to the rider app (D-048)

- **Shared:** the journey and auth kit moved from `apps/rider/src/features/auth` to `@gobye/ui` (`components/shared/auth/Journey.tsx`, `AuthKit.tsx`); `RiderPass` is now `MemberPass` (tag and place label), with `RiderPass` kept as an alias. Rider imports updated; behaviour unchanged.
- **Driver welcome:** the road video (Light / Dark clips, poster under Reduce Motion), "Drive more. Keep it all.", Create account and Sign in. Signed-out drivers always land here. `expo-video` added to the driver app (package + config plugin).
- **Driver accounts:** Become a driver (You → City [Lagos / Abuja] → Contact → Secure with live password rules, Apple / Google on step 1), Sign in (account → password, Forgot password), Reset password (email → code → new password), phone step for a new Apple / Google account, the code screen, then a driver pass ("Start registration"), which saves name, email and city as About you. Session gained signUp / signIn / socialSignIn / reset / profile; simulated accounts persist on the device. Log out now returns to the welcome.
- **Trip detail:** a branded earnings statement (`features/trip/TripStatement.tsx`), completed and cancelled variants, copyable reference, Get help.
- **Checks:** typecheck; `npm test` core 138, rider 34, driver 8; rider and driver iOS/Android exports; driver web walk-through at 390×844. Not device-tested.
- **Next:** device testing of both apps (Expo Go / development build), then backend contracts when the owner is ready.

## 2026-10-22 — Connected demo and the driver verification card (D-049)

- **Driver dashboard before approval:** every signed-in driver reaches the tabs. The Drive tab shows a verification card (Register → Review → Drive; steps still to do; items staff flagged, with the fix and a Fix button; checks waiting on an outside office with the reason and since when; the next action). Go online stays locked until approved. Registration handles `changes_requested` (fix → send back for review). Without a relay the review is simulated on the phone (checks run, the FRSC licence check waits, then approval).
- **Core:** `driver/verification.ts` (checks, waiting reasons, issue catalogue, `simulatedReview`, `requestChanges`, `resolveIssuesForStep`, `resubmitApplication`, `verificationSummary`); new status `changes_requested`; `relay/` (types, PostgREST-style client and in-memory relay, rider relay matching / trips, driver helpers, connection status). UI: `ConnectionPill`.
- **Demo relay:** `npm run demo:relay` (`tools/demo-relay/server.mjs`, writes each app's `.env.local`); optional Supabase SQL `supabase/migrations/20261022_demo_relay.sql` (test data only; drop after).
- **Rider:** relay-backed matching and trip tracking when configured, people row, ride sync (PIN, chosen driver, payment, cancel), ends a ride cancelled by the driver or staff with a message, connection pill.
- **Driver:** people and application sync, staff decisions merged back, real requests from riders (claim, accept or counter), trip sync (PIN from the rider, position, stages, payment), connection pill.
- **Admin:** Connected demo workspace (Overview with counts and activity, Driver applications review with checks / request changes / approve / reject, Rides with timeline and cancel, People).
- **Checks:** typecheck all; tests core 149, rider 36, driver 14, admin pass; rider and driver native exports; admin build; a three-app walk against one local relay passed end to end (see TEST_PLAN). Not tried on phones yet.
- **Next:** try it on two phones and a laptop on the same Wi-Fi (docs/DEMO_CONNECTED.md).

## 2026-10-22 — Gradients removed from the mobile apps (D-050)

- `Button` brand variant: solid tangerine, dark label, no gradient / highlight / glow. `PlumBackground` (auth and journey headers, member pass top): solid aubergine. Route progress: solid tangerine fill. Rider in-trip panel: solid sheet with rounded top and hairline edge (no fade). No `LinearGradient` / `RadialGradient` left in the rider app, driver app or `@gobye/ui`.
- Checks: typecheck; tests core 149, rider 36, driver 14, admin pass; rider and driver iOS/Android exports; web screenshots of the welcome and auth screens.

## 2026-10-22 — Website home page shortened with sideways sliders

- Owner: the home page was too long to scroll. Additional features and Safety are now sideways sliders (swipe, mouse drag, arrow keys, previous / next buttons and a progress line; the row bleeds to the screen edge so the next tile peeks in). On phones the photo mosaic ("Built for the way your city moves") and the comparison cards also become sliders. On laptops the three safety cards still fit in one row. Section spacing 120 → 96 px.
- Page height: phone 11,646 → 8,645 px (−26%); desktop 9,070 → 8,562 px. Checked in Chromium at 1440×900 and 390×844, the For riders / For drivers switch (sliders reset to the first tile), keyboard and drag. No console errors.
- Same sliders on the "For drivers" view of the page (Built for the way you drive, Your car / your hours, Keep more of every fare, Safer trips). Phone height with drivers selected: 8,535 px. Site files now load with a version (`?v=2026102202`) so browsers fetch the new styles and script instead of a cached copy. Redeploy the site (Vercel) for visitors to see it.

## 2026-10-23 — Infrastructure foundation (D-051, D-052)

- **Brief:** production infrastructure, security, Cloudflare and network architecture, provider-independent; nothing deployed without approval.
- **Audit:** `docs/INFRASTRUCTURE_AUDIT.md` (no secrets in git history; no CI; no CSP before; demo relay is LAN/unauthenticated by design; credentials shared in chat must be rotated).
- **Core:** `packages/core/src/infra` (public config + secret detection, API client with request ids / timeouts / idempotency / safe retries, error model, health contracts, logging with redaction, metrics, provisional alerts, realtime client), `src/files` (file classes, magic-byte validation, quarantine → scan → approve, fail-closed scanner, single-use completion, private access, video interface), `src/traffic` (origins, policies, hysteresis, failover, privileged audited changes, simulated control plane).
- **Edge:** new workspace `infra/cloudflare` — API gateway Worker, R2 upload signer and public media gateway Workers, SigV4 presigner (matches the AWS example vector), R2 bucket / CORS / lifecycle definitions, DNS and load-balancer proposals (templates only).
- **Web:** CSP, HSTS, framing and permissions headers for the website (`apps/web/vercel.json`) and admin (`apps/admin/vercel.json`); `tools/check-env.mjs` (`npm run check:env`).
- **Admin:** "Traffic and origins" page — simulation with reason, MFA step, second approver, audit and rollback.
- **Docs:** 19 infrastructure documents plus `INFRASTRUCTURE_REPORT.md`; updates to README, CLAUDE, AGENTS, ARCHITECTURE, API_CONTRACTS, SECURITY_PRIVACY, IMPLEMENTATION_PLAN, DECISIONS (D-051, D-052), OPEN_QUESTIONS (Q-064 to Q-072), TEST_PLAN, BACKEND_HANDOVER.
- **Checks:** `npm run typecheck` 0 errors; `npm test` core 215, rider 36, driver 14, admin 250, infra/cloudflare 41 — all pass. Tested locally against fakes only; nothing deployed to staging or production.
- **Next:** rotate the shared credentials; add CI; wire `publicConfig` + `assertMocksAllowed` into the apps; choose backend / database / auth (Q-064, Q-065).

## 2026-10-23 — Website: driver hero photo

- "For drivers" now shows the owner's photo (a driver in his car checking a trip request) in the hero instead of the rider phone video; riders keep the video. Optimised to `assets/hero-driver-{900,1600}.{webp,jpg}` (41–167 KB), responsive `srcset`, framed on the driver for the phone's portrait box, lighter vignette. The video pauses while the photo shows. Asset versions bumped to `?v=2026102301`. Checked in Chromium at 1440×900 and 390×844 (switching both ways, and the remembered choice after reload). Redeploy on Vercel to publish.

## 2026-10-23 — Cloudflare connection prepared (owner runs it)

- Owner chose a scoped API token and "full incl. DNS". This workspace can't reach api.cloudflare.com (free Claude plan, domain not allowable), so the token was never used from here. Added `tools/cloudflare-setup.mjs` (`npm run cloudflare:setup`): look-only by default, `--apply` creates the R2 buckets + CORS, deploys the gateway and public-media Workers on `api(-staging).gobye.app` / `media(-staging).gobye.app` custom domains with a random ORIGIN_AUTH_SECRET, backs up DNS first, never touches gobye.app/www, writes a secret-free report.
- Staging hostnames unified to one level (`*-staging.gobye.app`, Q-070 resolved). Wrangler configs now declare custom domains. Both Workers bundle with `wrangler deploy --dry-run` (wrangler 4.152.0). Nothing deployed yet.
- The setup token was pasted in chat: delete it in Cloudflare after setup.
- Owner hasn't added gobye.app to Cloudflare (site on Vercel's free plan). The setup script now still creates the R2 buckets and, with no zone, deploys the gateway and public-media Workers to free workers.dev preview addresses (`[env.preview]`, `gobye-api-gateway-preview.<sub>.workers.dev`, `gobye-media-gateway-preview.<sub>.workers.dev`), registering the account's workers.dev subdomain if needed. Both preview bundles build (`wrangler deploy --dry-run`). Custom domains follow once gobye.app is on Cloudflare.

## 2026-10-23 — Cloudflare: first real deployment (owner ran the script)

- Owner enabled R2 and ran `node tools/cloudflare-setup.mjs --apply`: 8 R2 buckets created (r2.dev off), CORS applied to uploads and public-media, `gobye.workers.dev` registered, API gateway and public-media Workers deployed to `gobye-api-gateway-preview.gobye.workers.dev` and `gobye-media-gateway-preview.gobye.workers.dev`, ORIGIN_AUTH_SECRET stored. The script's immediate check got a TLS handshake error (new workers.dev certificate still issuing); verification pending from the owner's browser (this workspace can't reach workers.dev).
- Script: removed Node's DEP0190 warning on Windows (one quoted command string). Pending: gobye.app on Cloudflare (custom domains), upload signer (R2 S3 key), delete the setup token afterwards.


## 2026-10-23 — Admin and staff dashboard redesign (D-053)

- **Brief:** the "Admin and Staff Dashboard Complete UI/UX Redesign" brief. UI only: routes, permissions, logic and data are kept.
- **Audit and plan:** `docs/ADMIN_DASHBOARD_REDESIGN.md` covers the inventory of 33 routes, role mapping, components, 13 issues and the checklist. Before and after screenshots are in `docs/qa-screenshots/admin/`.
- **Foundation:**
  - Jade, aubergine, tangerine and mint tokens in light and dark (D-053; contrast checked).
  - Aubergine sidebar regrouped into Home, Operations, People, Care and safety, Finance, Growth, Insights, Settings, Administration and Technical, with a collapsible 64px rail that is remembered.
  - Filled MingCute icon on the selected page.
  - Breadcrumb topbar; Ctrl/Cmd+K search over permitted pages and loaded records; notifications built from the real "needs action" counts; account menu holding theme and prototype tools.
  - Pill sub-navigation for Finance and Settings.
  - Kit upgrades: KPI cards, FilterBar, sortable and paged tables, drawer focus handling, tab arrow keys.
  - Every date and time in Africa/Lagos.
- **Fixes:**
  - The drivers badge counted 2 while the queue held 3.
  - Badges ignored the viewer's cities.
  - Phones scrolled sideways (24 to 71px).
  - Times followed the computer's time zone.
  - KPI rows left holes.
  - The focus ring was too faint.
- **Pages:** every workspace now uses the kit:
  - Home is a command centre.
  - Trips separates Quick Match from Negotiated.
  - Drivers has a sectioned review sheet.
  - Cases and Safety accept `?open=` links from search.
  - Approvals shows request cards under the two-person rule.
  - Audit has a timeline view.
  - Finance shows workflow steps and its rules.
  - Staff has a roles and permissions matrix.
  - Settings shows what is in force against the draft.
- **Checks:**
  - `npm run typecheck` 0 errors.
  - `npm test`: core 215, rider 36, driver 14, admin 263, infra 41, all pass. Admin build OK.
  - 256 captures (32 routes × 4 widths × 2 themes): no sideways scroll, no errors.
  - Not tested with a real screen reader or on devices.
- **Next:** owner review of the palette (Q-008) and of the dashboard on a laptop. Backend items for real search, staff alerts and sign in stay pending.

## 2026-10-23 — Payment configuration and Automation Centre (D-054, D-055)

- **Brief:** "Payment Configuration and Automation Architecture Update". The backend and provider are not chosen, so the work covers contracts, rules and honest test-data screens only.
- **Audit findings:**
  - Package prices were still marked provisional.
  - Fees were a single per-method placeholder.
  - No adapter contract and no automation registry.
  - **The ledger posted provider fees with reversed signs.** Fixed: costs are now debits and the provider clearing account is credited.
- **Pricing:** the owner confirmed the daily package (₦2,000 for 24 hours from successful activation), the monthly package (₦60,000 for 30 days) and 0% commission. Updated in code (`provisional: false`), the driver app copy, BR-062 and Q-043.
- **Core (`packages/core/src/gateway`, `src/automation`):**
  - Gateway adapter contract plus a simulated adapter.
  - Versioned fee schedules: "Not set" blocks charging; quote and disclosure; limits; exemptions; validation; owner approval; activation on date.
  - Separate money figures and a balanced breakdown journal, with a new `fee_income` account.
  - Guards: credit only after a matching lookup; no duplicate credit or payout; lookup before anything after an unknown outcome; safe provider switching that drains in-flight money on the old provider.
  - Automation registry of 13 server-side workflows.
  - Run model with failure classes, capped backoff, escalation and protected manual actions (successful runs never replayed).
  - Bounded automation settings with approval.
  - New permissions `fees.edit` and `automation.view` / `automation.configure` / `automation.retry`; approval kinds `fee_schedule`, `automation_config` and `gateway_switch`.
- **Admin:**
  - Payments group: providers, fee configuration, gateway health, payment operations.
  - Automation group: registry, scheduled jobs, execution history, failed jobs, settings, audit history.
  - Every screen is labelled test data, simulated or not connected.
- **Docs:** `PAYMENTS_AUTOMATION_ARCHITECTURE.md` (new), DECISIONS D-054 and D-055, BUSINESS_RULES BR-062 and BR-130 to BR-136, OPEN_QUESTIONS Q-043 (prices resolved), Q-073 (fee values), Q-074 (job runner), IMPLEMENTATION_PLAN row 15, SCREEN_INVENTORY, BACKEND_HANDOVER §17, management/07, TEST_PLAN.
- **Checks:**
  - Typecheck: 0 errors.
  - Tests: core 241, rider 36, driver 14, admin 326, infra 41, all pass.
  - The driver app export builds.
  - New pages checked at 4 widths in light and dark.
- **Next:** choose the provider (Q-042) and write its adapter; the owner sets fee values (Q-073); choose the backend and job runner (Q-064, Q-074).

## 2026-10-23 — Premium white admin redesign, 3D icons, subscriptions, staff workspaces, infrastructure costs (D-056, D-057)

- **Briefs:** "Premium Admin & Staff Dashboard Redesign" and "Mandatory White Background Design Rule". The white rule supersedes phase 1's aubergine sidebar and dark theme.
- **Audit:** 15 gaps found (`ADMIN_DASHBOARD_REDESIGN.md` §10.1).
- **Foundation:**
  - White-only tokens and elevation e0 to e4.
  - Raised inputs with a jade focus ring; button sizes and visible disabled states.
  - Labelled selects.
  - New top bar: breadcrumbs, centred search with recent searches and payments results, scope chip, help, account.
  - White sign-in screen with 3D art.
  - Dark theme removed.
- **3D icons:** 23 dimensional assets rendered in-repo with Blender's Python module (`tools/3d/render.py`, `DIMENSIONAL_ASSETS.md`, contact sheet in `docs/assets/3d/`), used only in featured cards, empty states and introductions.
- **Core:**
  - Negotiation history on Negotiate trips.
  - Infrastructure costs module, with permissions and the `expense` approval.
  - `costs.sync` automation (not connected).
  - Driver passes in the test data are now consistent with each driver's access.
- **Pages:**
  - Home is a command centre: platform activity, ride activity chart, attention, activity feed; no staff name, because sign in is simulated.
  - My work for each staff role.
  - Live operations with an honest schematic map.
  - Ride management tabs and negotiation timeline.
  - Drivers: tabbed profile and document review with honest file placeholders.
  - Riders.
  - Driver subscriptions.
  - Money overview.
  - Infrastructure & costs: dashboard, expenses, vendors, budgets, break-even (marketing excluded).
  - Automation overview and workflow cards.
  - Support and Safety.
  - White-rule pass on every other page.
- **Checks:**
  - Typecheck: 0 errors.
  - Tests: core 247, rider 36, driver 14, admin 403, infra 41, all pass.
  - 49 routes at 4 widths: no sideways scroll, no errors.
  - Not tested on devices or with a screen reader.
- **Next:**
  - Owner reviews the 3D icon family (`docs/assets/3d/contact-sheet.png`) and the white dashboard.
  - Decide pass stacking (Q-043).
  - Choose map, billing and backend providers.

## 2026-10-23 — Admin ready for its own Vercel project

- **Vercel settings:** `apps/admin/vercel.json` now declares:
  - framework (Vite);
  - an install command that installs only the admin workspace from the shared lock file;
  - the build command and output directory;
  - an ignore rule: build only when `apps/admin` or `packages/core` changes. The landing page stays a separate project.
- **Fonts:** Inter bundled as WOFF2 (about 115 KB per weight, OFL), so the build no longer reaches into the mobile apps' packages.
- **Light only:** the colour-scheme meta is `light`.
- **Checks:**
  - A clean clone ran the exact install command (229 packages, 9 s) and the build passed.
  - Served with the `vercel.json` headers: no CSP errors, fonts and 3D images load.
  - Not yet deployed on Vercel (owner step, `apps/admin/DEPLOY_VERCEL.md`).
- **Next:** the owner imports the repository as a second Vercel project with Root Directory `apps/admin` and turns on Deployment Protection. Connect the backend later via the `VITE_*` variables listed in `DEPLOY_VERCEL.md`.

## 2026-10-23 — One driver pass timeline for the Driver App and the admin (D-058)

- **Audit.** Pass validity was calculated in three places that disagreed:
  1. **Driver App:** a single stored pass, extended from the current expiry. Buying while active replaced it with a future-dated pass, so the driver lost access they had paid for and history was overwritten.
  2. **Admin subscriptions:** each pass ran from its own payment time, so passes overlapped and paid time disappeared.
  3. **Admin eligibility:** read a separately generated `driver.access`.
- **Fix.**
  - `packages/core/src/subscriptions` is now the only calculation. A pass starts at the later of payment confirmation and the end of the last scheduled pass. Daily is exactly 24 hours and monthly exactly 30 days. Confirmation, start, end and access end are stored separately.
  - Queued passes take over by themselves.
  - Writes are idempotent by payment reference (a duplicate webhook adds nothing), version-checked, and independent of arrival order.
  - Cancel, refund and reversal keep the pass in history, remove only unused access, and never extend access.
  - `SubscriptionTimelineResponse` is the one response for both apps (`GET /v1/drivers/{id}/subscription`).
- **Driver App.**
  - Stores the timeline and migrates an old stored pass once.
  - Access and "time left" come from the response.
  - The access screen lists active, queued, ended and refunded passes, and says when a new pass will start.
- **Admin.**
  - Subscriptions, drivers and the driver panel read the timeline. The list shows Confirmed, Starts and Ends separately.
  - New statuses: Queued, Cancelled, Refunded, Reversed.
  - The record panel shows the driver's full timeline, plus Cancel pass and Refund pass actions (finance approval rights, reason required, audited).
  - Test data now follows the stacking rule and includes one honest refund example (a duplicate purchase).
- **Bug found while testing:** a confirm dialog opened from a side panel sat under its own backdrop and could not be clicked. It now renders at the page root.
- **Prices unchanged:** ₦2,000 for 24 hours, ₦60,000 for 30 days, 0% commission.
- **Checks:**
  - Typecheck: 0 errors.
  - Tests: core 265 (18 timeline tests), rider 36, driver 14, admin 405, infra 41, all pass.
  - Driver `expo export` (android, ios) OK; admin build OK.
  - Refund flow clicked through in Chromium: no page errors.
  - Not tested on a device.
- **Next:**
  - Backend implements the timeline table and verification job per `BACKEND_HANDOVER.md`.
  - Finance decides pro-rata refunds and grace period (Q-043).

## 2026-10-23 — Admin Vercel build: first deploy failed, guard added

- **What happened:** the first Vercel build stopped at install with `Could not read package.json: /package.json`. The log shows 170 deployment files: only `apps/admin` was uploaded. "Include files outside the root directory in the Build Step" was off, so the shared `packages/core` and the root lock file were missing.
- **Change:**
  - The install command now checks that the whole repository is present. If it isn't, it stops with a plain instruction naming the Vercel setting to turn on.
  - `engines.node` pinned to `22.x`, which removes the auto-upgrade warning.
  - `DEPLOY_VERCEL.md` has a Troubleshooting section.
- **Checks:**
  - Simulated the admin-only upload: clear message, exit 1.
  - Simulated the full repository: install and build pass.
- **Owner step:** turn the setting on and redeploy.

## 2026-10-23 — Admin Vercel install command shortened

- **Problem:** Vercel rejected the guarded install command because commands are limited to 256 characters.
- **Fix:** the check and `npm ci` now live in `apps/admin/scripts/vercel-install.sh`. The `installCommand` is `sh scripts/vercel-install.sh` (28 characters).
- **Checks (both simulated again):**
  - Admin-only upload: clear message, exit 1.
  - Full repository: install and build pass.

## 2026-10-23 — Test owner account renamed

- **Change:** the test-data owner account in the admin is now **Emeka (Owner)** (id `stf-owner` unchanged), at the owner's request. Three admin tests were updated to match.
- **Checks:**
  - Typecheck: 0 errors.
  - Tests: core 265, admin 405, all pass.
  - Admin build: OK.

## 2026-10-23 — Test owner account renamed again

- **Change:** the owner account is now **Liquid (Owner)**, at the owner's request (id `stf-owner` unchanged).
- **Checks:** typecheck 0 errors; core 265 and admin 405 tests pass; admin build OK.

## 2026-10-23 — Admin on phones: nothing cut off

- **Problems found at 320 to 390px:**
  - The phone search button never showed: a later CSS rule overrode the one meant to show it.
  - The notification count covered the bell.
  - The top bar was so crowded that page titles were cut ("Driver subsc…").
  - Two-up metric cards squeezed their text into one word per line.
  - Side panel section headings overlapped their side note.
  - Tab rows cut off with no hint that they scroll.
  - Tables squashed their first column.
  - Two pages (Payment providers, Traffic) scrolled sideways at 320px.
  - The side menu used `100vh`, which hides its bottom behind the browser bar on real phones.
- **Fixes:**
  - Phone top bar: search shown; Help (keyboard shortcuts) hidden; compact city/date chip; badge on the bell's corner.
  - Featured cards one per row under 420px.
  - Headings wrap.
  - Fading edge on scrollable tab rows.
  - Tables keep a readable first column and show an edge shadow when they scroll.
  - Key-value rows stack under 380px.
  - Traffic cards use `min(320px, 100%)`.
  - Menu uses `100dvh`; side panel footer clears the phone's home indicator (`viewport-fit=cover`).
- **Checks:**
  - All 49 pages at 320, 360 and 390px, plus 7 pages at 768, 1024 and 1440px: no sideways scroll, no page errors.
  - Screenshots reviewed.
  - Typecheck: 0 errors. Admin tests: 405 pass.
  - Not checked on a physical phone.

## 2026-10-23 — Landing page waitlist: Safari patch removed

- **Problem:** on iPhone Safari, a grey box showing a blurred piece of the page covered the start of "First, what should we call you?" (owner screenshot). A faint strip from the next question also showed beside the name field in every browser.
- **Cause:** sliding questions inside a clipped area, inside the animated sheet. Safari sometimes leaves part of that area unpainted.
- **Fix:**
  - The slide area gets its own stable layer.
  - Questions not on screen are fully hidden once the slide ends.
  - The area repaints once after the sheet finishes rising and the fonts load.
- **Checks:**
  - Chromium with iPhone 13 emulation: waitlist steps 1 and 2 clean, no errors.
  - WebKit could not be installed here, so confirm on the iPhone after deploy.

## 2026-10-23 — Website says "Coming to Nigeria"

- **Change:** the landing page now says **Coming to Nigeria** instead of naming Lagos and Abuja:
  - hero line and meta description;
  - "Made for Nigeria" eyebrow;
  - fare statement;
  - footer ("COMING TO Nigeria");
  - trust section and banners.
- **Waitlist:** the city step still offers Lagos, Abuja and "Another city", so sign-ups say where people are. The tiles now read "Lagos State" and "FCT" instead of "Launching first".
- **Unchanged:** operating cities in the apps and admin (Lagos, Abuja). Photo descriptions of Lagos scenes were kept, as they describe the photos.
- **Checks:** iPhone-size render in Chromium; no Lagos/Abuja text left on the page; no errors.

## 2026-10-23 — Website rider hero is now a photo

- **Change:** the rider hero shows the owner's new photo (a woman with her phone outside an office, car behind) instead of the video.
  - Served as WebP with a JPEG fallback (900 and 1600 px, 36 to 139 KB) and preloaded.
  - Phones crop to 4:5 around her and her phone.
  - The driver hero is unchanged.
  - The video code was removed from the page; the video files are kept for `preview.html`.
- **Checks:** Chromium at iPhone size and 1440 px, for both riders and drivers. The only console errors were Google Fonts being unreachable from the build workspace.
