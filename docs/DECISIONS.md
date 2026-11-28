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
- Drivers need an active **access package** to go online (BR-072). Configurable packages in `DRIVER_ACCESS_PACKAGES`: Daily ₦2,000 / 1 day, Monthly ₦60,000 / 30 days, both flagged `provisional: true`. Buying while active extends from the current expiry. *(Superseded by D-058: passes queue after the last scheduled pass.)*
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

## D-056 — Admin dashboard is white-only with dimensional icons (2026-10-23, owner briefs; supersedes D-053's sidebar and dark theme)

- **Decision:**
  - Every admin surface is white; no dark theme.
  - Jade marks actions and selection with a thin indicator, never a fill. Aubergine is used for high-emphasis type.
  - Elevation tokens e0 to e4.
  - A family of 23 rendered 3D icons is used only in featured metrics, empty states and introductions.
- **Why:** the owner's "Mandatory White Background Design Rule" and the premium redesign brief.
- **Asset note:** the 3D icons are procedural renders produced in the repo (`tools/3d/render.py`, Blender as a Python module), not commissioned brand art. They can be replaced file for file.

## D-057 — Infrastructure and operating costs are captured manually until billing APIs exist (2026-10-23, owner brief)

- **Decision:** costs come from expenses staff record with an invoice.
  - Below ₦50,000 (placeholder threshold), a finance person other than the creator approves.
  - At or above it, the owner approves.
- **Budgets and break-even:** budgets are set per month. Break-even compares operating cost, **excluding marketing**, with verified driver-pass revenue at the confirmed prices.
- **Seeds:** honest only: Vercel, Cloudflare, R2 and Supabase are on free plans; backend, SMS, email, monitoring and maps are not chosen or only proposed; Paystack is in test mode. No bill is invented.
- **Automation:** `costs.sync` is defined but not connected.
- **Open:** invoice files need the backend and private R2 to store them.

## D-058 — One authoritative driver pass timeline; new passes queue after the last scheduled pass (2026-10-23, owner brief)

**Problem (audit).** Validity was calculated in three places that disagreed:
1. Driver App kept one stored pass and extended from the *current* expiry only. A purchase made while a pass was active replaced the record with a future-dated one, so `hasActiveAccess` became false: the driver lost access they had paid for, and earlier history was overwritten. It could not chain after a pass that was already queued.
2. Admin subscriptions computed each pass independently from its own `verifiedAt`, so passes overlapped and paid time was lost on screen.
3. Admin eligibility read `driver.access`, which the test data set independently of both.

**Decision.** `packages/core/src/subscriptions` is the only calculation. It is a deterministic fold over verified payments ordered by (confirmation time, payment reference): `startsAt = max(confirmedAt, end of the last access given)`, `endsAt = startsAt + 24 h | 30 × 24 h`. Cancellations, refunds and reversals are stored as separate void records: they cut `accessEndsAt` at the void time (never before the start, never later than the scheduled end), never delete the pass, and later passes move up. Status (`scheduled → active → expired`) is derived from the clock, so queued passes take over without a job. Writes are idempotent by payment reference and checked with `expectedVersion`. `SubscriptionTimelineResponse` is the one API shape (`GET /v1/drivers/{id}/subscription`) rendered by both the Driver App and the admin. Prices unchanged: ₦2,000 / 24 hours, ₦60,000 / 30 days, 0% commission.

**Consequences.** `subscribe` / `hasActiveAccess` are deprecated. The Driver App migrates an old stored pass once (`subscriptionStateFromLegacy`). Admin can cancel or refund a pass (permission `refunds.approve`, reason required, audited). Rules BR-062, BR-072, BR-137 to BR-139. Supersedes the "extends from the current expiry" note under D-024 and assumption A-20.

## D-059 — Backend Phase 1: NestJS on Fastify in `apps/api`, Supabase PostgreSQL, StackShift as candidate host (2026-10-23, owner brief)

- **Decision (owner):**
  - Expo apps, Vercel web and admin;
  - **NestJS** API;
  - **StackShift** as the initial hosting candidate;
  - **Supabase PostgreSQL and Auth**;
  - **Cloudflare R2**.
- **Engineering choices:**
  - **Fastify adapter:** speed, pino logs, in-process test requests.
  - **Hand-written SQL migrations** with a checksummed, forward-only runner, rather than an ORM.
  - **zod for validation** of config and requests.
  - **`@gobye/core` compiled into the API**, so the server and the apps share one implementation of every rule.
  - **Backend tables live in schemas `app` and `ops`**, not exposed through the Data API, with client roles revoked.
  - **`/v1/rides`** for bookings (Q-069 settled).
- **Conventions:**
  - URI versioning;
  - `{ data, meta }` envelope;
  - lower-case generic error codes, upper-case domain codes;
  - `422 validation_failed`;
  - request ids;
  - idempotency records written in the same transaction as the change;
  - gateway signature required in staging and production.
- **Restrictions kept:**
  - no real-money wallet, ledger, payouts or webhook endpoint until the ledger, reconciliation, provider and security reviews;
  - no Redis, ClickHouse, Kubernetes or new paid services;
  - StackShift not production until `DEPLOYMENT_STACKSHIFT.md` §4 passes.
- **Docs:** `BACKEND_AUDIT.md`, `BACKEND_ARCHITECTURE.md`, `DATABASE_MIGRATIONS.md`, `AUTHENTICATION_PLAN.md`, `DEPLOYMENT_STACKSHIFT.md`.

## D-060 — Durable jobs on PostgreSQL, no Redis (2026-10-23)

- **Decision:** the Automation Centre runner (D-055, Q-074) uses `ops.jobs` and `ops.job_schedules`:
  - `FOR UPDATE SKIP LOCKED` claims with a lease;
  - business idempotency keys (unique);
  - exponential backoff with jitter, then `failed` for a protected manual retry;
  - schedules that insert exactly one job per slot whatever the number of instances.
- **Why:** launch volume is far below what a Postgres queue handles. Jobs are transactional with the data they change, survive restarts, and are backed up with everything else. No new service to run or pay for.
- **Revisit when measured:** queue wait p95 > 5 s, > ~200 jobs/s sustained, or lock contention. Try `LISTEN/NOTIFY` and partitioning before a new service.
- **Scope today:** housekeeping only. Financial workflows stay `not_connected` (D-059).

## D-061 — Supabase Auth issues sessions; the API verifies tokens and owns permissions (2026-10-23)

