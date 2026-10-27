# GoBye — Test Plan

**Scope:** Phase 8 of the master brief (functionality, platform behaviour, accessibility, reliability), applied to the Rider (`R01`–`R28`) and Driver (`D01`–`D17`) screens in `SCREEN_INVENTORY.md`, the business rules in `BUSINESS_RULES.md` (`BR-xxx`) and the platform rules in `IOS_GUIDELINES.md` / `ANDROID_GUIDELINES.md`.
**Rule:** status starts as `Not run`. Update it only with real results: `Pass`, `Fail (BUG-id)` or `Blocked (reason)`, plus the date. Never record device results that were not executed (`DEVICE_TEST_MATRIX.md`).

## 1. Test types and tooling

| Type | Code | Tool | Where | How to run |
|---|---|---|---|---|
| Unit (domain) | **AU** | Jest (Node) | `packages/core/src/**/__tests__/*.test.ts` | `npm test --workspace packages/core` |
| Component | **AC** | Jest + `jest-expo` preset + `@testing-library/react-native` 14 | `packages/ui/src/**/__tests__/*.test.tsx`, `apps/*/src/**/__tests__/*.test.tsx` | `npm test --workspace apps/rider` (etc.) |
| Screen (integration, mocked services) | **AS** | same as AC, rendering a feature component with `createMockServices()` | `apps/*/src/features/**/__tests__` | same |
| Manual | **M** | Expo Go (Rider) / development build (Driver) on devices in `DEVICE_TEST_MATRIX.md` | — | per script below |

Setup gaps as of 2026-10-21:
- `packages/core/package.json` has no `test` script or Jest config yet. Add `jest` + `ts-jest` or `babel-jest` **[tooling choice open]**.
- `packages/ui` has no test setup.
- `apps/rider` has `jest` 30.5.2, `jest-expo` ~57.0.6 and `@testing-library/react-native` ^14.1.0 with `"test": "jest"`, but no `jest` preset config yet.
- `apps/driver` has not been checked for test setup.
- No E2E automation tool is selected (Maestro or Detox would need a decision). E2E is manual for now.

Run `npm run typecheck` and `npx expo lint` alongside the tests (AGENTS.md).

## 2. Unit tests — `@gobye/core` (automated)

