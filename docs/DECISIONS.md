# GoBye — Decision Record

Each decision has an ID, status (`Accepted`, `Proposed`, `Superseded`), date, alternatives and rationale. Append new decisions; never silently rewrite old ones — mark them `Superseded by D-xxx`.

| ID | Decision | Status | Date |
|---|---|---|---|
| D-001 | Expo SDK 57 (not 58) for the initial build | Accepted | 2026-10-21 |
| D-002 | npm-workspaces monorepo: `apps/rider`, `apps/driver`, `packages/core`, `packages/ui` | Accepted | 2026-10-21 |
| D-003 | Expo Router JS `Tabs` instead of `NativeTabs` | Accepted | 2026-10-21 |
| D-004 | `react-native-maps` behind a GoBye `MapCanvas` abstraction; production provider undecided | Accepted (provider open) | 2026-10-21 |
| D-005 | Domain logic as pure reducers/functions in `@gobye/core`; React context in apps | Accepted | 2026-10-21 |
| D-006 | All money in integer kobo (`Kobo` branded number) | Accepted | 2026-10-21 |
| D-007 | Pricing values live in one mock `PricingConfig`; none are business policy | Accepted | 2026-10-21 |
| D-008 | Phone number + OTP as the only sign-in method (mocked) | Proposed | 2026-10-21 |
| D-009 | Hand-written typed validators (no schema library) | Accepted | 2026-10-21 |
| D-010 | Custom non-modal map bottom sheet (Reanimated + Gesture Handler) | Accepted | 2026-10-21 |
| D-011 | Jest (`jest-expo`) for unit tests | Accepted | 2026-10-21 |
| D-012 | Rider: foreground location only. Driver: background location only while online | Accepted (driver part revised by D-026) | 2026-10-21 |
| D-013 | Expo Claude plugin enabled via committed `.claude/settings.json`; not installed in the cloud build session | Accepted | 2026-10-21 |
| D-014 | Inter via `@expo-google-fonts/inter` | Accepted | 2026-10-21 |
| D-015 | MingCute icons only through `<Icon>` in `@gobye/ui` | Accepted | 2026-10-21 |
| D-016 | Placeholder brand assets until approved files are supplied | Superseded by D-027 | 2026-10-21 |
| D-017 | Location pre-permission screen has a single "Continue" button; manual pickup offered on Home/Search | Accepted | 2026-10-21 |
| D-018 | "Cancel ride?" dialog uses "Keep ride" / "Cancel ride" (documented deviation from HIG "Cancel" label) | Accepted | 2026-10-21 |
| D-019 | No in-app cancellation once a trip is `in_progress` | Accepted | 2026-10-21 |
| D-020 | Finished flows reset the navigation stack (`resetTo`) | Accepted | 2026-10-21 |
| D-021 | Inter loaded per weight (4 weights) instead of the package root | Accepted | 2026-10-21 |
| D-022 | Keke category uses MingCute `car-2` as a placeholder icon | Accepted (temporary) | 2026-10-21 |
| D-023 | Launch payment methods: GoBye Wallet + bank transfer; cash open; no cards | Accepted (cash open) | 2026-10-21 |
| D-024 | 0% per-trip commission; drivers buy access packages (provisional prices); processing fees disclosed separately | Accepted (prices provisional) | 2026-10-21 |
| D-025 | Google Maps Platform (Maps SDK, Places API (New), Routes API) as proposed map provider | Proposed | 2026-10-21 |
| D-026 | Driver location session policy (When In Use first, never auto-request Always, activity-based updates, pause matching on loss) | Accepted | 2026-10-21 |
| D-027 | Working brand pack integrated as PREVIEW; palette comparison toggle; D-016 placeholders superseded | Accepted (preview) | 2026-10-21 |

---

## D-001 — Expo SDK 57

**Context.** Expo SDK 58 (React Native 0.88) was released on 2026-10-15. The SDK 58 changelog states Expo Go for SDK 58 "will be released within a few weeks" and `create-expo-app` still creates SDK 57 projects until then. The product owner works on Windows, so iOS testing without a Mac depends on Expo Go or EAS cloud builds.