- **Decision:**
  - The API verifies Supabase access tokens against the project's JWKS (ES256/RS256, cached ≤ 10 min). It checks issuer, audience, expiry, a UUID subject and `role = authenticated`.
  - Anonymous, service-role, `alg: none` and foreign-key tokens are refused.
  - HS256 (legacy shared secret) is allowed only in development and test.
  - Identity facts and permissions come from `app.users`, `app.drivers`, `app.riders` and `app.staff_members` on every request, never from token metadata.
  - Staff permissions (`permissionsOf`, the admin's table) require `aal2` when `STAFF_REQUIRE_MFA` is on (mandatory in production).
- **Resolves (partly) Q-065:** Supabase Auth is the auth provider; the SMS provider for phone OTP is still open.
- **Plan:** `AUTHENTICATION_PLAN.md`.

## D-062 — PROPOSED: phone verification at onboarding, on new devices and before sensitive actions (amends D-045 / D-048) (2026-10-23, Phase 1.5)

- **Status: Proposed. Not approved.** D-045 and D-048 stay in force until the owner approves this entry and it is marked Accepted here. No code implements either version yet; the apps' sign-in is still simulated.
- **Purpose kept from D-045:** every rider and driver has a **phone number that was proven reachable**, so a driver can reach the rider at pickup (and support can reach both). Also: a stolen password alone must not be enough to take over an account or move money.
- **What changes:** D-045 says every sign-in ends with a 6-digit code to the phone. Delivered literally through Supabase, that is the **Advanced MFA (Phone)** add-on: $75/month for the first project and $10 per additional project, plus every SMS. It also sends an SMS on every sign-in, which adds cost and SMS-pumping exposure (R-5) without a safety gain after the number is proven. Proposed instead:
  1. **Onboarding:** the phone number is verified by OTP before the account can book or drive (Supabase phone verification through the SMS provider or Send SMS hook, A-4). A number already verified on another account is refused or sent to support.
  2. **New or untrusted device:** a sign-in from a device the account has not verified before needs a phone OTP. The app keeps a device key in secure storage; the API records verified devices per user, revocable from Account and by support.
  3. **Sensitive actions (step-up):** a fresh OTP (or staff TOTP), not older than 5 minutes, before:
     - changing the phone number, email or password;
     - adding or changing a payout or bank account;
     - wallet withdrawals or transfers (when they exist after the money reviews);
     - deleting the account.
  4. **Ordinary sign-in on a trusted device:** password, Apple or Google, with no SMS.
  5. **Sessions:** 15-minute access tokens (A-6), refresh-token rotation with reuse detection, sign-out revokes the refresh token, and suspension takes effect on the next request (already true: principals are read from the database).
  6. **Staff:** unchanged. TOTP is mandatory (`aal2`, D-061).
- **Threat controls added to keep the purpose:**
  - per-number, per-device and per-IP OTP rate limits;
  - Nigerian numbers only at launch;
  - CAPTCHA (Turnstile) before OTP on web;
  - SMS spend alerts;
  - a notice to the old phone and the email on a phone change, with a 24-hour hold on payout changes after it;
  - device list and "sign out everywhere" in Account;
  - audit rows for every verification and step-up.
- **Not enabled:** the paid Advanced MFA Phone add-on, which needs explicit approval.
- **Cost:**
  - SMS per OTP (onboarding, new devices and step-ups only), provider price unknown (A-4);
  - no fixed add-on fee.
- **Work it implies (Phase 2):**
  - a `user_devices` table and the device-verification flow;
  - a step-up check (`@RequireRecentVerification`);
  - OTP rate limits;
  - app screens for "verify this device" and step-up;
  - tests.
- **Approval needed:** owner (A-3, A-4, A-6). On approval, mark this entry Accepted, mark D-045's phone-code step "amended by D-062", and update `AUTHENTICATION_PLAN.md` §6 from "proposed" to "decided".

## D-063 — Engineering checks for the backend: role-level DB timeouts, CI, lint (2026-10-23, Phase 1.5)

- **Database timeouts (C-1):**
  - No session settings at connection start: no `statement_timeout`, `options` or `search_path` start-up parameters.
  - Timeouts come from the role (`apps/api/db/roles.sql`), `SET LOCAL` per transaction, and a client-side `query_timeout`.
  - Regression-tested through PgBouncer in transaction mode. `migrate.js check-runtime` checks a real environment.
- **CI:**
  - `.github/workflows/ci.yml`, read-only, actions pinned by commit SHA.
  - Typecheck, lint, every workspace's tests, the Expo exports and the admin build.
  - API tests against PostgreSQL 16 with a non-superuser admin role like Supabase's, plus PgBouncer. Database tests must run: a skip, an unreachable database or a `not ok` fails the job (`scripts/test-strict.mjs`).
  - The API image is built with a digest-pinned base and smoke-tested (`scripts/docker-smoke.sh`).
- **Lint:** ESLint 10 flat config at the root with the recommended JavaScript and typescript-eslint rules, plus React hooks. Problems were fixed in code. The only relaxations are written in `eslint.config.mjs` with their reason: Metro asset `require()`, Jest mock factories, and `_`-prefixed unused names.
- **Not adopted:** type-aware lint rules. They would roughly double CI time and need per-workspace project setup. Revisit when Phase 2 grows the API.

## D-064 — WhatsApp quick booking: a fast way in, everything else in the app (2026-10-27, owner)

- **Decision (owner):** "The idea is to book faster; every other thing is in the app."
  - Riders can book a **Quick Match** ride on WhatsApp by sending a pickup pin and a destination pin and tapping a fare.
  - The ride is an ordinary `app.rides` row (`channel = 'whatsapp'`).
  - Driver, tracking, chat, safety, payment and receipt happen in the app.
  - Negotiate stays in the app.
- **Rules:**
  - only riders whose GoBye account has that WhatsApp number;
  - pickup in a launch city;
  - fares computed and honoured by the server for 5 minutes;
  - one open ride;
  - messages over 10 minutes old ignored;
  - CANCEL from the chat only before a driver is assigned;
  - an in-app notice for every WhatsApp booking.
- **How:**
  - Meta WhatsApp Business Platform (Cloud API) webhook at `/v1/webhooks/whatsapp` (gateway class `webhooks`), verified with `X-Hub-Signature-256`;
  - de-duplicated by message id;
  - processed by Postgres jobs;
  - the conversation is a pure function in `@gobye/core`.
- **Not a money webhook:** it moves no money, so the BACKEND_ARCHITECTURE §9 restriction on payment webhooks doesn't apply.
- **Status:** built and tested; **off** (`WHATSAPP_PROVIDER=none`). Live only after the Meta setup, staging and server-side dispatch (Phase 3), with owner approval.
- **Docs:** `WHATSAPP_BOOKING.md`.

## D-065 — Hosting direction: Cloudflare for the apps' web side and the API; Supabase kept for the database and sign-in, ready to move (2026-11-13, owner)

- **Owner's direction (2026-11-13):** use Cloudflare for the backend and to host the front end.
  - This replaces StackShift (2026-11-07), which becomes the **backup**.
  - Proposed shape, still to check on staging:
    - website and admin on Cloudflare static hosting;
    - the existing API image on **Cloudflare Containers**, behind the existing gateway Worker;
    - jobs inside the container.
  - It needs the **Workers Paid plan ($5/month)**, a paid activation done by the owner.
  - To verify before relying on it:
    - container placement near the database (Europe);
    - Containers' maturity;
    - the real cost (estimate ≈ $7–12/month to start).
- **Supabase stays** for the database and sign-in.
  - Moving them to Cloudflare was considered and rejected: D1 is SQLite (our schema, triggers, roles, locks and job queue are PostgreSQL), and Cloudflare has no rider or driver sign-in service.
- **Ready to move later:**
  - The API now accepts any standards-based sign-in provider by configuration (`AUTH_PROVIDER=oidc`, `AUTH_ISSUER`, `AUTH_JWKS_URL`, `AUTH_AUDIENCE`; tests in `apps/api/test/auth-portability.test.ts`).
  - The admin "Data platform" page shows the readiness checks, the move plan and the alternatives (`DATA_PLATFORM_PORTABILITY.md`).
  - Neon is the backup database option.
- **Not changed:** Supabase project `gobye-staging`, the migrations, the roles.

## D-066 — Driver identity checks: QoreID (2026-11-13, owner)

- **Owner's choice (2026-11-13):** QoreID (https://qoreid.com) is the identity check provider for drivers. It answers Q-079 and BACKEND_PHASE_2_PLAN A-9.
- **What it covers for drivers** (from its API documentation, docs.qoreid.com, read 2026-11-13):
  - NIN and virtual NIN;
  - driver's licence;
  - face match against the NIN or licence photo, and a liveness check;
  - licence plate and vehicle lookups;
  - guarantor and address checks;
  - CAC lookup, useful for fleet owners.
- **Still to confirm with QoreID:**
  - prices per check (none published; request a quote);
  - a test (sandbox) account;
  - how they handle data under the NDPA, and a data processing agreement.
- **How it fits:**
  - one `IdentityVerificationService` in the API, with a simulated version until a contract and keys exist, so the provider can be swapped;
  - staff still make the final approval decision;
  - keys go only in the backend's secret store.
- **Not changed:** nothing has been built or bought yet. This is a Phase 2b work package.

## D-067 — Every integration reports back to our own dashboards (2026-11-13, owner)

- **Owner's rule (2026-11-13):** applies to every integration, past and future. Our API calls the provider and stores what it returns, and the result shows in GoBye's admin and in the relevant staff dashboard. Nobody verifies a driver, checks a payment or reads a delivery report on the provider's own site.
- **How it is enforced:**
  - `IntegrationRecord.resultsShownIn` names each page, its route and what it shows;
  - the admin integration detail shows it, with a "Not set" warning if empty;
  - `integrationsWithoutDashboard()` plus a core test fail when an integration has no home for its results.
- **Applied to the existing integrations:**
  - payments → Payments and Finance;
  - email, SMS and push → Communications and the Event log;
  - maps → Live;
  - sign in → Drivers and Staff;
  - database → Data platform;
  - file storage and identity checks → the driver's Documents tab;
  - monitoring → Event log;
  - jobs → Automation.
- **First example:** the driver Documents tab now has an **Identity checks (QoreID)** panel showing NIN, licence, face match, liveness and plate, each with its result, the fields that did or did not match, the time and the provider reference. It is simulated until QoreID is connected, and staff still decide.

## D-068 — Pay per use balances in our admin; a view only stakeholder role (2026-11-13, owner)

- **Balances.** Providers that charge per use (QoreID per check, the SMS gateway per code, and any later one) show in our admin:
  - the price of each use;
  - the money paid in, used in total and this month;
  - the money left, and how many more uses or "drivers fully checked" it pays for;
  - a warning when the balance is low.
  - The figures come from the provider's balance API when it has one, otherwise from our own record of every call times the agreed price. The page states which source it uses.
  - Core: `platform/serviceUsage.ts` (`usageSummary`, `payPerUseServices`) and `IntegrationRecord.usage`.
  - Admin: **Infrastructure & costs → Service balances** (`/costs/balances`), with a nav badge for low balances.
  - The QoreID and SMS prices are placeholders until quotes arrive.
- **Stakeholder.** New role `stakeholder` ("Stakeholder (view only)") for the majority owner (65%) and any investor who does not run the system.
  - Permissions: `summary.view`, `reports.view` and `costs.view` only, so it is view only by construction (test).
  - No technical pages, logs, personal details, safety records or ledger.
  - Lands on the new **Business summary** (`/summary`): drivers able to drive, rides completed, money in, running costs, whether the costs are covered, and service balances in plain words.
- **The three audiences:**
  - **developer:** technical pages (integrations, events, infrastructure);
  - **staff:** their role's queues ("My work");
  - **stakeholder:** the summary.
  - The company owner role keeps full view plus decisions.

## D-069 — Admin look: flat and compact, light by default with a dark theme, charts first (2026-11-13, owner)

- **Owner's direction:** less text and more graphs and analytics. The owner's reference design (a dark, flat, compact admin with a Settings page: General, Team, Sessions, Support) guides the admin from now on.
- **The owner chose:**
  - restyle the whole admin;
  - GoBye brand colours as the accent, not the reference's violet;
  - **light by default**.
- **Supersedes:**
  - D-056's white-first look and its "no dark theme" rule;
  - the jade accent.
- **Tokens** (`apps/admin/src/styles.css`):
  - plain surfaces, 1px dividers, no card shadows (only menus and dialogs float);
  - radii of 6, 8 and 10px; 14px body text; sidebar 232px; the selected item is a filled grey block.
  - **Light:** white background, #F2F2F2 surfaces, #E9E9E9 borders, text #0B0B0B / #555, accent aubergine #351A40.
  - **Dark** (`data-theme="dark"`): #0B0B0B background, #111 to #1A1A1A surfaces, #242424 / #343434 borders, text #F2F2F2 / #AAA, accent tangerine #FF751F (aubergine is unreadable on near black).
  - Chart colours are tokens too (`--chart`, `--chart-2`, `--chart-3`, `--chart-alt`, `--chart-grid`).
- **Theme switch** (`data/theme.ts`): Light, System or Dark. It is stored per browser, falls back to Light, and is set from the moon button in the top bar or Settings → Appearance.
- **Charts** (`ui/charts.tsx`): hand-built SVG, so no new dependency:
  - `Kpi` tiles with a `Sparkline`;
  - `BarChart` (grouped bars, a dashed target line, hover values and a hidden table for screen readers);
  - `Donut`, `Ring` and `HBars`.
- **Pages rebuilt chart-first:**
  - **Business summary:** money in vs running costs over 6 months, a costs-covered ring with the break-even passes, rides per day, a drivers donut, and service balance rings.
  - **Service balances:** a balance ring, uses by item and a price table.
- **Running cost:** until real bills are entered, the running cost shown is the planned year one budget (₦1,067,600 ÷ 12, `PLANNED_TECH_COST_MONTH`), labelled "planned".
- **Settings** (`/settings`, open to every signed-in role):
  - General: profile, appearance cards, and security (role, password, two step sign in);
  - Team: members with role, last sign-in and two step status;
  - Sessions: this device;
  - Support: email support, report a problem, search.
  - Password change, two step setup and remote sign-out are disabled until real staff sign-in exists, and say so.

## D-070 — No "prototype", "test data" or "simulated" labels in the admin (2026-11-13, owner)

- **Owner's direction:** the admin is the system that goes live. It must not show prototype, test mode or simulated wording that would have to be removed later. The figures shown now are generated, and will come from the live API later, on the same screens.
- **Removed:**
  - the prototype banner and the "Test data · simulated" sidebar footer;
  - every "Test data", "Simulated" and "Paystack (test)" pill;
  - the prototype and simulation notices on Integrations, Payment providers, Staff, Automation, Traffic, Collections, Reports, Safety and Live;
  - "(simulated)" in toasts, audit summaries and labels;
  - the "(test)" suffix on provider and bank names.
  - The integration state "Prototype" now reads "Not connected".
- **Demo tools behind one switch** (`apps/admin/src/data/mode.ts`): set `VITE_DEMO_TOOLS=true` to show them. Production builds leave it unset, so they never ship.
  - The tools: simulated provider events on withdrawals and refunds, reset data, simulate server failures, load example origins, and the Connected demo page.
  - Where they show, they are labelled "Demo".
  - The test suite turns them on.
- **Less text:**
  - page subtitles are one line, with the full text on hover;
  - the eyebrow over each title is hidden, because the breadcrumb already names the section.
- **Guard:** `apps/admin/src/shell/no-demo-labels.test.ts` fails if any page source shows prototype, test data, simulated or simulation wording.
- **Changes CLAUDE.md:**
  - the SimulatedBadge rule now applies to the rider and driver apps only;
  - in the admin, unconnected services show as "Not connected" or as disabled actions with a reason, never as "simulated".

## D-071 — Sidebar sections open on click, without arrows (2026-11-13, owner)

- **How it works:**
  - each sidebar section (Operations, People, Care and safety, Finance, Payments, Automation, Growth, Insights, Configuration, Administration, Costs, Technical) is one line with its icon;
  - clicking it opens its pages beneath it, indented;
  - clicking anywhere outside the sidebar folds it back;
  - one section is open at a time;
  - Home, My work, Approvals and Business summary stay visible at the top.
- **No dropdown arrow, by the owner's choice.** For screen readers the section line is a button with `aria-expanded`.
- **When folded:**
  - the line shows the section's total badge count;
  - the section of the current page is shown in bold.
- **Renames:**
  - "Infrastructure & costs" → "Costs";
  - the old "Settings" section (service areas, fares, packages) → "Configuration", so it is not confused with the Settings page.

## D-072 — Move the free parts to Cloudflare now; paid parts later (2026-11-13, owner)

- **Now (free):**
  - website (`gobye.app`, `www`) and admin (`admin.gobye.app`) on Cloudflare static hosting;
  - deployed by the manual workflow `.github/workflows/deploy-sites.yml`: preview on workers.dev first, then production with custom domains;
  - each `wrangler.toml` has an `[env.production]` with the domains.
- **Later (paid):** Workers Paid ($5/month) with the API containers, the API gateway in front of them, and R2 storage.
- Supabase (database and sign-in) is unchanged.
- **Safety:** the admin still signs in by choosing an account, so before production it goes behind Cloudflare Access (an allow list of team emails).

## D-073 — Paid hosting stays off behind an owner switch (2026-11-19, owner)

- **The owner's choice:** Cloudflare is the main home and StackShift stays as the backup. The paid parts stay off until the owner turns them on.
  - The paid parts are Workers Paid ($5), the API containers, the API front door and R2 storage.
- **Admin:** Technical → **Hosting** (`/infrastructure/hosting`), backed by `@gobye/core` `platform/hosting.ts` (`HOSTING_PARTS`, `hostingCost`) and `PlatformDataset.paidHosting` (off at start). The page shows:
  - each part, its provider, its monthly cost and its status;
  - a **Paid hosting** switch that only the owner can use (`staff.manage`).
- **What the switch does:** turning it on asks for confirmation and writes an audit entry (`hosting.paid_on`) recording the approval.
- **After the switch, the owner still:**
  - turns on Workers Paid in Cloudflare;
  - runs "Deploy API (staging)".
- **Site deploys:** `deploy-sites.yml` now reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the **staging** environment, because the repository-level secrets came through empty in runs.

## D-074 — Mobile test builds on EAS Build, free plan (2026-11-26, owner)

- **Files:**
  - `apps/rider/eas.json` and `apps/driver/eas.json`, each with the profiles `preview` and `ios-device` (the `demo` profile was folded into `preview` by D-075);
  - the app scripts `build:apk` and `build:ios-sim`, and the root scripts `rider:apk` and `driver:apk`;
  - the manual workflow `.github/workflows/build-apps.yml` (`--no-wait`, needs `EXPO_TOKEN` in the staging environment).
- **Configuration:**
  - builds run on simulated services (`EXPO_PUBLIC_ENV=development`, `EXPO_PUBLIC_USE_MOCKS=true`), with no `*.gobye.app` address;
  - Android `preview` is an APK for internal distribution, and iOS `preview` is a Simulator build;
  - the app version comes from `app.json` (`appVersionSource: local`).
- **Free plan only:** 15 Android and 15 iOS builds a month at low priority. It never charges; builds stop at the limit.
- **Needs the owner first:**
  - iOS on real devices (`ios-device`) and TestFlight need the Apple Developer Program, $99/yr;
  - the Supabase demo relay values go in EAS environment variables, never in git.
- Steps: `docs/MOBILE_BUILDS.md`.

## D-075 — Android test builds with Google Maps, and the connected demo on gobye-staging (2026-11-26, owner)

- **Why:** the first Android APK closed at once with a NullPointerException. The map (react-native-maps) uses Google Maps on Android, and the apps had no Google Maps key.
- **Maps:** the owner chose Google Maps (D-025 stays the provider) and handles Google Cloud billing. The key comes only from the build variable `GOOGLE_MAPS_ANDROID_API_KEY` (`app.config.js` in both apps). It is restricted to the two Android packages and Maps SDK for Android. Without a key, `MapCanvas` shows "Map not available in this test build" on Android instead of crashing.
- **Builds:** the D-074 `preview` profile now uses the EAS environment **preview**, where the Google key and the demo relay values are stored (the separate `demo` profile is removed).
- **Shared test data:** the connected demo (D-049) over Supabase **gobye-staging**, not a hosted API yet. Rider and driver builds get `EXPO_PUBLIC_DEMO_RELAY_URL` / `_KEY` from EAS. The admin gets them from the staging environment (`DEMO_RELAY_URL` variable, `DEMO_RELAY_KEY` secret), **preview builds only**.
- **Admin, narrowing D-070:** the Connected demo page now also shows when the build has a relay address (`DEMO_RELAY` in `data/mode.ts`), without the other demo tools. When the address is unset, the page is removed from the bundle, exactly as before.
- **Relay key:** publishable keys (`sb_publishable_…`) go in `apikey` only; a legacy anon key (JWT) also as a bearer token.
- Steps: `docs/TEST_BUILDS.md`.

## D-076 — The rider app in the browser, for iPhone testing without an Apple account (2026-11-26, owner)

- **Why:** TestFlight and iPhone installs need the Apple Developer Program ($99/yr), which waits for the D-U-N-S number. The owner chose a web build to open in Safari until then.
- **What:** `expo export --platform web` of `apps/rider`, served as static files on Cloudflare: `apps/rider/wrangler.toml`, Worker `gobye-rider-web-preview`.
- **Deploy:** Actions → Deploy sites (Cloudflare), site **rider**, target **preview** (production is refused). It runs on simulated services, plus the connected demo relay (`DEMO_RELAY_URL`, `DEMO_RELAY_KEY` from the staging environment) when set, with the same secret-key guard as the admin. Pages are marked noindex.
- **Limits:** close to the real app, not the same:
  - the map is the drawn placeholder (`MapCanvas.web.tsx`);
  - location prompts, the camera, haptics and gestures behave as a browser allows.
  - Phone testing of the real app stays on the Android APK, and on iPhone once the Apple account exists.

## D-077 — Accounts API built (Backend Phase 2, WP1) (2026-11-26)

- **Endpoints:** `POST/PATCH /v1/me/profile`, `POST /v1/me/roles`, `POST /v1/me/consents`, `POST /v1/me/devices`, `DELETE /v1/me` and `POST /v1/me/deletion/cancel`. `GET /v1/me` now also returns `phoneConfirmed`, `consentsNeeded` and `deletion`. Contracts: `API_CONTRACTS.md` §10.
- **Migration** `0007_accounts.sql`:
  - `app.consents` (append-only; the IP is stored only as a salted hash, and only when `IP_HASH_SALT` is set);
  - `app.devices`;
  - `app.account_deletions`;
  - the staff roles check now accepts `stakeholder` (D-068).
- **Rules** (`@gobye/core` `accounts/`):
  - sign-up needs a confirmed `+234` mobile number from the Supabase token, and one account per phone;
  - consent must match `CURRENT_CONSENTS`, which are **placeholders** until legal supplies versions (A-10);
  - deletion has a 14-day grace period, then the `account.delete` job anonymises the person (name, email and phone removed, devices deleted). Trips, money records, consents and audit keep the id only.
- **Removing the Supabase sign-in account** uses `SUPABASE_SERVICE_ROLE_KEY`, which is worker only and stored as a Worker secret.
  - Without the key, the job still anonymises our data and records `auth_user_deleted = false`.
- **Still open:**
  - confirm on staging that Supabase sets the `phone` claim only after the code is confirmed (WP0);
  - D-062 (device verification) is still proposed;
  - the apps' sign-in (WP2) is next.


## D-078 — Real sign-in in the apps behind a switch (Backend Phase 2, WP2) (2026-11-26)

- **Switch:** `EXPO_PUBLIC_AUTH=supabase` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public by design). The default stays `mock`, so demos and test builds are unchanged. **Only sign-in becomes real**: trips, payments and the rest still follow `EXPO_PUBLIC_USE_MOCKS`. A production app build refuses `mock` sign-in, and a `sb_secret_` key in the publishable slot fails the build.
- **Profile on our API:** `EXPO_PUBLIC_ACCOUNTS_API=true` makes the apps create and read the GoBye profile (`GET /v1/me`, `POST /v1/me/profile` with the current consents and the device). It stays off until the API is deployed. Until then the name and city live in the Supabase account's metadata, and account deletion says to contact support.
- **Package** `packages/auth-client` (`@supabase/supabase-js` 2.119.0), kept out of the pure core. The apps wire it in `src/state/realAuth.ts`.
- **Flows**, on the same screens:
  - **Sign up is phone-first:** Supabase account with phone and password (Supabase sends the code); name, email and city go in metadata; after the code, the profile is created and the email is added to the account (Supabase sends a confirmation link).
  - **Sign in** with email or phone and a password, then a code to the account's phone. The password step signs straight out locally, so the session only starts after the code. This keeps D-045 / D-048 ("every sign-in ends with a phone code") without the device rule in D-062.
  - **Password reset** by an emailed code, then a new password, then a local sign-out.
  - **Apple and Google** say "coming soon": they need native modules and store accounts.