| ID | Area | Cases | Rules | Status |
|---|---|---|---|---|
| T-AU-001 | Money | `formatNaira`: whole (`₦3,450`), fractional (`₦3,450.50`), 0, large, negative rejected; kobo integer-only guard | BR-001, BR-003 | Pass 2026-10-21 (negatives are formatted as −₦ for wallet debits rather than rejected) |
| T-AU-002 | Rounding | Round **up** to step ₦50: exact, +1 kobo, below step | BR-002 | Pass 2026-10-21 |
| T-AU-003 | Suggested fare | Formula per category; minimum fare floor; multiplier 1.0; multiplier >1 flagged for display | BR-020, BR-021 | Pass 2026-10-21 |
| T-AU-004 | Fare breakdown | Components sum to total after rounding | BR-023 | Pass 2026-10-21 |
| T-AU-005 | Quote expiry | Valid at 4:59, expired at 5:00 (derived from `expiresAt <= now`) | BR-022 | Pass 2026-10-21 |
| T-AU-006 | Negotiation range | min = max(minFare, 75%), max = 150%, rounded; boundary values in/out | BR-040 | Pass 2026-10-21 |
| T-AU-007 | Offer validation | Step ₦50; non-integer and out-of-range rejected with message | BR-041, D-009 | Pass 2026-10-21 |
| T-AU-008 | Offer lifecycle | Expiry at 90 s; raise allowed, lower rejected; raise restarts timer; max 3 rounds | BR-042, BR-048, BR-049 | Pass 2026-10-21 |
| T-AU-009 | Driver responses | Counter ≥ offer and ≤ max; 30 s expiry; one live response per driver (replace) | BR-043–BR-045 | Pass 2026-10-21 |
| T-AU-010 | Selection | Select locks `agreedFare` + driver; others withdrawn; expired response not selectable; unavailable driver → error and back to remaining | BR-046, BR-047 | Pass 2026-10-21 |
| T-AU-011 | No duplicate assignment | Same driver cannot be assigned to two active trips | BR-047 | Pass 2026-10-21 (mock authority) |
| T-AU-012 | Booking reducer — legal transitions | Every legal edge in `UI_STATES.md` (quoting → quoted → submitting → searching/negotiating → matched → driver_en_route → driver_arrived → in_progress → completed / payment_pending) | BR-031, BR-090 | Pass 2026-10-21 (main paths; not every edge) |
| T-AU-013 | Booking reducer — illegal transitions | Each illegal event returns unchanged state + error flag (exhaustive table test) | ARCHITECTURE §2.4 | Partial 2026-10-21 (representative illegal events only) |
| T-AU-014 | Duplicate submission | Second `SUBMIT` while submitting is ignored; idempotency key per attempt | BR-033 | Pass 2026-10-21 |
| T-AU-015 | Cancellation fee | Free before match and ≤ 2 min after; fee after window or after 5 min wait; fee known before confirm | BR-080, BR-081 | Pass 2026-10-21 — found & fixed BUG-001 |
| T-AU-016 | Trip start guard | Cannot start before `driver_arrived` + passenger confirmed | BR-090 | Partial 2026-10-21 (legal path only) |
| T-AU-017 | Earnings preview | fare − commission labelled estimated. *(Revised 2026-10-21: commission 0% (D-024) → earnings = full fare; a non-zero rate is still exercised to prove the formula.)* | BR-060, BR-061 | Pass 2026-10-21 |
| T-AU-018 | Driver eligibility | Each BR-070 condition false → ineligible; expired documents | BR-070, BR-071 | Not run (eligibility is backend-owned; no client function) |
| T-AU-019 | Validators | `validateNigerianPhone` (+234 / 0-prefixed / invalid), `validateOtp` (6 digits; `000000` fails in mock), `validateName` | D-008, D-009 | Pass 2026-10-21 |
| T-AU-020 | Rating | 1–5; comment ≤ 300; < 3 requires reason | BR-111 | Partial 2026-10-21 (comment length; reasons enforced in UI) |
| T-AU-021 | Payment failure | Failed charge → `payment_pending`; retry / switch method (`SET_PAYMENT`) resolves *(was "switch to cash"; cash disabled 2026-10-21)* | BR-103 | Pass 2026-10-21 |
| T-AU-022 | Mock services | Latency in range; `MOCK_FLAGS` failure rates honoured; every result `isSimulated: true` | ARCHITECTURE §5 | Partial 2026-10-21 (isSimulated, response ranges, unsubscribe; latency not asserted) |
| T-AU-023 | Booking persistence | Serialize/restore active booking round-trips; corrupt JSON → safe reset | ARCHITECTURE §4 | Not run (restore path covered at integration level by T-INT-006; corrupt-JSON case still not run) |
| T-AU-024 | Payments & driver packages (`payments-driver.test.ts`) | Launch methods wallet + bank transfer, cash disabled; 0% commission (earnings = full fare); processing fee separate from fare; percent, cap and bearer rules; `walletCovers` on total; provisional daily/monthly packages; `subscribe` activates, expires and extends from current expiry; `hasActiveAccess` | BR-060, BR-062, BR-072, BR-100, BR-105, BR-106 | Pass 2026-10-21 |
| T-AU-025 | Driver location session (`payments-driver.test.ts`) | No tracking offline; `GO_ONLINE` only with When In Use + precise + access (errors otherwise); Always not required; update profile by activity; tracking through pickup/trip and `finish_trip_first`; stale positions pause matching; permission loss / interruption pause matching; low accuracy flagged | BR-073, D-026 | Pass 2026-10-21 |

## 3. Component tests — `@gobye/ui` and app components (automated)