**Alternatives.** SDK 58 now (development builds only); SDK 57 now and upgrade later.

**Decision.** Use SDK 57 (`expo ~57.0.30`, React Native 0.86.3, React 19.2.3). Upgrade to SDK 58 once Expo Go 58 is in the stores, using the `expo-upgrade` skill / `npx expo install expo@^58 --fix`.

**Consequences.** Both SDKs require Xcode 26.4+ for builds, satisfying Apple's April 2026 Xcode 26 upload requirement (EAS Build provides this). Native tabs are imported from `expo-router/unstable-native-tabs` on SDK 57 (not used — see D-003).

## D-002 — Monorepo

**Decision.** npm workspaces. `packages/core` (pure TypeScript) and `packages/ui` (React Native design system) are shared; each app keeps its own `app.json`, bundle identifier, permissions, navigation and store configuration.

**Rationale.** Expo's monorepo guide (SDK 52+) configures Metro automatically. Two separately distributable apps with genuinely shared tokens, icons, types and rules. npm avoids adding another package manager for a Windows user.

**Risk.** A single React / React Native version must be used across the repo (Expo monorepo guide). Both apps pin the same versions.

## D-003 — JS tabs

**Context.** `NativeTabs` icons accept SF Symbols (`sf`), Material Symbols (`md`) or images, not React components. MingCute is the mandated icon set and ships as `react-native-svg` components.

**Decision.** Use `Tabs` from `expo-router` with a GoBye tab bar that renders MingCute Regular (inactive) / Filled (active) icons.

**Revisit** if MingCute icons are exported to image assets for native tabs (iOS 26 Liquid Glass tab bar).

## D-004 — Maps

**Decision.** `react-native-maps` (bundled with Expo Go) wrapped in `MapCanvas` (apps) and fed by a `MapService` interface (`@gobye/core`). Development uses the platform default provider (Apple Maps on iOS, Google Maps on Android) with mocked geocoding/routing over Lagos.

**Alternatives.** `expo-maps` (Apple Maps on iOS only, requires iOS 17, not in Expo Go); Mapbox (`@rnmapbox/maps`, development build required).

**Open.** Production provider, geocoding/places and routing provider — see `OPEN_QUESTIONS.md` Q-007.

## D-005 — State management

**Decision.** Booking, negotiation and trip state transitions are pure functions in `@gobye/core` (`bookingReducer`, `negotiation` helpers) with exhaustive unit tests. Apps hold state in React context + `useReducer` and persist the active booking with AsyncStorage for state recovery.

**Rationale.** Predictable, testable without a device; no extra state library.

## D-006 — Money

All amounts are integers in kobo (₦1 = 100 kobo). Formatting is centralised in `formatNaira()`. Floating-point naira values never cross a service boundary.

## D-007 — Pricing configuration

Base fares, per-km/per-minute rates, minimum fares, negotiation range, offer expiry, rounding step and commission rate are mock values in `MOCK_PRICING_CONFIG`. They are labelled as placeholders in the UI copy where shown and in `BUSINESS_RULES.md`. The backend will become the pricing authority.

## D-008 — Authentication method

Phone number + one-time code (mocked: any 6-digit code except `000000`). Because no third-party/social login is used, App Review Guideline 4.8 does not require an additional login service. If Google/Facebook login is added later, an equivalent option (e.g. Sign in with Apple) must be added. Status `Proposed` until the product owner confirms.

## D-009 — Validation

Small typed validators (`validateNigerianPhone`, `validateOtp`, `validateOffer`, `validateName`) in `@gobye/core/validation`, each returning `{ ok: true, value } | { ok: false, error }`. Avoids a dependency for a small number of forms.

## D-010 — Bottom sheet