- **Changes from the plan:**
  - the session is stored in the Keychain / Keystore in chunks, rather than encrypted in AsyncStorage with a key in SecureStore (simpler, and no crypto package needed);
  - sign-up starts with the phone rather than the email, so the phone code is the first proof.
- **Errors** are neutral and mapped from Supabase codes (`friendlyAuthError`).
- `toE164` now accepts local numbers (`0803 123 4567`). `GET /v1/me` now returns `fullName`.
- **Needs before it works on staging (owner):**
  - an SMS provider in Supabase Auth (A-4);
  - phone sign-in switched on;
  - the email templates for reset and confirmation showing `{{ .Token }}`.

## D-079 — Driver applications on the API (Backend Phase 2, WP3) (2026-11-26)

- **Migration** `0008_driver_applications.sql`:
  - `app.driver_applications`: one row per driver, with `status`, `version` and `data` (the core `DriverApplication`: steps, checks, flagged issues). File fields hold `ops.files` ids.
  - `app.application_events`: append-only.
- **Change from the plan:** steps and issues are stored in `data` rather than in separate step, issue and document tables. That way the API stores exactly what the `@gobye/core` rules return (`submitApplication`, `requestChanges`, `resolveIssuesForStep`, `resubmitApplication`, and the new `decideApplication`), and nothing is re-implemented in SQL.
- **Endpoints:** the driver's `GET`, `PUT …/steps/{step}` and `submit`; staff's queue, detail, `request-changes` and `decision` (`API_CONTRACTS.md` §10).
  - Versions guard every change: two staff deciding at once means one wins and the other gets `VERSION_CONFLICT`.
  - Staff stay inside their cities and can't review their own application. Phone and email show only with `drivers.contact_details`.