| ID | Component | Assertions | Status |
|---|---|---|---|
| T-AC-001 | `Icon` | Renders a mapped MingCute component per semantic name; regular vs filled variant; decorative by default (hidden from accessibility); unknown name fails type-check | Pass 2026-10-21 |
| T-AC-002 | `Button` | `accessibilityRole="button"`; label; disabled state sets `accessibilityState.disabled` and blocks `onPress`; loading state blocks repeat presses | Pass 2026-10-21 |
| T-AC-003 | `IconButton` | Requires `accessibilityLabel`; min hit area ≥ 44pt / 48dp (style + `hitSlop`) | Partial 2026-10-21 (label asserted; hit area not measured) |
| T-AC-004 | `TextField` | Label associated; error message announced; `keyboardType`/`autoComplete` props passed | Pass 2026-10-21 |
| T-AC-005 | `OtpField` | Accepts paste of 6 digits; `oneTimeCode` / `sms-otp`; resend cooldown text | Not run |
| T-AC-006 | `SearchField` | Placeholder "Where are you going?"; clear button labelled | Not run |
| T-AC-007 | `MapSheet` | Exposes expand/collapse accessibility actions; reduce motion → no spring | Not run |
| T-AC-008 | `VehicleCard` | Selected state via `accessibilityState.selected` (not colour only); unavailable shows reason, disabled | Not run |
| T-AC-009 | `FareCard` | Shows ₦ total + breakdown; multiplier notice when > 1; "Simulated" label | Not run |
| T-AC-010 | `FareStepper` | ± by ₦50; clamps to range; adjustable role with value text | Not run |
| T-AC-011 | `DriverResponseCard` | Countdown text; expired state not selectable; label includes driver, fare, ETA | Not run |
| T-AC-012 | `SegmentedControl` (Quick Match / Negotiate) | Tab/radio semantics; selected state | Not run |
| T-AC-013 | Tab bar | 3 Rider tabs with labels; active uses filled icon; `accessibilityState.selected` | Not run |
| T-AC-014 | `EmptyState`, `Toast`, loading skeleton | Text present; toast announced | Not run |
| T-AC-015 | Theme | Light/dark tokens chosen by `useColorScheme`; text/background pairs meet 4.5:1 (token contrast test) | Not run |

## 4. Screen tests (automated, mocked services)

| ID | Screen | States covered | Status |
|---|---|---|---|
| T-AS-001 | R03 Phone | default, invalid, submitting (button disabled), error | Not run |
| T-AS-002 | R04 OTP | invalid, submitting, error, resend cooldown | Not run |
| T-AS-003 | R06 Location pre-permission | granted → Home; denied → manual entry; restricted | Not run |
| T-AS-004 | R07 Home | loading location, located, permission denied, offline | Not run |
| T-AS-005 | R08 Search | empty, typing, results, no results, error | Not run |
| T-AS-006 | R09 Ride options | quoting, quoted, quote expired → refresh, category unavailable, error | Not run |
| T-AS-007 | R11 Negotiate | composing, invalid, open, responses, response expired, offer expired, driver unavailable, max rounds | Not run |
| T-AS-008 | R12 Searching | searching, timeout 60 s → retry/negotiate/cancel, error | Not run |
| T-AS-009 | R13 Active trip | en route, arrived, in progress, cancel with fee notice | Not run |
| T-AS-010 | R14 Payment result | processing, paid, failed → try again / use another method; bank transfer: awaiting (details), checking, not received → check again, switch to wallet *(cash option removed 2026-10-21)* | Not run (bank-transfer path partly covered by T-INT-005) |
| T-AS-011 | R16 Rate | low rating requires reason; skip | Not run |
| T-AS-012 | R17 Activity | loading, empty, list | Not run |
| T-AS-013 | R28 Delete account | confirm required; requested state | Not run |
| T-AS-014 | D08 Verification status | pending, approved, rejected | Not run |
| T-AS-015 | D09/D10 Go online | foreground missing → request (When In Use, no Always); approximate → precise required; no access package → buy prompt; tracking-issue banners pause requests (D-026) | Not run (Driver UI not built; logic covered by T-AU-025) |
| T-AS-016 | D11/D12 Requests | accept, counter (validated), decline, expiry | Not run |
| T-AS-017 | D13/D14 Trip | arrived → confirm passenger → start → complete; earnings "Estimated" | Not run |

## 5. Navigation (manual unless noted)

| ID | Test | Platform | Type | Status |
|---|---|---|---|---|
| T-NAV-001 | Launch gate redirects by session (none → onboarding/sign-in; signed in → tabs; active booking → trip) | Both | AS (automated) | Not run |
| T-NAV-002 | Tab switching keeps each tab's stack | Both | M | Not run |
| T-NAV-003 | iOS edge swipe-back on every pushed screen; disabled only where cancel confirmation is needed | iOS | M | Not run |
| T-NAV-004 | Android system back (gesture and 3-button) on every screen per `ANDROID_GUIDELINES.md` §2 | Android | M | Not run |
| T-NAV-005 | Back on R11 (offer open), R12, R13, D13 shows confirmation; second confirm leaves | Both | M | Not run |
| T-NAV-006 | Modals (R08, R10) dismiss via swipe-down (iOS) and back (Android) | Both | M | Not run |
| T-NAV-007 | Deep link / typed route to `receipt/[id]`, `ride/[id]` with invalid id → error state | Both | AS + M | Not run |
| T-NAV-008 | Predictive back animation behaviour matches the `predictiveBackGestureEnabled` decision (AND-01) | Android 16 | M | Not run |