**Decision.** A GoBye `MapSheet` built with `react-native-reanimated` + `react-native-gesture-handler` (both already in the template) with snap points, a grabber, an accessible expand/collapse action and Reduce Motion support. The map stays interactive above the sheet.

**Alternatives.** Expo Router `formSheet` (Android form sheets don't render headers, max 3 detents, and dims/blocks the map by default); `@gorhom/bottom-sheet` (extra dependency).

## D-011 — Testing

Jest with the `jest-expo` preset; `@testing-library/react-native` for component tests. Pure logic in `@gobye/core` is the primary unit-test target.

## D-012 — Location permissions

- **Rider:** "When In Use" only, requested when the user engages pickup (pre-permission screen with a single "Continue" button per HIG). Manual address entry always available. No background location.
- **Driver** (**Revised by D-026**, 2026-10-21 — D-026 governs where they differ, notably Android background permission)**:** foreground first. **iOS:** When In Use + `UIBackgroundModes: location` + background updates only while online is sufficient for continuous tracking (Apple: Handling location updates in the background); "Always" only adds relaunch after termination and is not requested unless Q-0xx decides otherwise. **Android:** `ACCESS_BACKGROUND_LOCATION` requested separately, only when the driver goes online for the first time, behind an explanation screen. Android foreground service of type `location` with a persistent "You're online" notification. Requires a development build (background location is not supported in Expo Go).

## D-013 — Expo skills

The official plugin (`expo@claude-plugins-official`) was **not installed** in the cloud session that produced the first build (marketplace not configured there; installing requires the owner's permission). The template's `.claude/settings.json` enables the plugin, so a local Claude Code session will prompt to install it. Official documentation was used directly instead. See `RESEARCH_SOURCES.md`.

## D-014 — Typography

Inter (400/500/600/700) from `@expo-google-fonts/inter`, loaded before the splash screen hides. Sizes follow Apple's Dynamic Type defaults (Body 17) and scale with system font size (`allowFontScaling` stays on; `maxFontSizeMultiplier` limited only on fixed-size controls such as tab labels).

## D-015 — Icons

`@mingcute/react-native@3.0.2` (Apache-2.0). Screens import `<Icon name="…" />` from `@gobye/ui`, never MingCute directly. The wrapper maps semantic names (`home`, `pickup`, `destination`…) to verified component names and uses per-icon deep imports.

## D-016 — Brand assets

The brand board referenced in the master prompt was not present in the project folder. Logo, app icons and splash use placeholder assets (wordmark set in Inter, brand colours) marked `PREVIEW — NOT APPROVED` in `ASSET_INVENTORY.md`. No logo geometry has been invented.

## D-017 — Single-button pre-permission screen

Apple HIG (Privacy) allows a pre-permission screen to have only one button titled "Continue"/"Next" and no Cancel/Close. The rider location primer therefore has one "Continue" button that triggers the system prompt. Whatever the outcome, the user lands on Home, where a denied/restricted state offers "Enter pickup manually" and "Open Settings".

## D-018 — Cancel-ride dialog labels

HIG asks that the dismiss button of an alert be titled "Cancel". Next to a destructive "Cancel ride" action this is ambiguous for a ride-hailing app, so GoBye uses **"Keep ride"** (dismiss) and **"Cancel ride"** (destructive style), with the fee notice in the message. Recorded as a deliberate, user-clarity deviation; revisit after usability testing.

## D-019 — No cancellation in progress

Once the passenger is on board (`in_progress`), the in-app Cancel action is removed. Safety tools and Support remain available. Resolves the conflict noted as Q-033.

## D-020 — Stack resets after finished flows

After sign-in, booking submission, cancellation and payment, the app calls `resetTo(href)` (`dismissAll()` + `replace`) so Android back and iOS swipe cannot return to completed steps. An independent review found several stack bugs (stale Options screen popping Rate, back from Home returning to sign-in); this rule fixes the class of problem. Live bookings remain reachable from a Home banner and the Activity tab.

## D-021 — Per-weight font imports

Importing from `@expo-google-fonts/inter` root bundled all 18 Inter files (~6 MB). Importing `@expo-google-fonts/inter/400Regular` etc. bundles only the four weights used.

## D-022 — Keke icon

MingCute's public Core set has no tricycle/auto-rickshaw icon. `car-2` is used for GoBye Keke until a vehicle illustration is supplied (`ASSET_INVENTORY.md`). No other icon library is mixed in.

## D-023 — Launch payment methods

**Context.** Q-001. Product owner, 2026-10-21: "Our current scope includes GoBye wallet and bank transfer. Cash hasn't been agreed. Proposed launch scope is digital payments first; treat cash as an open decision."

**Decision.** Launch methods are **GoBye Wallet** and **bank transfer**. **Cards are not in scope** (removed from `PaymentMethodType` and the UI). **Cash** remains in the type for a future decision but is **disabled** in `MOCK_PAYMENTS_CONFIG.enabledMethods`; Q-001 stays open for cash only.

**Consequences.** Wallet trips are charged automatically at trip end; the wallet must cover fare + passenger-borne processing fee before booking (BR-106). Bank-transfer trips end in an "awaiting your transfer" state with virtual-account details and a passenger confirmation step (BR-107). Wallet top-ups are by bank transfer (simulated). Real provider, virtual-account mechanism and fees → Q-042. No Apple In-App Purchase (physical service). Wallet regulatory status still Q-032.

## D-024 — 0% commission, driver access packages, separate processing fees

**Context.** Q-002. Product owner, 2026-10-21: "0% per trip. Drivers pay for access through configurable packages. ₦2,000 daily and ₦60,000 monthly remain provisional. Any payment-processing charges must be disclosed separately."

**Decision.**
- `MOCK_PRICING_CONFIG.commissionRate = 0`; `driverEarnings` returns the full fare.
- Drivers need an active **access package** to go online (BR-072). Configurable packages in `DRIVER_ACCESS_PACKAGES`: Daily ₦2,000 / 1 day, Monthly ₦60,000 / 30 days, both flagged `provisional: true`. Buying while active extends from the current expiry.
- Payment-processing charges are modelled per method (`ProcessingFeeRule`: fixed, percent, optional cap, bearer) and always shown as a **separate line** from the fare, before booking and on receipts (BR-105). Current values are placeholders (bank transfer ₦50 passenger-borne; wallet ₦0 platform-borne).

**Supersedes** the 15% mock commission assumption under D-007 (D-007 itself — "values live in mock config" — still applies). Billing details → Q-043.

## D-025 — Google Maps Platform (Proposed)

**Context.** Q-007. Product owner, 2026-10-21: "Not selected yet. Proposed starting provider is Google Maps Platform, with place search and Routes API for distance and journey estimates. Validate pickup accuracy in Abuja/Lagos and projected usage costs before committing."

**Proposal.** Google Maps Platform as the starting provider:
- Map rendering: Maps SDK (iOS/Android) via `react-native-maps` with `PROVIDER_GOOGLE` (iOS requires a development build and the Google Maps iOS key; verify).
- Place search: Places API (New) autocomplete with session tokens + Place Details with field masks.
- Distance / ETA: Routes API `computeRoutes` with traffic-aware routing (the Routes API supports routes, distance, ETA and traffic options — https://developers.google.com/maps/documentation/routes/overview).
- **Recommendation:** Places/Routes requests go through the GoBye backend (keys not shipped in the app); the in-app Maps SDK key is restricted per platform (iOS bundle ID / Android package + SHA-1) and per API.

**Status.** **Proposed — not accepted.** Accept only after pickup-accuracy validation in Abuja and Lagos on real devices and a cost projection (Q-044). Supersedes nothing; **D-004 remains** the abstraction (`MapCanvas` / `MapService`) so the provider can be swapped.

## D-026 — Driver location session policy

**Context.** Q-012. Product owner rules, 2026-10-21 (see OPEN_QUESTIONS Q-012 for the verbatim list). Apple: background updates continue for a When In Use app when `allowsBackgroundLocationUpdates` is set and updates were started in the foreground (https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates).

**Decision.**
- A location session starts **only when the driver explicitly goes online**, and only with foreground permission, **precise** location and an active access package (D-024).
- Updates continue in the background while **available**, **approaching pickup** or **on trip**; operational tracking stops when **offline with no active trip**. Going offline is blocked during an active trip.
- **iOS:** request **When In Use** first; `UIBackgroundModes: location` + `allowsBackgroundLocationUpdates`, started in the foreground (blue location indicator shown). **"Always" is never requested automatically.**
- **Android:** foreground-only permission (`ACCESS_FINE_LOCATION`) + a foreground service of type `location` started while the app is visible, with a persistent "You're online" notification. `ACCESS_BACKGROUND_LOCATION` is requested **only if device testing shows it is required** for the chosen implementation, separately and behind an explanation (verify in the dev build).
- Update frequency adapts to activity (`UPDATE_PROFILES`, placeholders); stale or low-accuracy positions are flagged.
- If permission or updates are lost (revoked, approximate only, interrupted, stale, low accuracy), **new matching pauses** and the driver is told why (`trackingIssueMessage`); an active trip continues.
- Locked-screen, background and interrupted-session behaviour must be tested on real devices (`DEVICE_TEST_MATRIX.md`).

**Implementation.** `packages/core/src/driver/locationSession.ts` (pure reducer + `canReceiveRequests`, unit-tested). Driver app UI and native wiring (expo-location / TaskManager) not yet built. Interval tuning → Q-045. **Revises** D-012 (driver bullet).

## D-027 — Working brand pack as preview assets

**Context.** `Go-Bye_Working_Brand_Assets.zip` (received 2026-10-21) contains concept boards, a logo breakdown, applications, a green exploration, four transparent 3D-style renders, a GIF motion study and a rider UI concept. Its README states none of it is final: no vector logo master, palette undecided, font proposed but not approved.

**Decision.**
- The preferred mark (curved G + destination dot) is extracted as a raster (white → transparent) from the logo concept board, plus a light variant for dark backgrounds (`packages/ui/assets/brand/mark*.png`). No geometry was redrawn or invented.
- It replaces the text-only placeholder in `Wordmark` and the generated "Go"/"GoD" app icons and splash (Rider: mark on white; Driver: light mark on Aubergine; dark splash on #14101A).
- The 3D renders are resized to 512 px WebP (~25 KB each) and used as decorative illustrations (onboarding, location primer, rewards, wallet, empty Activity).
- Token hex values stay as documented in the brief; colours sampled from boards are recorded as reference only (Q-047).
- A preview-only Settings switch compares the **Jade** and **Aubergine & Tangerine** directions (`BrandDirectionProvider`, `paletteFor`). Success states stay Jade in both.
- Inter stays until Q-048 is decided; "GoBye" naming stays until Q-046.

**Consequences.** All brand rows in `ASSET_INVENTORY.md` remain PREVIEW. Before release, replace with approved vector exports and re-run icon small-size and contrast checks. D-016 is superseded by this decision.

## D-028 — In-app appearance setting (Light / Dark / System)

**Context.** The 2026-10-21 testing brief (§1) asks for Light and Dark modes with a remembered Light / Dark / System choice. The earlier build followed the system only (HIG default).
**Decision.** Account → Appearance offers Light, Dark and System (default). The choice is saved with the account settings and applied app-wide with React Native's `Appearance.setColorScheme` (`applyAppearance` in `@gobye/ui`); deleting the account resets it to System. Light pages, cards and sheets are pure white (#FFFFFF) with neutral fills, hairline borders and soft shadows. Maps follow the appearance (Apple Maps `userInterfaceStyle`; Google Maps dark style on Android).
**Consequences.** Supersedes the "no in-app light/dark switch" note in CLAUDE.md. Needs a device check that the override persists across relaunch on both platforms.

## D-029 — Vehicle categories come from admin config; one car category at launch

**Decision.** `ServiceConfig.categories` (mock: `MOCK_SERVICE_CONFIG`) decides which categories exist, their names, seats and image. Launch: only **GoBye Car** is enabled; Comfort, XL and Keke exist but are disabled, so Keke no longer appears anywhere. Screens show names via `useCategoryName()`. Options shows the category as a card with a car render; the matched driver's *actual* colour, make/model and plate are shown from the trip data (`VehicleSummary`).

## D-030 — Payment happens after the trip, as its own stage

**Decision.**
- The pricing screen no longer asks for a payment method or checks the wallet. It states the fare is fixed (Quick Match) or agreed (Negotiate) and that payment is chosen after the trip.
- `TRIP_COMPLETED` → `payment_pending` with `awaitingPaymentAction` for every method. The passenger opens **Confirm payment** (method in a sheet, available balance, "Pay to" driver, naira amount, breakdown, route) and confirms. `PAYMENT_STARTED` blocks duplicate taps; only a confirmed result sets `paid`.
- Bank transfer goes to the driver's account (copyable details). "I've sent the transfer" only starts a check. A transfer not seen yet is **pending** (`paymentNotice: 'transfer_not_received'`), not failed.
- Transfers carry no GoBye fee (they go straight to the driver; 0% commission, D-024). The fee line stays in the UI only when a fee is above zero.
- Trip completion (`/trip-complete`) is separate from payment: rating and receipt are available either way; "Paid" shows only when confirmed. An unpaid trip can be left for later ("Pay later"), stays on Home as "Payment outstanding", and blocks a new booking until it is paid (Q-053).
- The mock wallet debit is idempotent per booking, and a paid-but-unfinished trip is restored after relaunch so its receipt is recorded.

## D-031 — Pickup PIN

**Decision.** When enabled in `ServiceConfig.pickupPin` (mock: 4 digits), a PIN is generated at match time and shown to the passenger while the driver is on the way / has arrived ("Share this PIN with your driver"; for someone else: "Share with {name}"). Driver-side entry and server generation are backend work (BACKEND_HANDOVER).

## D-032 — Four-tab navigation: Home · Activities · Wallet · Account

**Decision.** Answers Q-049 per the testing brief §13. Wallet moved from Account to its own tab. "Book for someone else" is a passenger selector on Home (name + Nigerian phone, carried on the booking). Rewards became **Referrals** under Account, plus a secondary row on Home.

## D-033 — Interim onboarding photography

**Decision.** Onboarding uses three photographic scenes cropped from the brand pack's "brand-applications" board (512 px source) with a slow drift (still under Reduce Motion), progress segments, Skip, Create account / Log in. They are placeholders until real photography or footage is supplied (Q-050). Travel-award style claims from the reference were not used.

## D-034 — Monochrome colour system with brand accents

**Context.** Owner instruction 2026-10-21 19:31: brand colours stay aubergine #351A40 and tangerine #FF751F, used selectively; the interface is built on black, white and neutral greys, in all three products (passenger app, driver app, admin dashboard).
**Decision.**
- `@gobye/ui` tokens are grouped as background / surface / text / border / action / status / brand-accent (`packages/ui/src/theme/tokens.ts`, DESIGN_SYSTEM §11). Light: page/header/nav #FFFFFF, text #171717, secondary #666666, subtle #F7F7F7, borders #E8E8E8, primary button black/white, secondary pale grey. Dark: page/header/nav #000000, text #FAFAFA, secondary #A3A3A3, subtle #111111, raised #1A1A1A, borders #292929, primary button white/black, secondary dark grey.
- Brand colours only for logo details, illustrations, route lines (tangerine), rating stars, rewards and the onboarding route curves. No purple backgrounds, lavender tints or orange-filled controls; avatars without a photo are neutral.
- Status colours are separate: success green, warning amber, error red, each with a surface tint for both themes and always paired with a label or icon. Toasts use an inverse surface.
- Selected controls: neutral fill + border plus a radio, check or weight change; active tab = filled icon + semibold label + primary text colour.
- Elevation: shallow shadows in light mode only; in dark mode grey surfaces plus hairline borders on sheets.
- The Jade / Aubergine preview switch is retired (`BrandDirection` kept only for stored settings). The splash stays up until the saved appearance is applied, and the root/Android navigation background follows the theme.
- Raster brand marks and app icons were recoloured from the old hexes (#251632 / #FF8A3D) to the new ones; splash backgrounds are #FFFFFF / #000000 in both apps.
**Consequences.** Supersedes the palette parts of D-016/D-027/D-028 and Q-047's working assumption. Typography is unchanged (Inter) per the owner's earlier instruction (Q-055 still open for Plus Jakarta Sans).

## D-035 — Reference-led screen redesign, floating navigation, skeleton loading

**Context.** Owner brief 2026-10-21 20:12: redesign each screen from its own reference at the finish of the approved wallet recreation; the selected navigation item uses the brand colour; implement loading skeletons.
**Decision.**
- Floating navigation tray (`features/navigation/FloatingTabBar.tsx`): rounded tray on the page background, labels always shown; selected item = `navActive` (aubergine in light, tangerine in dark) + filled icon + semibold label. It sits in layout flow, so it never covers content.
- New tokens: `navActive`, `navSurface`, `brandBanner`, `onBrandBanner`. Brand banners (aubergine) carry contextual prompts; a pending state banner uses tangerine with black text for contrast.
- Shared skeletons in `@gobye/ui` (`SkeletonGroup`, `Bone`, `SkeletonRow`, `SkeletonCard`, `SkeletonText`): one shared pulse per screen, static under Reduce Motion, announced once as loading, shaped like the final layout so nothing jumps.
- Screens rebuilt against their references (see `docs/screens/` and LOG): wallet (benchmark), onboarding, driver arrival and pickup coordination, trip in progress, trip completed, payment confirmation with Review / Paying / Done steps, payment method and bank transfer sheets, login steps (Step N of 3), location primer, negotiate, Home, search, options, pickup on map, Activities, Account and every sub page, Invite friends.

## D-036 — End of trip in three steps: pay, success, summary (2026-10-21)

**Decision.** The end of a trip is three screens, each with one purpose: `trip-complete` (a neutral check, "You've arrived", the amount due once, the method with Change, one primary action), `trip-paid` (green check, "Payment successful", amount paid once, Continue; shown only after a verified payment) and `trip-summary` (optional rating with Skip, compact driver and vehicle, receipt Download/Share, expandable trip and payment details, Back to Home). The former `trip-payment.tsx` checkout page is removed. Choosing Wallet never charges; "Pay ₦X" does. For bank transfer, "Pay ₦X" opens the account details, and "I've transferred" only starts a check, so the payment stays pending until it is received. Green appears only for a verified payment. Completion marks are about 0.6 s and shown still under reduced motion.
**Why.** The owner's end-of-trip brief: remove repeated amounts, driver cards and competing actions so the next step is always clear.
**Consequences.** `liveRoute` sends `payment_pending` to trip-complete and `completed` to trip-summary. `Button` gained `loadingLabel` so progress has words, not just a spinner. A "Pay later" text action stays so passengers are never trapped; the trip remains "Payment outstanding" on Home.

## D-037 — Management platform as a web app in the monorepo (2026-10-21)

**Decision.** GoBye Management is `apps/admin`: Vite + React 19 + TypeScript with hash routing, one app with a workspace per team. The shared management model (permission groups, ledger, status workflows, approvals and a seeded test dataset) lives in `@gobye/core` under `platform/` and is unit tested, so the rider app, driver app and admin share record types and money rules. Icons come from `@mingcute/icons` (the framework-neutral definitions of the same official set; `@mingcute/react` stays unused). The old single-page admin preview is superseded.
**Why.** The owner chose "new admin web app" over extending the preview, so the screens can later connect to the backend unchanged. A dashboard needs dense tables and drawers that React Native Web handles poorly.
**Consequences.** The specification lives in `docs/management/`. Every change in the prototype goes through one `mutate`/`useAction` path that simulates latency and failure and writes an audit event; the backend replaces it with authenticated commands (README §Backend contract). Sign in is simulated by choosing a test staff account; permissions are enforced in the UI only until the backend enforces them.

## D-038 — Money in the management platform is a double-entry ledger with four-eyes corrections (2026-10-21)

**Decision.** Balances are derived from ledger journals that always sum to zero; nobody edits a balance. Provider references make postings idempotent (a duplicate webhook posts nothing). Wallet funding is a liability held for passengers, never revenue; company revenue is driver package sales (0% commission, D-024). Withdrawals reserve earnings when requested, leave only on the provider's success event, and return on failure or rejection; a later reversal is its own journal. A direct transfer to a driver's own account is recorded only and never credited to withdrawable earnings. Refunds, ledger corrections, config publishing, payment provider activation, announcements to everyone or by SMS, and sensitive staff roles need an approval from someone other than the requester; an approved ledger correction posts exactly the balanced lines in the request (or a full reversal), once. Unexplained reconciliation differences go to a `suspense` account until investigated.
**Why.** The owner's brief (§5) requires traceable corrections, no double spending and separation of trip value, revenue, deposits and earnings.
**Consequences.** Goodwill refunds and wallet corrections are funded from "promotions and goodwill" (open question Q-057). Thresholds in `APPROVAL_RULES` are placeholders.

## D-039 — GoBYE website as a static page with a content model (2026-10-22)

**Decision.** The landing page is `apps/web`: plain HTML, CSS and JavaScript with all changeable content (copy, launch status, store links, waitlist endpoint, QR card, verified trust data) in `site.config.js`. It uses Plus Jakarta Sans as the website's working typeface, per the owner's website brief; the apps stay on Inter (Q-055). Trust shows the prelaunch "Meet GoBYE" block until verified evidence exists; the verified block only renders a rider count with a definition, ratings with a source link, and testimonials with permission. The waitlist reports success only on a 2xx from the configured endpoint; without one it states "Demo only: not saved".
**Why.** Owner brief 2026-10-22: configurable content, no unverified claims, honest prototype states, no build step needed to host it.
**Consequences.** The hero photo is a stand-in made from the owner's reference video with the real app screen composited in; the final photograph is still to be produced (Q-062).

## D-040 — Website redesign on the owner's landing page prompt (2026-10-22)
- **Decision:** everything below the hero follows the owner's structure prompt, and the hero video section is unchanged.
  - **Brand gradient:** tangerine to apricot, and aubergine to plum, replace the prompt's blue/violet.
  - **Rider/driver toggle:** switches the content below the hero.
- **Left out on purpose:**
  - Language selector: the site is English only.
  - Laurel wreaths.
  - AI chat bubble: there is no assistant behind it.
  - Floating founder card: no approved founder details. The banner founder card stays hidden until `founder` config is filled.
  - Prices in the comparison: access package prices are provisional, D-024.
- **Imagery:** only real app captures (some carry the honest "Simulated" pills) and the existing 3D renders.


## D-041 — Public website shows product visuals without in-app testing labels (2026-10-22)
- **Decision:** the marketing site is going live, so its product visuals do not carry the app's testing labels ("Simulated", "Design preview", "Preview terms"). The labels stay in the apps themselves (BR-104), where they describe mock services to testers.
- **Constraints:**
  - Visuals show only features that are built or documented as planned for launch.
  - Unfinished terms (referral reward amounts, pass prices) are not shown as numbers.
  - The waitlist demo notice is functional, not a label. It remains until `waitlist.endpoint` stores sign-ups.
- **Safety section:** only states safety features recorded in the PRD, SRS, SECURITY_PRIVACY and decisions. It makes no claims about insurance cover, background-check vendors, response times or emergency alerts by GoBYE (BR-120).
