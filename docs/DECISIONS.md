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
| D-008 | Phone number + OTP as the only sign-in method (mocked) | Superseded by D-045 (rider) and D-048 (driver) | 2026-10-21 |
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

## D-042 — Website waitlist stored in Supabase (2026-10-22)
- **Decision:** the landing page writes sign ups straight to Supabase (`public.waitlist`, project `morqitxqsfiprefczduo`) through the REST API with the public anon key.
- **Security:** row level security plus column grants let the anon role INSERT (full_name, email, phone, city, intent, source) and nothing else; phone is stored as +234 E.164; it cannot read, update or delete. Check constraints validate the email format, city, intent and source, and a unique index on `lower(email)` blocks duplicates (409, shown as "You're already on the list"). There is a hidden honeypot field against simple bots.
- **Secrets:** the service_role key is never shipped to the browser or committed. It was shared in chat on 2026-10-22 and must be rotated.
- **Migration:** `supabase/migrations/20261022_waitlist.sql`, run manually in the SQL Editor because this workspace cannot reach the project.
- **Open:** a privacy notice must be linked from the form before launch (Q-063). There is no rate limiting beyond Supabase defaults.

## D-043 — Shared app building blocks live in `@gobye/ui` (2026-10-22)

- **Decision:** generic pieces first built in the rider app (sign-in steps, map surface, floating tab tray, journey bar, completion mark, vehicle summary, settings groups) moved into `@gobye/ui` so the driver app reuses them. The rider's old paths re-export them. `@gobye/ui` stays independent of `@gobye/core` (structural `VehicleLike` / `LatLng` types) and of expo-router (structural tab-bar props); `MapCanvas` is imported from `@gobye/ui/src/map/MapCanvas` so apps without react-native-maps don't pull it in.
- **Why:** one look and one behaviour across both apps; fixes land once.

## D-044 — Driver preview: verification, requests and payments are simulated (2026-10-22)

- **Decision:** the driver app runs on simulated services: document review auto-approves after a few seconds, requests are generated near the driver while online, a rider accepts a counter about two times in three, wallet payments confirm automatically and transfers wait for the driver to confirm receipt. Every such screen carries `SimulatedBadge` copy. The pickup PIN is shown in the preview so the flow can be completed. Driver data is stored on the device per signed-in number.
- **Why:** lets the owner walk the full driver journey before the backend exists, without presenting mock data as live (CLAUDE.md).

## D-045 — Rider sign-in: email + password, Apple, Google, all with phone verification (2026-10-22, supersedes D-008 for the rider app)

- **Decision (owner):** build everything in the "GoBYE Auth Flow" design. Riders create an account with full name, email, phone and password, or continue with Apple or Google. Every route ends with a 6 digit code to the rider's phone, because the driver must be able to reach them at pickup. Sign in accepts email or phone plus password, followed by the phone code. Reset password works by email code. Apple is offered whenever Google is (App Review Guideline 4.8).
- **Preview behaviour:** accounts, SMS, email codes, Apple and Google are simulated (`createMockServices` auth, with optional `authStore` persistence). Sign-in failures use one neutral message, and a reset request always "succeeds", so neither reveals whether an account exists.
- **Backend tasks:** server-side password hashing (Argon2id or bcrypt), rate limits on sign-in, OTP and reset; real Sign in with Apple (`expo-apple-authentication`) and Google (`expo-auth-session` / native SDK) with token verification on the server; account linking by verified email.
- **Welcome:** the website's dark 3D road scene recorded as a 12 s seamless loop (250 KB H.264) and played with `expo-video`; a still poster shows under Reduce Motion.
- The driver app moved to the same flow on 2026-10-22 (D-048).

## D-046 — No "Pay later" after a trip (2026-10-22, owner; amends D-036 / Q-053)