- **Files:**
  - a step only accepts the driver's own upload of the right kind;
  - submitting and approving need every file **scanned clean**. Until the upload signer writes `ops.files` and a scanner is connected, real submissions stay blocked (fail closed).
- **Approval** (BR-071) needs a complete application with no open issues and a licence valid that day. It sets the driver to approved and makes the vehicle active; a plate already active for another driver stops it.
- **Not built yet:**
  - the file download link for staff (`GET /v1/files/{id}/download`) and the upload endpoints' database link (WP3b, with R2);
  - notifications to the driver (in-app status only until push and SMS providers are chosen);
  - the second-person approval;
  - document expiry other than the licence (insurance and roadworthiness dates aren't collected yet).

## D-080 — The Driver App sends its application to the API (Backend Phase 2, WP4, part 1) (2026-11-26)

- **When:** real sign-in and the accounts API are both on (`EXPO_PUBLIC_AUTH=supabase`, `EXPO_PUBLIC_ACCOUNTS_API=true`). Otherwise nothing changes: the application stays on the device, with the demo relay or the simulated reviewer.
- **How:** the screens are unchanged. The app still keeps the application on the device (photos as local files) and mirrors it to the server:
  - each saved step is sent with the server's version, photos uploaded first;
  - submissions go to the server, and a refused one is undone on the device with the reason;
  - staff review (status, checks, flagged items, notes) is read on start and every 30 seconds.
  - A "Saved to GoBye" or error line with **Try again** shows under the verification card.
- **Core** (`driver/serverApplication.ts`): the API client, the uploader (presign, upload, server-side completion), step bodies, and the sync with one retry after a version conflict.
  - A plain-TypeScript SHA-256 (`files/sha256.ts`) gives the upload checksum without a native module.
  - Each photo is uploaded once; its file id is remembered on the device.
- **Checked:** core tests (including the FIPS checksum vectors), plus an API test that runs the app's sync code against the real API (steps, a conflict from another device, submit).
- **Not yet checked:**
  - reading a picked photo into bytes and uploading it as a Blob from React Native has not been run on a phone;
  - the upload endpoints need the upload signer connected to the database and R2 (WP3b), so photo uploads fail until then.

## D-081 — Real staff sign-in and the review queue in the admin (Backend Phase 2, WP4, part 2) (2026-11-26)

- **Switch:** `VITE_AUTH=supabase` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_API_BASE_URL`. Outside development it also needs `VITE_ENV`, `VITE_REALTIME_URL` and `VITE_MEDIA_BASE_URL`, as `parsePublicConfig` requires. Without the switch the admin is unchanged: staff picker and its own dataset.
- **Sign-in:**
  - work email and password, then a 6-digit code from an authenticator app (Supabase MFA, TOTP);
  - the first time, the page shows a QR code and a key to set the app up;
  - after the code, `GET /v1/me` gives the staff member (id, name, email, roles, cities); an account that isn't active staff is signed out.
- **Driver applications page** (`/drivers/applications`, only in this mode): the queue by status; the application in a side panel with checks, open items, details (ID numbers masked), document check states and history; **Approve**, **Ask for changes** (choose items, add a note) and **Reject** (with a reason).
  - Every action sends the version it was read at. If someone else changed it, the panel reloads and says so.
  - Staff without `drivers.verify` see the buttons disabled, with the reason.
- **Not yet:**
  - viewing document images (needs file storage, WP3b);
  - every other admin page still shows the admin's own dataset in this mode. Only sign-in and this page are on the API, so the mode is for staging only.
- **`GET /v1/me`** now includes `staff.id`, `name` and `email`.
- **To use on staging (owner):**
  1. In Supabase Auth, keep TOTP multi-factor on (it is on by default).
  2. Invite each staff member (Authentication → Users → Invite).
  3. Add their row to `app.staff_members`, with their Supabase user id, name, email, roles and cities.
  4. Build the admin with the variables above.

## D-082 — File storage connected to the database (Backend Phase 2, WP3b) (2026-11-26)

- **The upload signer Worker** keeps file records in `ops.files` (migration 0005) through **Cloudflare Hyperdrive** with node-postgres. Hyperdrive is on the Workers Free plan (100,000 queries a day).
  - `createSqlFileRepository` (core) gives the tested file service the same contract on the database.
  - One connection per request, closed at the end.
  - A deployed Worker without its database answers `503 NOT_CONFIGURED` rather than keeping files in memory. Memory is for development only.
- **Who is calling:** the gateway's signed assertion when there is one. Otherwise the Worker checks the app's own Supabase session itself: signing keys, issuer, audience, expiry, a real user, not anonymous. File roles then come from the database (`fileRolesFor`, core):
  - rider and driver from their records;
  - onboarding, owner and admin read verification files; safety reads evidence; care has support access; owner and admin also get admin;
  - staff roles count only after the second sign-in step;
  - nothing ever comes from the token's user-editable metadata.
- **File ids** are now real UUIDs, to match the `uuid` column and the API's checks.
- **Daily clean-up** (Cron Trigger, free): abandoned uploads expire, and files still waiting are scanned again.
- **Still no virus scanner (owner decision).** Every completed upload stays "checking" and is never served, so drivers can't submit yet (fail closed). Options include a ClamAV container or a scanning service, each with its own cost.
- **To deploy (owner, all free):**
  - create the four staging R2 buckets and an R2 API token;
  - `wrangler hyperdrive create` with the gobye-staging pooler URL (the `gobye_api` role), and paste the id into `r2/wrangler.upload-signer.toml`;
  - the Worker secrets;
  - then deploy. The Worker is only reachable through the gateway on `api.gobye.app`, so gobye.app has to be on Cloudflare first.

## D-083 — Staging backups, personal data download, threat model update (Backend Phase 2, WP5, part 1) (2026-11-27)

- **Nightly staging backup** (`.github/workflows/staging-backup.yml`, free):
  - a `pg_dump` of `app` and `ops` with the session pooler, encrypted with `BACKUP_PASSPHRASE` (GnuPG AES-256);
  - checked by decrypting it and listing its tables;
  - kept as a private artifact for 14 days. Restore steps are in `BACKUP_DISASTER_RECOVERY.md`, rehearsed locally.
- **Personal data download:** `GET /v1/me/export` returns everything GoBye's tables hold about the caller as a JSON attachment, for the NDPA right of access. Internal storage details and other people's ids are left out, and each download is audited. Not yet in the apps' Account screens.
- **Threat model:** T16 to T23 cover phone-code abuse, password-only sign-in, session theft, staff document access, unscanned uploads, approval races, deletion and data rights, and backup exposure.

## D-084 — Rider screens tidy-up after the owner's review on iPhone (2026-11-27)

The owner reviewed the web preview on an iPhone and asked for the alignment and hierarchy problems to be fixed. Some of these replace earlier choices.

- **Money out is no longer red.** A trip payment shows "−" in the normal text colour; money in stays green. Red is kept for things that need attention. This replaces the 2026-10-21 rule (red for money out).
- **Selected segment** (Week / Month / All time) is a raised white pill, not a black outline.
- **Wallet:**
  - "Add money" is the one filled, wider action; the History tile is gone, and the list has "See all" / "Show less";
  - offers sit below the transactions (a deposit in progress still sits above);
  - rows show the exact time ("Today, 11:17"); the last filter is "Refunds", so all four fit;
  - the header, tiles, headings and cards share one left edge (20).
- **Transfer details:**
  - every row has the same shape (label over value), with the things to copy first and a quiet Copy pill;
  - once the money is in, the sheet becomes "Money added" with no instructions or Copy buttons;
  - the title is left-aligned with the content.
- **Ride details:**
  - one compact row of actions (Get help, Share receipt); "Rate this trip" moved into the ticket;
  - the route line is unbroken;
  - with no fee, the fare is shown once;
  - the plate is quieter;
  - simulated trips show a pickup time that agrees with the duration (`receiptTimes`).
  - The dashed lines stay: they are the ticket's tear lines.
- **Activities:** no average for a single trip, no day subtotal for a single trip, empty filters are hidden, and each row shows the time and how it was paid (the rest is on the receipt).
- **Create account and the other journeys (both apps):**
  - Back moved to the top-left of the header, like every other screen, so Continue is full width. This replaces the round back button beside it (2026-10-22);
  - the flow's name is a quiet bar and the step's question is the headline;
  - inactive step labels are brighter; the tiles are one height;
  - Continue is off on the City step until a city is chosen.
- **Kept:** the Simulated badges (required while services are simulated), and the X on sheets beside Done.

## D-085 — Near-white panels and a redrawn sign-up route (2026-11-27)

- **Light greys closer to white** (owner: "premium and crisp"), in `packages/ui` tokens, so every screen in both apps follows:
  - `surfaceMuted` and `navSurface` #F7F7F7 → #FAFAFA;
  - `surfaceSelected` #F0F0F0 → #F2F2F2;
  - `secondary` and `neutralSurface` #F2F2F2 → #F5F5F5; `secondaryPressed` #E5E5E5 → #EBEBEB.
  - Dark mode is unchanged.
- **Sign-up route** (`RouteProgress`):
  - the car, each stop and each label now share one centre (before, the labels sat in four equal columns and drifted from their dots);
  - the line is thinner, upcoming stops are hollow rings, and the current label is bold.

## D-086 — Whiter panels and near-white edges (2026-11-27)

The owner asked for a cleaner, crisper look: backgrounds close to white and outlines closer still.

- **Light-mode tokens** (`packages/ui`): `surfaceMuted` and `navSurface` → #FCFCFC; `border` #E8E8E8 → #F1F1F1.
- **New token `borderStrong`** (#E4E4E4 light, #3A3A3A dark) for things people must be able to find: text field outlines, the sign-up choice tiles and fields, sheet grabbers and the password strength track. Everything else uses the faint `border`.
- **Finding-a-driver cards** are white with the faint edge and the soft card shadow, instead of grey boxes.
- Dark mode's other colours are unchanged.

## D-087 — Wallet with a brand header, from the owner's bank-app reference (2026-11-27)

The owner shared a banking app's home screen and asked to take only what GoBye's wallet needs from it.

- **Taken:**
  - an aubergine header holding a greeting with the first name, the balance (kobo smaller) and a show / hide balance control;
  - two translucent actions in the header, Add money and History;
  - the page rising over the header with rounded corners, starting with recent activity; offers below it.
- **Left out** (GoBye doesn't have them): account number and "Active" badge, send money, airtime, betting and other quick-access tiles, the assistant button.
- **Details:**
  - Help moved to a small icon beside notifications;
  - the status bar is light only while the Wallet tab is showing;
  - a hidden balance goes back to shown when the app restarts.
- This replaces the pale-panel wallet from the earlier approved reference and D-084's filled "Add money" tile. Aubergine as a header background follows the existing brand banner use (sign-up, receipt).

## D-088 — Plum gradient header, compact wallet type, and the filter-chip fix (2026-11-27)

- **Gradient:** `PlumBackground` is now a soft diagonal gradient (lighter plum top-left to deep plum bottom-right, drawn with react-native-svg over the flat aubergine). The sign-up, sign-in and reset headers in both apps and the rider Wallet header all use it, so they match. This is the one approved gradient; the "no random gradients" rule still holds elsewhere.
- **Wallet type sizes** follow the owner's bank-app reference: a compact scale where weight, not size, carries the hierarchy.
  - Balance 30 (was 40) with 14 kobo; name 14 bold; labels 12.
  - Section heading 15 bold; row titles 14 semibold; chips 12 in a 32-high pill; header buttons 46 high.
  - Only the Wallet so far. The rest of the app keeps the shared type scale until the owner confirms.
- **Bug fixed:** choosing a filter with few results (for example Refunds) made the filter chips huge. The horizontal chip row was growing to fill the spare height of the page; it now keeps its own size.

## D-089 — Wallet text matched to the reference sizes (2026-11-27)

The owner confirmed the Wallet should match the bank-app reference's sizes (measured from the screenshot, give or take a point):

- balance 28 with 14 kobo;
- greeting, name (bold), "Available balance" and the header buttons 13;
- section headings 14 bold;
- transaction names 13 medium, amounts 12 bold, times 11;
- filter chips and "See all" 12.

Nothing is below 11. Wallet only: the rest of the app keeps the shared type scale until the owner decides.

## D-090 — Home and Work shortcuts appear only once an address is saved (2026-11-27)

- On the rider Home screen, the tile reads "Home" (or "Work") only when that address is saved, and then it books a ride there. Until then it reads "Add home" / "Add work" with a plus, in a quieter style, and opens the search to save one. "Saved" always opens the saved places list.
- New accounts start with **no** saved places. Before, test accounts were given a made-up Home and Work, so "Home" took a new rider to an address they had never added.

## D-091 — The compact type scale across both apps (2026-11-27)

The owner asked for the Wallet's reference sizes on every page.

- **Shared type scale** (`packages/ui` `typography`) is now compact: body and headings 14, names and labels 13, hints 12, times and badges 11; titles 16 to 26. Weight carries the hierarchy. The table is in `DESIGN_SYSTEM.md` §3.
- **Hero figures** that set their own size were brought down to fit: receipt total 30, trip totals 32, the Activities total 26, welcome headlines 28, the sign-up question 22.
- **Typed text stays at 16.** Smaller makes Safari on iPhone zoom the page when a field is focused.
- **Both apps change**, because the rider and driver apps share the design system. Touch targets and button heights are unchanged.
- Body text at 14 is below iOS's default of 17. Text still grows with the phone's text-size setting.

## D-092 — The wallet shows the rider's own account number, copyable (2026-11-27)

- The Wallet header shows the rider's wallet account number with a copy control, in place of the "Simulated" badge (owner request, from the bank-app reference).
- **While payments are simulated** the number is a stable test number per rider (`simulatedWalletAccount`: 10 digits starting 99), the chip beside it reads **Test**, and copying it says not to send real money to it. This keeps the rule that test data is never shown as live, in the place the reference shows "Active".
- **Going live** needs the payment provider's dedicated virtual accounts: one real account number per rider, where any transfer tops up the wallet. That choice belongs with the payments work (kept for later by the owner). The chip then reads **Active**.
- "Add money" still gives transfer details with an amount and reference, as before.

## D-093 — Add money by card, a styled balance, and shortcuts only for saved places (2026-11-27)

- **Add money has two ways to pay:** Card (first) and Bank transfer. The sheet asks for an amount, then "Pay with".
  - **Card** is paid on the payment provider's hosted secure page. The apps never show a card-number form and never see or store card details. In the test build no card is asked for: "Pay" confirms a simulated payment and credits the wallet.
  - This changes D-023 for the wallet only: riders still pay for a trip by wallet or bank transfer, and a card tops up the wallet.
  - **Before it is real** it needs the payment provider (kept for later by the owner), the card fee shown separately from the amount, and the money-handling reviews in `BACKEND_ARCHITECTURE.md` §9.
  - `WalletService.requestDeposit(amount, method)`; `WalletTransaction.method`; card top-ups are named "Card top-up" in the list.
- **Balance:** the ₦ sign is smaller and fainter, the figure is bold 32, and the kobo are small.
- **Home shortcuts** replace D-090's "Add home" / "Add work" tiles:
  - a tile shows only for a place that is saved (Home, Work), plus "Saved" when anything is saved; with nothing saved there is no tray;
  - after the rider's first trip, if nothing is saved, Home shows one card, "Save your usual places", with Add home, Add work and a close (not now) that is remembered.

## D-094 — No dots under the offers banner (2026-11-27)

- The pagination dots under the swipeable offers banner are removed (owner request). The banner still changes by itself and can be swiped.
- Cards inside the swipeable row have no shadow: the row cut the shadow off at its edge, which showed as a pale strip under the banner.

## D-095 — The Driver app in the browser, for testing (2026-11-27)

- Same approach as the rider web build (D-076): `expo export --platform web`, served from a free Cloudflare Worker (`apps/driver/wrangler.toml`, `gobye-driver-web-preview`), preview only, not indexed. Deploy with Actions → Deploy sites → site `driver`, target `preview`.
- The driver app got the rider's web fixes: small web fonts that don't block the page, per-screen loading, and a welcome road clip that plays inline in Safari with no play button.
- Simulated services, like the rider preview. The phone apps remain the real product.

## D-096 — Book a past trip again (2026-11-27)

- **Activities:** each trip has a "Book again" pill.
- **Ride details:** the main button is "Book again"; inside the receipt are "Return trip" (the same two places, swapped) and "Share receipt".
- Both fill in the pickup and destination and open the ride options, so the **fare is a fresh quote**, never the old price, and the rider can still change either place, the ride type or the payment.
- One trip at a time: with a ride in progress it says so, and an unpaid trip is settled first (`useBookAgain`).
- Places visited before were already on Home as "Recent" (tap to set the destination); that stays.

## D-097 — Drivers add a profile photo (2026-11-27)

- **About you** (registration step 1) now asks for **Your photo**: a clear picture of the driver's face, taken with the camera or chosen from the phone. It is required: the step isn't complete, and the application can't be submitted, without it.
- **Why separate from the ID selfie:** the selfie in the Identity step is only matched against the ID. The profile photo is the one riders see when the driver is matched, so they can check who is picking them up.
- **Rules and API:** `DriverPersonalDetails.photoUri`; the `photo` file slot (file class `profile_photo`); `PUT …/steps/personal` takes `photoFileId`; staff see "Profile photo" with its check state. The ID selfie now accepts only `identity_document` files.
- **Privacy:** the demo relay carries only whether a photo exists, never the picture.
- **Still to do:**
  - show the approved photo to riders (it arrives as `DriverSummary.photoUrl` once drivers come from the server; test drivers have none);
  - let a driver change the photo later from Account, with staff re-approval;
  - an "unclear photo" item for staff to send back.

## D-098 — A face check on the phone for driver photos (2026-11-27)

- **Decision:** when a driver takes or chooses a photo of themselves ("Your photo" and the ID selfie), the driver app checks it on the phone with Google ML Kit face detection (`@react-native-ml-kit/face-detection` 2.0.1, MIT; the ML Kit SDK itself is free under Google's terms). The photo is accepted only when there is one face, large enough, in the middle, facing the camera, with eyes open; otherwise the driver sees what to fix and retakes it. The rule is `assessFacePhoto` in `@gobye/core`.
- **Why ML Kit and not TensorFlow:** it is made for this job, runs offline, costs nothing, adds a few MB instead of a model we would have to ship and maintain, and the photo is not sent anywhere for the check.
- **Limits:** it is a quality check, not an identity check. It does not prove the person is real or matches the ID: that stays with staff review and the identity provider's face match (owner decision, still open). If the detector is missing or fails, the photo is accepted as before. The browser test build has no detector.
- **Not yet proven:** the native module has not been built or run. The first Android build (EAS) will show whether it works with this React Native version; if it does not, the check is skipped by design and the dependency should be replaced or removed.

## D-099 — Photo fields are compact rows; the large view is for checking the photo (2026-11-27)

- **Decision:** every photo field in driver registration (Your photo, licence, ID selfie, the three vehicle papers) is one row: a small thumbnail, the name, a one-line hint or "Added", and Add or Retake. Tapping opens a sheet: Take a photo or Choose from library, then the photo shown large once ("Is it clear?") with Use photo or Retake. Tapping a row that already has a photo shows it large with Retake.
- **Why:** the large dashed box pushed the form fields off screen and did no job there. A large image helps only when checking the photo, so that is where it now appears.
- **ID selfie is camera only** (no library), so it is taken at that moment. Enforced in the installed apps; a browser cannot force a live camera. The profile photo and documents keep both options.
- First and last name sit side by side on About you so the step fits on one screen.
- The rider's profile photo already worked this way (a sheet with a preview); unchanged.

## D-100 — Rides run on the server (2026-11-27)

- **Decision:** the API now runs the whole ride: `POST /v1/quotes` (prices worked out on the server from the route), `POST /v1/rides` (Quick Match or Negotiate, always from a stored quote, never a fare in the request), driver presence and position, requests sent to the nearest online approved drivers of the right vehicle type, accept / counter / raise / choose, arrive, start with the rider's 4 digit PIN, end, pay the driver (bank transfer or cash, confirmed by the driver), ratings, history, and a staff list with a reasoned cancel. Migration 0009.
- **Races are decided by the database** (one active ride per driver, one open ride per rider): two drivers accepting at once gives exactly one winner.
- **News by asking, not pushing:** apps read `GET /v1/rides/{id}` every few seconds. No extra realtime service to run or pay for. A search that runs out ends as "no drivers" when anyone reads it, and the worker's `rides.sweep` covers rides nobody is watching.
- **Privacy:** a driver sees the rider's first name and rating only; a rider sees the driver's first name, rating, vehicle and approved photo. No phone numbers either way. Only the latest driver position is kept (no location history). Staff do not see the PIN or the payout account.
- **Exceptions to "every write takes an Idempotency-Key":** `PUT /v1/drivers/me/presence` and `PUT /v1/drivers/me/location` overwrite one row and are safe to repeat, so they take none. Location is sent every few seconds and is not audited.
- **Switches (all off):** `RIDE_CASH_ENABLED`, `DRIVER_PASS_REQUIRED` (a driver needs a pass to go online; off until passes can be bought), `WALLET_ENABLED`.
- **Still placeholders:** prices use `MOCK_PRICING_CONFIG`; the route comes from the stand-in maps provider (straight line, labelled `estimated`) until a real maps key is set; city boxes are generous rectangles.

## D-101 — Money is built and switched off (2026-11-27)

- **Decision:** the ledger, wallet, payments in, payouts and refunds are built and tested (migration 0010), and every route that moves money answers "not connected" until `WALLET_ENABLED=true` **and** a payment provider is configured. This supersedes "not built" in BACKEND_ARCHITECTURE §9; the four reviews there (finance, reconciliation, provider test mode, security) are still required before switching on. Steps: `docs/PAYMENTS_GO_LIVE.md`.
- **What the database guarantees:** journals and entries are append-only; a journal that does not add up to zero cannot be committed; the same provider reference cannot be posted twice; a person's balance cannot go below zero.
- **Payments in:** credited only after our own lookup with the provider says "successful" for the exact amount in NGN. A webhook only triggers the lookup. A mismatch is not credited and goes to finance (`collection.needs_review`). Card details are typed only on the provider's page (D-093).
- **Paying a trip from the wallet:** fare from the rider's wallet to the driver's earnings, one journal per ride (0% commission, D-024).
- **Withdrawals:** money is set aside at once, a member of staff approves (never their own), the transfer is marked "submitted" before the provider is called, and the same reference is never sent as a new transfer. Unknown outcome means look it up.
- **Refunds:** asked by one member of staff, approved by a different one; posted as a cost to GoBye (`promotions_expense`). Whether a driver is ever charged back is a policy question still open.
- **Provider:** a Paystack adapter exists, written from Paystack's public documentation and run only against a stand-in server. It has not touched Paystack. Choosing Paystack or another provider is still the owner's decision; another provider is one adapter.
- **Fees:** GoBye charges none yet and absorbs the provider's charge (recorded separately as `processing_costs`). Fee schedules from `packages/core/src/gateway/fees.ts` are not wired to the server.

## D-102 — The main button is the website's tangerine call to action (2026-11-27)

- **Decision (owner):** the primary button in the rider and driver apps matches the website: a soft tangerine gradient, a warm glow and a dark label. The white arrow chip was tried and removed the same day (owner). This replaces the black primary button and the earlier "no gradient or glow" note of 2026-10-22. Disabled stays neutral grey. Selected tiles and small "Add" pills stay black.
- One component (`Button` in `@gobye/ui`); `primary` and `brand` are now the same.

## D-103 — Outside services are connected in code and wait for keys (2026-11-27)

- **Decision:** each outside service has an adapter behind the existing ports, off by default, switched on by setting its key in the server's secret store (`apps/api/.env.example` lists the names):
  - **Maps:** Google Maps Platform through a server key (`MAPS_PROVIDER=google`). The apps ask our server for places and prices, so no maps key for search ships in an app.
  - **Push:** Expo push (free). **Email:** Resend. **SMS:** Termii (Nigerian numbers only, transactional route).
  - **Sign-in codes by SMS:** Supabase Auth's "Send SMS" hook calls `POST /v1/webhooks/auth/send-sms`, signed; we pass the code to the SMS provider and never log or store it.
  - **Identity:** QoreID NIN face match. The result is stored in `app.identity_checks` and shown on the driver's application (D-067). It never approves a driver by itself, and the selfie is only shared after our own file check clears it.
- **Notifications** are queued in the same transaction as the change they describe (`ops.notifications`, one row per message, no text stored). Ride steps send a push; a paid trip sends an emailed receipt.
- **Receipts by email (owner):** on by default, a switch in notification settings (`PATCH /v1/me/notifications`), and only ever sent to an address the sign-in service has confirmed.
- **Not run against the real services.** Each adapter is written from the provider's public documentation and tested against a stand-in. QoreID's token call in particular needs confirming with test credentials. Which SMS, email and identity providers to pay for is still the owner's choice: another provider is one adapter.

## D-104 — The apps' ride code for the server exists; the screens still use the demo connection (2026-11-27)

- **Decision:** `packages/core/src/server/rides.ts` holds the typed calls both apps make and the rider's booking services (prices, matching, live trip, choose, cancel, pay, rate) on the same interfaces the simulated and demo versions use. They are tested end to end against the API with the real client code (`apps/api/test/app-services.test.ts`).
- **Not done:** the rider and driver apps' state (booking and driver screens) still talks to the demo connection. Switching them over changes how the PIN reaches each side (the server makes it; the driver types it) and needs a deployed API and real phones to verify. That is the one piece of app code still to do before rides run on the server in the apps.

## D-105 — Security review of 2026-11-27 (see docs/SECURITY_REVIEW.md)

- Every route is now checked by tests for sign-in, staff access, error leaks and idempotency; the gateway checks itself against the API's route list.
- Fixed: gateway did not route `/v1/staff/*` and the new areas; a per-person limit on price requests; a 24 hour hold on withdrawals after a bank account change; account deletion refused while money or a ride is outstanding; the admin's router updated for published advisories.
- Staff ride and finance routes live under `/v1/ops/*` (the gateway refuses `/v1/admin/*` on purpose).
- **Follow-ups the same day (owner):** a button that moves money says the verb and the amount as one phrase, the amount a little heavier: "Add ₦5,000", "Pay ₦2,500" (`title` + `trailingText` on `Button`). No box around the amount (tried, read as a button inside a button). "Continue" is only for a plain next step; with nothing chosen the button says what to do ("Choose an amount"). Tab pages (Activities, Account) no longer repeat the tab's name as a page title, and Delete account shows its question once.

## D-106 — Wording rules for the apps (2026-11-27)

- **Rules (owner):** (1) a button says what happens next in the person's words ("Add ₦5,000", "Rate driver", "Send request"), never "Submit", and "Continue" only for a plain next step; (2) one word for one thing everywhere ("Try again", "Sign out", "Check again", "Done" for a finished task and "Close" for just looking); (3) everyday words, not system words ("Vibration", "Notifications", "Add more money"); (4) when something goes wrong say what happened, then what to do, starting with "We couldn’t…" and never blaming the person; (5) an empty screen says what will appear and offers the next step.
- **Kept:** "Quick Match" and "Negotiate" are product names, each with a plain line under it. "Preview" and "simulated" labels stay in test builds.
- Applied across the rider and driver apps (buttons, titles, labels, error and empty messages). New wording follows these rules; check near-duplicates before adding a new phrase.

## D-107 — Riders see the driver's photo; drivers can change it; a receipts switch (2026-11-28)

- **Driver photo to the rider:** the driver's phone makes a small copy of the profile photo (about 128 px, a few KB, `photoThumb`) and it travels with the ride over the demo connection, so the rider sees the driver's face on the trip screens and receipt. This is for the prototype: on the server the rider gets a short-lived link to the staff-approved photo instead (D-100), and the small copy is never sent to the server.
- **Changing the photo:** Account, tap the photo, same capture, face check and review as registration. It doesn't reopen the application. On the server a new photo will need staff approval before riders see it.
- **Email my receipts:** a switch under Account, Notifications (on by default). Saved on the phone for now; it takes effect when email is connected (`PATCH /v1/me/notifications`).
- New dependency in the driver app: `expo-image-manipulator` (Expo, MIT).

## D-108 — Messages between rider and driver; car colour picked from a list and shown on the car (2026-11-28)

- **Messages (owner):** during a ride the rider and driver can message each other: one-tap messages for what people usually say at pickup ("I’ve arrived", "Where are you?"), plus free text up to 300 characters. A message that arrives while the conversation is closed shows as a notice. Neither side sees the other's phone number. In the prototype the messages travel over the demo connection (the shared activity table, type `chat`, kept out of the admin feed); rules in `packages/core/src/relay/chat.ts`, the sheet is `ChatSheet` in `@gobye/ui`. On the server this needs its own table with a retention period and staff access for safety reports: not built yet.
- **Calls:** not connected. A call through one shared number that hides both people's numbers needs a telephony provider (paid, owner decision). Until then the Call button says so and points to messages. The apps never dial the other person's real number.
- **Car colour (owner):** drivers pick the colour from twelve swatches instead of typing it, with a live preview. The rider's screens show the car picture in that colour (`carArt`, `VEHICLE_COLOURS` in `@gobye/ui`). The pictures are made from the white render by `tools/tint-cars.py`; only the paint changes. The picture is still a generic saloon, not the driver's real make or shape, so the text (colour, make, model, plate) remains what riders should match.