## 6. Platform behaviour (manual)

| ID | Test | Status |
|---|---|---|
| T-PLAT-001 | Safe areas: notch, Dynamic Island, Home indicator, Android cutout; no control under system UI | Not run |
| T-PLAT-002 | Edge-to-edge on Android 15/16: map under bars, controls inside insets, gesture area clear of sheet handle | Not run |
| T-PLAT-003 | Status bar icon contrast in light/dark and over map | Not run |
| T-PLAT-004 | Keyboard: every form keeps field and primary button visible; dismiss behaviour; OTP autofill (iOS + Android) | Not run |
| T-PLAT-005 | Permission prompts: none at first launch; Rider When-In-Use only; Driver When In Use + precise at D10, **never Always** (D-026), Android background only if proven required; notifications in context | Not run |
| T-PLAT-006 | Approximate location (iOS 14+, Android 12+): manual path and temporary precise request | Not run |
| T-PLAT-007 | Driver background: updates continue with screen locked; iOS blue indicator/pill; Android FGS notification; stops on go-offline; killed / revoked / precise off / interrupted behaviour per `DEVICE_TEST_MATRIX.md` PD9–PD21 | Not run |
| T-PLAT-012 | Pickup accuracy and ETA validation in Abuja and Lagos with the proposed Google Maps Platform setup; Google attribution visible (`DEVICE_TEST_MATRIX.md` PA1–PA12) | Not run |
| T-PLAT-008 | Orientation locked to portrait; small (SE, 4.7") and large (Pro Max, foldable/tablet) layouts | Not run |
| T-PLAT-009 | Dark mode follows system; switching while app open updates UI | Not run |
| T-PLAT-010 | Haptics fire on key state changes and respect the in-app toggle (R27) | Not run |
| T-PLAT-011 | Rider manifest/Info.plist contain no background location (`ACCESS_BACKGROUND_LOCATION`, `UIBackgroundModes: location`) — inspect prebuild output | Not run |

## 7. Accessibility (manual, plus automated where noted)

| ID | Test | Status |
|---|---|---|
| T-A11Y-001 | VoiceOver full Rider booking (Quick Match and Negotiate) without sight | Not run |
| T-A11Y-002 | TalkBack full Rider booking and Driver go-online → trip | Not run |
| T-A11Y-003 | Font scaling: iOS AX5 and Android max; no clipped primary actions or overlapping text | Not run |
| T-A11Y-004 | Colour contrast of all token pairs (automated T-AC-015) plus on-device spot checks over map | Not run |
| T-A11Y-005 | Touch targets ≥ 44pt (iOS) / 48dp (Android) — automated style checks (T-AC-003) + Accessibility Inspector / Accessibility Scanner | Not run |
| T-A11Y-006 | Focus order follows visual order; focus moves to sheet/modals when opened and returns on close | Not run |
| T-A11Y-007 | Reduce Motion / Remove animations: pulse and sheet springs replaced by fades or instant changes | Not run |
| T-A11Y-008 | Timers announced at expiry, not every tick; information never conveyed by colour alone | Not run |
| T-A11Y-009 | Decorative icons not announced; icon-only buttons have labels (automated T-AC-001/003) | Not run |

## 8. Reliability

| ID | Test | Type | Status |
|---|---|---|---|
| T-REL-001 | Loading states shown for every async call (skeletons/progress) | AS | Not run |
| T-REL-002 | Offline at launch / mid-flow per `DEVICE_TEST_MATRIX.md` N1–N8 | M | Not run |
| T-REL-003 | Mock API errors via `MOCK_FLAGS` on quote, search, match, payment → error UI with retry | AS | Not run |
| T-REL-004 | Retries do not duplicate bookings or charges | AU (T-AU-014) + AS | Not run |
| T-REL-005 | Stale offers/responses/quotes after background → shown expired immediately on resume | AU (T-AU-005/008/009) + M | Not run |
| T-REL-006 | Rapid double-tap on Book / Send offer / Select → single action | AS + M | Not run |
| T-REL-007 | Background → foreground during search, negotiation, trip | M | Not run |
| T-REL-008 | Kill and reopen app during active booking → restored (`gobye.activeBooking`) | AS (T-AU-023) + M | Not run |
| T-REL-009 | Session token survives restart (`expo-secure-store`); sign-out clears token, booking and Driver background task | M | Not run |
| T-REL-010 | Low-end Android (A1): map + sheet animation acceptable; no ANR | M | Not run |

## 9. End-to-end scripts (manual)

| ID | Script | Devices | Status |
|---|---|---|---|
| T-E2E-001 | New Rider: install → onboarding → phone/OTP → name → location permission → Home | I1, A1, A7 | Not run |
| T-E2E-002 | Quick Match: destination → options → book → searching → driver en route → arrived → in progress → completed → payment → receipt → rate | I3, A5 | Not run |
| T-E2E-003 | Negotiate: offer → expiry → raise → responses (one expires) → select → driver unavailable → select another → trip | I3, A5 | Not run |
| T-E2E-004 | Cancellation: free cancel before match; cancel after window shows fee before confirm | I3, A5 | Not run |
| T-E2E-005 | Payment failure → retry → switch method *(was "switch to cash"; revised 2026-10-21)*; bank transfer → I've sent the transfer → not received → check again → paid; switch to wallet | I3, A5 | Not run |
| T-E2E-006 | Location denied → manual pickup → complete booking | I1, A3 | Not run |
| T-E2E-007 | Delete account from Account (R28) | I4, A7 | Not run |
| T-E2E-008 | Driver: sign-in → onboarding docs → pending → approved (mock) → go online (background explanation) → Quick Match request → trip → complete → earnings | I4, A5, A7 (Dev build) | Not run |
| T-E2E-009 | Driver negotiation: counteroffer accepted by rider; decline; expiry | I4, A7 (Dev build) | Not run |
| T-E2E-010 | Rider + Driver against the future backend (both apps live) | — | Blocked (no backend) |

## 10. Exit criteria for a TestFlight / internal-testing build

- All T-AU and T-AC tests pass in CI, `npm run typecheck` is clean and `npx expo lint` is clean.
- T-E2E-001…009 pass on at least one small iPhone, one large iPhone, one Android ≤ 10 and one Android 15/16 device.
- T-A11Y-001/002/003 pass on one device per platform.
- Results are recorded here and in `DEVICE_TEST_MATRIX.md`.


## Execution log

| Date | Command | Result |
|---|---|---|
| 2026-10-21 | `npm test` (root) → `packages/core` Jest | 3 suites, **59 tests passed** |
| 2026-10-21 | `npm test` (root) → `apps/rider` Jest (jest-expo + RNTL 14) | 2 suites, **12 tests passed** |
| 2026-10-21 | `npm run typecheck` (root, all 4 workspaces) | 0 errors |
| 2026-10-21 | `npx expo export --platform android --platform ios` (rider), `--platform android` (driver) | Bundles built (Hermes) |
| 2026-10-21 (later, after payments / driver-location changes) | `npm test` → `packages/core` Jest | **74 tests passed** (incl. new payments + driver location tests, T-AU-024/025) |
| 2026-10-21 (later) | `npm test` → `apps/rider` Jest | **14 tests passed** (incl. T-INT-005 bank transfer, T-INT-006 state recovery) |

### Automated integration tests added (2026-10-21)

| ID | Test | Status |
|---|---|---|
| T-INT-001 | Quick Match: book → searching → matched → arrived → in progress → paid → `finish()` → receipt in history (real providers, mock services, fake timers) | Pass 2026-10-21 |
| T-INT-002 | Negotiate: out-of-range offer rejected → offer sent → responses collected → selection locks fare & driver | Pass 2026-10-21 |
| T-INT-003 | Cancel before match: no fee, booking cleared | Pass 2026-10-21 |
| T-INT-004 | No drivers → quote expires → `rebook('quick_match')` refreshes quote and searches again | Pass 2026-10-21 |
| T-INT-005 | Bank transfer: trip ends → waits for the passenger to confirm the transfer (no charge before) → charges fare + separately disclosed processing fee | Pass 2026-10-21 |
| T-INT-006 | State recovery: an active ride is restored after the app restarts (persisted booking re-hydrated) | Pass 2026-10-21 |
| T-UI-ICONS | Every registered MingCute icon renders in Regular and Filled | Pass 2026-10-21 |

### Bugs found by tests and review

| ID | Found by | Description | Status |
|---|---|---|---|
| BUG-001 | T-AU-015 | `passengerCancellationFee` treated `matchedAt = 0` as "not matched" (falsy check) | Fixed 2026-10-21 |
| BUG-002 | Independent code review | Options screen left mounted under the trip; its guard called `router.back()` and popped the Rate screen | Fixed 2026-10-21 (replace navigation + focus-aware guard) |
| BUG-003 | Review | "Change destination" from Options stacked a second Options | Fixed 2026-10-21 |
| BUG-004 | Review | MapSheet content below the visible snap height (Book button) was off-screen | Fixed 2026-10-21 (animated bottom padding) |
| BUG-005 | Review | Android back from payment left a `payment_pending` booking that blocked new bookings | Fixed 2026-10-21 (back blocked on payment screen) |
| BUG-006 | Review | Android back from Home returned to sign-in | Fixed 2026-10-21 (`resetTo` after auth) |
| BUG-007 | Review | Negotiate → "Quick Match" could strand the user; expired quote not refreshed on retry | Fixed 2026-10-21 (`rebook`) |
| BUG-008 | Review | Cancel/finish stacked extra Home screens | Fixed 2026-10-21 (`resetTo`) |
| BUG-009 | Review | Live regions on countdown/ETA re-announced every second (TalkBack) | Fixed 2026-10-21 |
| BUG-010 | Review | Back handler re-registered on every render | Fixed 2026-10-21 (ref) |
| BUG-011 | Review | Rating from a receipt stacked a duplicate receipt | Fixed 2026-10-21 |
| BUG-012 | Review | Payment idempotency key reset after relaunch | Fixed 2026-10-21 (`paymentAttempts` persisted on booking) |
| BUG-013 | T-INT-006 (found 2026-10-21) | Integration tests leaked persisted bookings between tests (state recovery restored the previous ride) | Fixed 2026-10-21 (storage cleared per test) |

Not yet executed: any device/emulator test, VoiceOver/TalkBack walkthroughs, font-scaling and contrast audits on device (`DEVICE_TEST_MATRIX.md`).
| 2026-10-21 (after brand-pack integration) | `npm test` (root) | core **74 passed**; rider **17 passed** (adds wordmark, palette-direction and illustration tests) |
| 2026-10-21 | `npm run typecheck` (root) | 0 errors |
| 2026-10-21 | `npx expo export` rider (iOS + Android), driver (Android) | Bundles built; brand assets bundled (~295 KB) |

### UI update brief (2026-10-21, later)

| Date | Command | Result |
|---|---|---|
| 2026-10-21 | `npm run typecheck` (all 4 workspaces) | 0 errors |
| 2026-10-21 | `npm test` → `packages/core` | **84 passed** (new: one enabled category, PIN, ETA progress/stale, wallet summary, deposits pending until confirmed, idempotent wallet debit, unseen transfer = not received) |
| 2026-10-21 | `npm test` → `apps/rider` | **21 passed** (booking flow rewritten for payment-after-trip; duplicate confirm rejected; low wallet → switch to transfer; transfer not received stays pending; wallet deposit state) |
| 2026-10-21 | `npx expo export` rider (iOS + Android), driver (Android) | Bundles built |
| 2026-10-21 | Independent code review (separate agent) | 16 findings; all HIGH/MEDIUM fixed (double debit after restart, receipt lost after restart, stale fare after pickup change, trapped on unpaid trip, booking while unpaid, passenger lost, deposit re-check, profile save after restart, transfer "failed" vs pending) |

**Not executed:** any run on a real device or simulator. The brief asks for device verification of navigation, appearance persistence, editable pickup, profile-photo changes, payment states and the single car category — these rows are open in `DEVICE_TEST_MATRIX.md`.

### Driver app end to end (2026-10-22)

| Date | Command | Result |
|---|---|---|
| 2026-10-22 | `npm run typecheck` (all 4 workspaces) | 0 errors |
| 2026-10-22 | `npm test` → core / rider / driver | **120** / **24** / **2** passed (new `driver.test.ts`: onboarding validation and order, requests, counters, trip stages, PIN lock, no-show timing, earnings) |
| 2026-10-22 | `npx expo export --platform android --platform ios` rider and driver | Bundles built |
| 2026-10-22 | Driver web QA build, Playwright walk-through at 390×844, light and dark | Sign-up, approval, pass, online, request (Quick Match and negotiation), PIN, end trip, payment, tabs all pass; no console errors. Not device-tested. |

### Driver accounts, welcome and trip statement (2026-10-22, D-048)

| Date | Check | Result |
|---|---|---|
| 2026-10-22 | `npm run typecheck` (core, ui, rider, driver) | Pass |
| 2026-10-22 | `npm test` → core / rider / driver | **138** / **34** / **8** passed (new driver `auth-and-statement.test.tsx`: four-step sign up with launch cities and live password rules, two-step sign in with a neutral error, profile kept after verification, earnings statement, cancelled statement, missing trip) |
| 2026-10-22 | `npx expo export --platform android --platform ios` rider and driver | Bundles built |
| 2026-10-22 | Driver web QA, Playwright at 390×844 | Welcome (light and dark), sign up → code → driver pass → registration with About you done, approval, trips, statement (completed and cancelled), sign in → code all pass. Not device-tested. |

### Connected demo and driver verification card (2026-10-22, D-049)

| Date | Check | Result |
|---|---|---|
| 2026-10-22 | `npm run typecheck` (core, ui, rider, driver, admin) | Pass |
| 2026-10-22 | `npm test` → core / rider / driver / admin | **149** / **36** / **14** / admin vitest all files pass (new: relay client and rides, verification rules, rider relay sync, driver card states and relay application flow, admin demo logic) |
| 2026-10-22 | Rider and driver `npx expo export --platform android --platform ios`; `npm run admin:build` | Built |
| 2026-10-22 | Three-app walk in Chromium against one local relay (rider web, driver web, admin web) | Driver sign-up → card → submit → admin request changes → driver fix and resubmit → admin approve → pass → online → rider sign-up and Quick Match → driver accepts the real request → PIN from the rider → arrived / trip / complete synced both ways → rider pays → driver sees Received → admin rides and activity feed. All passed. Not device-tested; phones on Wi-Fi still to be tried. |

### Infrastructure foundation (2026-10-23, D-051)

| Date | Check | Result |
|---|---|---|
| 2026-10-23 | `npm run typecheck` | 0 errors (core, ui, rider, driver, admin, infra/cloudflare) |
| 2026-10-23 | `npm test` | core **215**, rider **36**, driver **14**, admin **250**, infra/cloudflare **41** passed |
| 2026-10-23 | Website and admin in Chromium with the new `vercel.json` headers applied locally | no CSP violations; site, video, waitlist dialog work |

Per-case mapping and what still needs staging: `INFRASTRUCTURE_TEST_PLAN.md`.
| 2026-10-23 | Admin redesign: `npm run typecheck`; `npm test`; `vite build` (admin) | 0 errors; core 215, rider 36, driver 14, admin **263**, infra/cloudflare 41 passed; build OK |
| 2026-10-23 | Admin redesign in Chromium: 32 routes × 1440/1024/768/375 × light/dark (`tools/qa-web/admin-shots.cjs`), plus search, notifications, account menu, rail and phone menu | No sideways scroll, no page errors. Keyboard and screen reader checked in code and by Playwright only; not tested with VoiceOver or NVDA |
| 2026-10-23 | Payments + automation: `npm run typecheck`; `npm test`; driver `expo export` (android, ios) | 0 errors; core **241** (26 new: fee quoting, disclosure, limits, exemptions, versions, approval, credit decision, balanced breakdown, payout guard, webhook dedupe, switching, simulated adapter, registry, retry classes, backoff, protected actions, escalation, no invented fees), rider 36, driver 14, admin **326** (63 new page and action tests), infra 41; export OK |
| 2026-10-23 | Admin Payments (4) and Automation (6) pages at 1440/1024/768/375, light and dark | No sideways scroll, no page errors |
| 2026-10-23 | Premium white redesign: `npm run typecheck`; `npm test` | 0 errors; core **247** (negotiation history, costs), rider 36, driver 14, admin **403** (home and workspace, people and subscriptions, costs and money, automation overview), infra 41 |
| 2026-10-23 | Admin 49 routes × 1440/1024/768/375 (light only; no dark theme) | No sideways scroll, no page errors |
| 2026-10-23 | Pass timeline (D-058): `npm run typecheck`; `npm test`; driver `expo export` (android, ios); admin build | 0 errors; core **265** (`subscriptions.test.ts`, 18: daily to daily, daily to monthly, monthly to daily, multiple queued, simultaneous payments, version conflict, duplicate webhooks, amount mismatch, expiry with trip completion, renewal before and after expiry, refunds, reversal, cancel after use, legacy migration), admin **405** (`subscriptions/logic.test.ts`, 8, incl. admin rows equal the driver response), rider 36, driver 14, infra 41 |
| 2026-10-23 | Admin refund flow in Chromium (open active pass, Refund pass with reason) | Pass shows Refunded, access ends now, driver blocked from new requests, history kept; no page errors |
| 2026-10-23 | Admin phone layout: 49 routes at 320/360/390px, 7 routes at 768/1024/1440px (`tools/qa-web/admin-shots.cjs`) plus a clipped-content scan | No sideways scroll or page errors; top bar, cards, tables, tabs and panels reviewed in screenshots. Not on a physical phone |
| 2026-10-23 | Backend Phase 1: `npm test -w apps/api` (node:test on compiled output, local PostgreSQL 16) | **72 passed** after the independent review fixes: config (10), HTTP conventions + gateway signature (11), auth and permissions (8), migrations and schema (11), pass timeline (8), costs and break-even (6), jobs (10), providers (5), deploy check script (3). Gateway Worker tests (infra) 41, including signature binding to method and path. Without Postgres, the database tests skip with a stated reason |
| 2026-10-23 | API image rehearsal (Docker Hub blocked, so no `docker build`): Dockerfile stages run by hand with the same file allowlist; runtime layout migrated a fresh database, served, ran the worker; `health-check.mjs` | 11/11 checks passed; found and fixed a missing `apps/api/node_modules` copy |
| 2026-10-23 | Role setup SQL on plain PostgreSQL 16 | Runtime role sees 0 rows without `bypassrls`, works with it; cannot create tables; cannot delete audit rows |
| 2026-10-23 | Phase 1.5: `npm run test:ci -w apps/api` (PostgreSQL 16 + PgBouncer 1.22 transaction mode; `REQUIRE_DATABASE_TESTS=1 REQUIRE_POOLER_TESTS=1 STRICT_NO_SKIPS=1`) | **80 passed, 0 skipped** (8 new: no start-up session parameters; roles.sql refuses without passwords and re-runs; role timeouts with nothing sent; pooler refuses `statement_timeout` start-up parameter; 12 transactions over 4 server connections; SET LOCAL does not leak; role timeout cancels at 5 s; rollback leaves no state). Strict runner fails on unreachable DB, missing pooler, any skip, and Node's "not ok but exit 0" suite failures (each checked) |
| 2026-10-23 | Phase 1.5: `npm run typecheck`; `npm run lint`; `npm test` (all workspaces); rider + driver `expo export` (android, ios); admin build | 0 type errors; **0 lint problems**; core 265, admin 405, rider 36, driver 14, infra 41, API 80; exports and build OK |
| 2026-10-23 | Phase 1.5: API image built from `apps/api/Dockerfile` on a **stand-in** Node 22 base (Docker Hub blocked), `apps/api/scripts/docker-smoke.sh` | **15/15**: exit 78 on bad config without secrets; non-root; no sources; no build-only packages; migrate/status/check-runtime from the image; health-check.mjs; HEALTHCHECK healthy; ready 503 without DB; API and worker exit 0 on SIGTERM. Real digest-pinned base: CI job `docker` (first run not observed from here) |
| 2026-10-23 | Phase 1.5: load on the image at 0.5 CPU / 512 MB (50 clients, 20 s, `/health/ready` + `/v1/me` + `/health/live`) | 24,100 requests, ≈1,200 rps, 0 errors, p95 131 ms; memory ≈61 MB stable. Local only: no TLS, no real tokens, no network latency |
| 2026-10-27 | WhatsApp quick booking (D-064): core `whatsapp.test.ts`; API `whatsapp.test.ts` (Postgres, strict); gateway routing; rider `whatsapp-landing.test.tsx` | core 13 (flow, unknown/blocked numbers, outside launch cities, too close/far, quote expiry re-pricing, forged choice, CANCEL rules, open ride, idle reset, parsing, message limits), API 13 (Meta signature, config refusals, Cloud API sender retry rules, verify challenge, bad signature, duplicate delivery, unknown number, full booking + DB rows + audit + notice + cancel, forged reply, stale message, kill switch, cleanup, off → 404), gateway 1, rider 1. Totals: API 93, core 278, admin 405, rider 37, driver 14, infra 42; 0 skipped |
| 2026-10-27 | Local live run: built API + in-process worker + PostgreSQL, `WHATSAPP_PROVIDER=simulated`, `scripts/whatsapp-simulate.mjs` (hi → pickup → destination → tap keke) | 4 webhooks 200; ride `channel=whatsapp, status=searching, keke`; all inbound/send jobs succeeded. Not tested against Meta (no account) |
| 2026-10-27 | `apps/web/open.html` in Chromium (375 px): ride link, signup link, malformed id | Correct `gobye://` targets, no overflow, no page errors |