- **Decision:** the trip-complete screen no longer offers "Pay later". An unpaid trip is paid there (wallet or bank transfer, with the method switch and Add money still available), and Android back shows "Pay for this trip to finish it." instead of leaving.
- **Exception:** when the rider has already sent a payment that is awaiting confirmation (a transfer not yet seen, or a result that didn't come back), "Check later" remains. Leaving keeps the trip on Home as "Payment pending", because asking to pay again would invite a double payment.
- **Risk noted:** a rider who can't pay right now (no wallet balance, no bank access) is held on this screen. Support contact and the refund/dispute process should be reachable here once the backend exists.

## D-047 — Sign-up journey and auth CTAs follow the website waitlist look (2026-10-22, owner)

- **Decision:** Create account copies the website's waitlist journey: a plum gradient header with route progress, one question per step, choice tiles, a round back button and a rider pass at the end. Every sign-in and sign-up primary button uses the website's tangerine gradient CTA (`Button variant="brand"`).
- **Scope:** an owner-requested exception to D-034 (a monochrome interface with brand accents only), limited to the welcome and auth screens. Booking, trip and payment screens stay monochrome.

## D-048 — Driver accounts and welcome match the rider app (2026-10-22, owner; supersedes D-008 for the driver app)

- **Decision (owner: "update everything end to end, hold on the backend"):** the driver app uses the same account flow as the rider app: a welcome with the road video (Light and Dark clips), Create account / Sign in, a four-step "Become a driver" journey (You → City → Contact → Secure), sign in over two steps, reset password, Apple / Google, then a code to the phone, and a driver pass before registration.
- **Driver-specific:** City offers Lagos and Abuja only (drivers are onboarded in launch cities, Q-007), so there is no state picker. The name, email and city from sign-up are saved as About you, so registration opens on the licence step.
- **Shared code:** the journey building blocks (`JourneyFlow`, `JourneyField`, `PasswordRules`, `ChoiceTile`, `SocialButtons`, `MemberPass`, …) moved from the rider app into `@gobye/ui` (D-043), so both apps use one implementation.
- **Trip detail:** a branded earnings statement (aubergine band, what the driver earned, payment received or pending, timeline, rider, ₦0 commission, copyable reference), matching the rider receipt.
- **Backend:** unchanged contracts; all simulated (D-044, D-045). Accounts persist on the device in the preview (`authStore`).

## D-049 — Connected demo: rider, driver and admin share test records through a demo relay (2026-10-22, owner)

- **Decision (owner: "make sure rider and driver are now connected to admin end to end even though this is a demo"):** a small REST relay with the Supabase / PostgREST query shape connects the three apps. Locally `npm run demo:relay` (same Wi-Fi, writes each app's `.env.local`); remotely the optional `demo_*` tables in Supabase. Without a relay address every app still runs fully simulated on its own.
- **What is shared:** sign-ups (riders and drivers), driver applications and staff review (checks, waiting reasons, requests for changes, approve, reject), rides (Quick Match claims, negotiated offers and driver answers, the pickup PIN, driver position, every stage, payment status, cancellations by rider, driver or staff) and an activity feed. See docs/DEMO_CONNECTED.md.
- **Driver dashboard before approval (owner):** signed-in drivers always reach the dashboard. Until approved a verification card shows the stage (Register → Review → Drive), the registration steps still to do, items staff flagged with how to fix them, and checks held up by an outside office (NIMC, FRSC, inspection slot, insurer, background check) with the reason and since when. Go online stays locked until approval. Without a relay the review is simulated on the phone, including an FRSC wait.
- **New status:** `changes_requested` (staff sent it back; fixing a step resolves its items; the driver resubmits).
- **Safety and honesty:** test data only, labelled as demo in every app. Photos never leave the phone; ID and licence numbers are masked to the last four. The pickup PIN travels through the relay in the demo only (a real backend never exposes it like this). The Supabase demo tables are writable with the anon key and must be dropped after the demo; the service role key is never used in an app.
- **Not production:** polling every 2–3 s, no auth, no conflict handling beyond "first driver to claim wins". The real backend contract stays in BACKEND_HANDOVER.md.

## D-050 — No gradients in the mobile apps; one solid colour each (2026-10-22, owner; amends D-047)

- **Decision (owner: "take away gradient from the mobile app and use only one colour; gradient is giving AI"):** the brand button is solid tangerine `#FF751F` with dark ink (pressed `#E8650F`), with no gradient, top highlight or orange glow. The auth / journey header is solid aubergine `#351A40` (no plum gradient or glows), the route progress fill is solid tangerine, and the rider's in-trip panel is a solid sheet with a hairline top edge instead of fading into the map.
- The website keeps its own look; this applies to the rider and driver apps (shared `@gobye/ui`).

## D-051 — Provider-independent infrastructure foundation (2026-10-23, owner brief)

- **Decision:** build the infrastructure foundation without choosing a backend or database. Clients only know stable addresses (`api.gobye.app/v1`, `realtime.gobye.app`, `media.gobye.app`); origins sit behind a Cloudflare Worker gateway and a traffic policy. Files live in Cloudflare R2: environment-specific private buckets (quarantine, documents, evidence) and one public media bucket; uploads go direct to R2 with short presigned URLs issued by trusted code and are only usable after server-side completion and a clean scan (fail closed while no scanner exists). The website stays on Vercel with DNS-only records (no Cloudflare proxy in front); the admin will be deployed the same way.
- **Implemented in code and tested locally:** `packages/core/src/{infra,files,traffic}`, `infra/cloudflare` (api-gateway, upload-signer, media-gateway Workers, SigV4 presigner, R2/DNS/LB definitions), `vercel.json` headers, `tools/check-env.mjs`, admin "Traffic and origins" (simulation).
- **Not done (needs approval or providers):** no deployment, no bucket, no DNS change, no secret set. Cloudflare Load Balancing is not activated: it waits for a second real origin, a plan check and approval.
- **Why:** the backend can change provider without rebuilding the apps or website; private documents are private by construction; uncertain writes (bookings, payments) are never replayed.
- Docs: `INFRASTRUCTURE_REPORT.md` and the documents it links.

## D-052 — Website and admin Content-Security-Policy is enforced, not report-only (2026-10-23)

- **Decision:** `apps/web/vercel.json` and `apps/admin/vercel.json` enforce a CSP. Website: scripts from self and `cdnjs.cloudflare.com` (QR library), styles self + inline (style attributes are used) + Google Fonts, fonts from `fonts.gstatic.com`, connections to self and `*.supabase.co` (waitlist), no framing. Admin: self only, plus API hosts and `*.supabase.co`.
- **Why:** the site has no inline scripts, and a Chromium run with the headers applied showed no violations, so enforcing costs nothing and blocks injected scripts and exfiltration to other hosts.
- **Watch:** moving the waitlist to another host, adding analytics or a new CDN needs a CSP change first. Re-check the console after the first deployment (fonts and cdnjs couldn't be loaded from the build sandbox).

## D-053 — Admin web uses jade green actions on an aubergine shell (2026-10-23, owner brief)

- **Decision:** the management platform (`apps/admin`) uses Jade Green `#0B7A5B` as its action colour (buttons, selected tabs, focus ring, chart bars), a Deep Aubergine `#251632` sidebar in both themes, Tangerine `#FF8A3D` only for counts and the highlighted chart bar, and Soft Mint `#E7F5ED` for selected states. Status colours stay separate and always come with text or an icon.
- **Why:** the owner's admin redesign brief names this palette. Staff work in the dashboard all day, so actions need one clear, recognisable colour.
- **Scope:** admin web only. The mobile apps keep D-034 / D-050 (monochrome with brand accents, no gradients). Final brand colours are still Q-008. Every value is a token in `apps/admin/src/styles.css`, so changing the palette is one edit there.
- **Contrast (checked):** white on jade 5.3:1; jade text on mint 5.8:1; secondary text 6.5:1; form-control borders 3.2:1; sidebar text 10.7:1. In dark mode jade lightens to `#3DCB97` (8.8:1 on the dark surface).

## D-054 — Provider-independent payments with versioned fee schedules (2026-10-23, owner brief)

- **Decision:**
  - Payments go through a server-side `PaymentGatewayAdapter` (no provider hardcoded).
  - Wallet funding and withdrawal fees come from versioned, effective-dated `FeeSchedule`s, prepared by finance and approved by the owner.
  - An unset fee blocks the operation.
  - Every payment is recorded as gross, provider charge, GoBye fee, wallet movement and settlement, with GoBye fees in a new `fee_income` account.
  - Credits need a matching server lookup.
  - Payouts are never resubmitted after an unknown outcome.
  - Provider switches need the `gateway_switch` owner approval and drain in-flight money on the old provider.
- **Confirmed pricing (owner, 2026-10-23):**
  - daily package ₦2,000 for 24 hours from successful activation;
  - monthly ₦60,000 for 30 consecutive days;
  - 0% trip commission.
  - Wallet and withdrawal fees are configurable and depend on the selected provider.
- **Also:** fixed the ledger's provider-fee posting signs (costs now debit, clearing credit).
- **Not done:** no real adapter (Q-042), no fee values (Q-073). See `PAYMENTS_AUTOMATION_ARCHITECTURE.md`.

## D-055 — Automation Centre registry; server-side, idempotent, protected retries (2026-10-23, owner brief)

- **Decision:** every background workflow is declared once in `AUTOMATIONS`, with:
  - trigger, conditions and server action;
  - idempotency key, retry policy, timeout and escalation;
  - owner role, bounded settings and manual retry rule.
- **Running:** only on the server.
- **Retries:** only transient failures retry automatically. Possible-money-moved failures become `needs_lookup`. Successful runs are never replayed. Manual retries keep the idempotency key and need `automation.retry` and a reason. Setting changes need a second person (`automation_config`).
- **Status:** registry and rules implemented and tested; run history in the admin is simulated; no runner (Q-074).
