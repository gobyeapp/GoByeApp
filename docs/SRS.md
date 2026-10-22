# GoBye — Software Requirements Specification (SRS)

**Status:** Draft, 2026-10-21. Requirements describe intended behaviour; none is marked implemented here (see `SCREEN_INVENTORY.md` and `TEST_PLAN.md` for status). Numeric values come from `BUSINESS_RULES.md` and are **mock placeholders** unless stated otherwise.

Conventions: **Shall** = mandatory for the current phase; **[Backend]** = enforced authoritatively by the future backend, mirrored client-side for UX only. Each requirement has one testable acceptance criterion (AC). Test IDs refer to `TEST_PLAN.md`.

---

## 1. Functional requirements

### 1.1 Authentication & account (FR-AUTH)

| ID | Requirement | Acceptance criterion | Refs |
|---|---|---|---|
| FR-AUTH-001 | The apps shall sign users in with a Nigerian phone number and a 6-digit one-time code only. | No other sign-in option is visible on R03/D02. | D-008 |
| FR-AUTH-002 | The phone field shall accept `+234XXXXXXXXXX`, `234…`, and `0XXXXXXXXXX` (11 digits) and normalise to E.164. | `08031234567` → `+2348031234567`; `0803123` shows "Enter a valid Nigerian phone number". | T-AU-019 |
| FR-AUTH-003 | "Send code" shall be disabled while the number is invalid or a request is in flight. | Double tap produces one `requestOtp` call. | |
| FR-AUTH-004 | The OTP field shall accept exactly 6 digits, support paste and OS autofill (`oneTimeCode` / `sms-otp`). | Pasting `123456` fills all cells; 5 digits keeps Verify disabled. | T-AC-005 |
| FR-AUTH-005 | Resend shall be available only after a cooldown (mock 30 s) with visible countdown. | Resend disabled at 29 s, enabled at 30 s. | |
| FR-AUTH-006 | Wrong code shall show an inline error and clear the field; after the server-defined attempt limit, a lockout message with retry time shall show. | Mock `000000` → "That code is incorrect". | SECURITY §2 |
| FR-AUTH-007 | Access/refresh tokens shall be stored only in `expo-secure-store`. | No token key in AsyncStorage dump. | SECURITY §3 |
| FR-AUTH-008 | New users shall provide first and last name and accept terms and privacy policy (links open). | Continue disabled until names valid and checkbox ticked. | APP_STORE 5.1.1(i) |
| FR-AUTH-009 | Sign-out shall delete tokens, cached profile, active booking cache and personal caches. | After sign-out, relaunch shows sign-in and no prior data. | SECURITY §3 |
| FR-AUTH-010 | Users shall be able to request account deletion in-app (R28, D17) after a screen explaining deleted vs retained data and outstanding balances, with explicit confirmation. | Deletion requires confirm action; success shows "Deletion requested" and signs out. | APP_STORE 5.1.1(v) |
| FR-AUTH-011 | Mock OTP acceptance shall be excluded from production build profiles. | Production profile build rejects any code without backend verification. | SECURITY §2 |
| FR-AUTH-012 | The launch gate shall route: no session → onboarding/sign-in; session + active booking → booking/trip screen; session → tabs. | T-NAV-001 passes for each case. | |

### 1.2 Maps & location (FR-MAP)

| ID | Requirement | Acceptance criterion | Refs |
|---|---|---|---|
| FR-MAP-001 | The Rider app shall request only When In Use location and only after the R06 pre-permission screen's single "Continue" button. | No system prompt before Continue; R06 has exactly one button. | D-012 |
| FR-MAP-002 | If location is denied or restricted, Home and search shall offer manual pickup entry and an "Open Settings" link. | Full booking completes with permission denied. | ALT-01 |
| FR-MAP-003 | If only approximate location is granted, the app shall show "Your location is approximate" and require pickup pin confirmation; it shall request temporary precise access (`pickup` key) where supported. | Quote cannot be requested until pin confirmed. | APP_STORE §4 |
| FR-MAP-004 | The app shall display GPS accuracy (e.g. "GPS accuracy ±35 m") when location is used. | Accuracy text matches `coords.accuracy` rounded. | ARCH §6 |
| FR-MAP-005 | Place search shall return results for queries ≥ 2 characters with debounce, and show empty, typing, results, no-results and error states. | Each state reachable in tests (T-AS-005). | |
| FR-MAP-006 | The rider shall be able to set pickup or destination by dragging a map pin ("Choose on map") with reverse-geocoded label. | Moving pin updates label after reverse geocode. | |
| FR-MAP-007 | The route preview shall draw the polyline and show distance and duration; simulated routes labelled "Simulated". | `isSimulated: true` → label visible. | DATA_MODELS |
| FR-MAP-008 | The map shall remain interactive above the bottom sheet at all non-full snap points. | Pan/zoom works with sheet at collapsed/half. | D-010 |
| FR-MAP-009 | A recenter button shall move the camera to current location (or pickup if permission denied). | Button labelled "Show my location". | |
| FR-MAP-010 | The rider shall see the driver's location only between match and trip completion. | No driver marker before `matched` or after `completed`. | SECURITY §6 |
| FR-MAP-011 | The Rider app shall not collect location while backgrounded. | No location callbacks after app backgrounds (device test). | D-012 |

### 1.3 Fare & quotes (FR-FARE)

| ID | Requirement | Acceptance criterion | Refs |
|---|---|---|---|
| FR-FARE-001 | All money shall be integer kobo in state, services and APIs. | Type `Kobo`; non-integer input rejected by guard. | BR-001, D-006 |
| FR-FARE-002 | Suggested fare = `max(minimumFare, base + perKm×km + perMin×min) × multiplier`, rounded up to ₦50. | Table tests per category pass (T-AU-003). | BR-020, BR-002 |
| FR-FARE-003 | Naira shall display as `₦3,450` (whole) or `₦3,450.50`. | `formatNaira(345000)` = `₦3,450`. | BR-003 |
| FR-FARE-004 | The fare breakdown shall show base, distance, time, multiplier (when ≠ 1.0) and total. | Components visible; total matches quote. | BR-023 |
| FR-FARE-005 | A multiplier > 1.0 shall be shown before booking. | Notice visible on R09 and confirm step. | BR-021 |
| FR-FARE-006 | Quotes expire after 5 min; expired quotes shall block booking until refreshed. | At `expiresAt` Book shows "Refresh price". | BR-022 |
| FR-FARE-007 | Unavailable categories shall be shown disabled with a reason. | Card disabled, reason text, `accessibilityState.disabled`. | BR-010 |
| FR-FARE-008 | Fares shown are advisory; the backend quote is authoritative. **[Backend]** | Client never sends a computed fare as the charge amount; it sends `quoteId`. | D-007 |

### 1.4 Quick Match (FR-QM)

| ID | Requirement | Acceptance criterion | Refs |
|---|---|---|---|
| FR-QM-001 | Quick Match shall book at the suggested fare with no counteroffers. | No offer UI in QM flow. | BR-030 |
| FR-QM-002 | Submitting shall disable Book and send one idempotency key per attempt. | Second tap ignored (T-AU-014). | BR-033 |
| FR-QM-003 | The fare shall be locked on submission (`fareLockedAt`). | Locked fare shown on searching/trip screens. | BR-031 |
| FR-QM-004 | Searching shall time out after 60 s → `no_drivers` with Retry, Try Negotiate, Cancel. | All three actions present after timeout. | BR-032 |
| FR-QM-005 | On match, the rider shall see driver first name, photo/initial, rating, vehicle make/model/colour, plate and ETA. | All fields present; plate in large type. | |
| FR-QM-006 | Searching animation shall respect Reduce Motion. | With Reduce Motion, pulse replaced by static indicator. | NFR-A11Y-007 |

### 1.5 Negotiate (FR-NEG)

| ID | Requirement | Acceptance criterion | Refs |
|---|---|---|---|
| FR-NEG-001 | Offers shall be limited to `[max(minFare, 75%×suggested), 150%×suggested]`, rounded to ₦50. | Boundary tests T-AU-006. | BR-040 |
| FR-NEG-002 | The stepper shall adjust by ₦50 and clamp to range; typed values validated with message. | ₦49 off-step rejected with message. | BR-041 |
| FR-NEG-003 | An offer stays open 90 s with visible countdown; expiry derived from `expiresAt`. | Backgrounding 2 min then resuming shows expired. | BR-042, ARCH §4 |
| FR-NEG-004 | On offer expiry without selection, show Raise, Switch to Quick Match, Cancel. | Three actions present. | BR-042 |
| FR-NEG-005 | Driver responses: Accept (= offer) or Counter (offer ≤ amount ≤ max). Out-of-range counters rejected. **[Backend]** | Driver counter UI cannot submit < offer or > max. | BR-043 |
| FR-NEG-006 | Responses valid 30 s; expired responses shown expired and not selectable. | Select disabled at expiry. | BR-044 |
| FR-NEG-007 | One live response per driver per offer; a new response replaces the old. | Response list keyed by driver. | BR-045 |
| FR-NEG-008 | Selecting a response locks `agreedFare` and driver and withdraws all others. **[Backend]** | After select, other cards withdrawn. | BR-046 |
| FR-NEG-009 | If the selected driver is unavailable, show "This driver is no longer available" and return to remaining live responses. | Mock flag triggers message; list remains. | BR-047 |
| FR-NEG-010 | No driver shall be assigned to two active trips. **[Backend]** | Concurrent selects for one driver → exactly one success (T-AU-011). | BR-047 |
| FR-NEG-011 | The rider may raise but not lower an open offer; raising restarts the timer. | Decrement below current offer disabled while open. | BR-048 |
| FR-NEG-012 | Maximum 3 offer rounds; after that Raise is disabled with explanation. | Round 4 not possible. | BR-049 |
| FR-NEG-013 | Response cards shall show driver name, rating, trips, vehicle, amount, ETA and countdown, and accessible label containing all. | T-AC-011. | |
| FR-NEG-014 | Leaving R11 while an offer is open shall ask for confirmation (cancel). | T-NAV-005. | |

### 1.6 Trip (FR-TRIP)

| ID | Requirement | Acceptance criterion | Refs |
|---|---|---|---|
| FR-TRIP-001 | Booking status transitions shall follow `UI_STATES.md` §2; illegal events leave state unchanged and set an error flag. | Exhaustive table test T-AU-013. | ARCH §2.4 |
| FR-TRIP-002 | Cancellation shall be allowed from `quoted` through `driver_arrived` and not from `in_progress` onwards. | Cancel control absent from `in_progress`. | UI_STATES §2 |
| FR-TRIP-003 | Cancellation shall be free before match and ≤ 2 min after match; afterwards or after 5 min driver wait a fee (mock ₦500) applies and is shown before confirmation. | Dialog text includes fee amount or "Free". | BR-080, BR-081 |
| FR-TRIP-004 | Cancellation reason shall be optional and collected. | Cancel succeeds with no reason selected. | BR-083 |
| FR-TRIP-005 | Driver must mark Arrived before Start; Start requires passenger confirmation. | Start disabled before both. | BR-090 |
| FR-TRIP-006 | Final fare = locked/agreed fare unless backend applies route-change rule. **[Backend]** | Receipt fare equals `agreedFare` in mock. | BR-091, Q-005 |
| FR-TRIP-007 | The active booking shall persist to `gobye.activeBooking` on every transition and be deleted on completion, cancellation and sign-out. | Kill/relaunch restores; after completion key absent. | ARCH §4, SECURITY §3 |
| FR-TRIP-008 | Corrupt persisted booking shall reset safely to Home with a non-blocking message. | T-AU-023. | |
| FR-TRIP-009 | Rating: 1–5 stars, comment ≤ 300 chars; < 3 requires a reason; skippable. | T-AU-020. | BR-111 |
| FR-TRIP-010 | Receipt shall show fare, processing fee (separate line) and total paid, breakdown, method, payment status, times, distance, and "Simulated" when applicable. | Fields present; `totalPaid = fare + processingFee`. | DATA_MODELS, BR-105 |
| FR-TRIP-011 | Safety/share-trip screens shall state that no emergency service is contacted. | Text present. | BR-120 |
| FR-TRIP-012 | Back navigation on R12/R13/D13 shall prompt before leaving or cancelling. | T-NAV-005. | ARCH §3 |

### 1.7 Payments (FR-PAY)

| ID | Requirement | Acceptance criterion | Refs |
|---|---|---|---|
| FR-PAY-001 | Methods shown: only methods enabled in `PaymentsConfig` — GoBye Wallet and Bank transfer at launch (D-023); cash hidden while disabled (Q-001); no cards. *(Revised 2026-10-21; was Cash, Card, Wallet.)* | Picker lists Wallet and Bank transfer with simulated label; no card or cash option. | BR-100 |
| FR-PAY-002 | Apple IAP/StoreKit shall not be used for ride fares, wallet top-ups or driver access packages. | No StoreKit dependency in either app. | BR-101 |
| FR-PAY-003 | *(Revised 2026-10-21.)* The apps shall not collect card or bank credentials; bank transfers show provider virtual-account details only. | No card or bank-login fields in either app. | BR-102 |
| FR-PAY-004 | Charge failure shall keep `payment_pending` and offer "Try again" and "Use another method" (bank transfer: "Check again"). | T-AU-021. | BR-103 |
| FR-PAY-005 | Each charge/confirmation attempt shall use idempotency key `${bookingId}-${attempt}` with the attempt counter persisted on the booking; switching method or retrying increments the attempt. | Two retries → at most one successful charge; keys unique across relaunch. | NFR-REL-004, BR-108 |
| FR-PAY-006 | All payments in the current build shall be labelled "Simulated". | Label on R10, R14, R15, R22. | BR-104 |
| FR-PAY-007 | Wallet shall show balance and transaction history (top_up, ride_payment, refund, reward, payout). | Empty and list states. | DATA_MODELS |
| FR-PAY-008 | Refund status shall appear on the receipt (`refunded`) and as a wallet transaction. | Mock refund shows both. | |
| FR-PAY-009 | Processing fees shall be shown separately from the fare on the payment picker, ride options, payment screen and receipt; the payment method shall never change the fare; only passenger-borne fees are added to the total. Fee values are server-provided in production (mock ₦50 bank-transfer fee is a placeholder). | R09 shows "+ ₦50 bank transfer fee, separate from the fare"; `paymentCharge` tests (T-AU-024). | BR-105, D-024 |
| FR-PAY-010 | A Wallet booking shall be blocked when the balance is below fare + passenger-borne fee (Quick Match: Book disabled with Top up / bank-transfer options; Negotiate: unaffordable responses cannot be selected). **[Backend]** | T-AU-024 (`walletCovers`); UI check on R09/R11. | BR-106 |
| FR-PAY-011 | Wallet trips shall be charged automatically when the trip ends. | `payment_pending` → paid without user action (mock). | BR-106 |
| FR-PAY-012 | Bank-transfer trips shall end in an awaiting-transfer state showing bank, account number, account name and exact amount, with "I've sent the transfer" and "Pay with GoBye Wallet instead"; confirming starts a check that ends paid or "Transfer not received yet" (Check again / Use another method). In production, payment is marked paid only on provider confirmation. **[Backend]** | T-INT-005. | BR-107 |
| FR-PAY-013 | The awaiting-transfer / checking state shall survive app restart without re-charging. | T-INT-006. | BR-108, NFR-REL-003 |

### 1.8 Account features (FR-ACC)

| ID | Requirement | Acceptance criterion | Refs |
|---|---|---|---|
| FR-ACC-001 | Activity shall list past rides (loading, empty, list) newest first. | T-AS-012. | |
| FR-ACC-002 | Saved places: add Home/Work/Other via search, remove with confirmation. | Removed place no longer in search shortcuts. | |
| FR-ACC-003 | Profile edit validates names; phone change requires OTP re-verification (backend). | Invalid name blocks Save. | |
| FR-ACC-004 | Notifications list with read/unread; empty state. | Mark read updates badge. | |
| FR-ACC-005 | Referral code shared via system share sheet. | Share sheet opens with code text. | |
| FR-ACC-006 | Support request: topic + description; ride-linked reports within 7 days. | Report option hidden for rides > 7 days old. | BR-110 |
| FR-ACC-007 | Settings: notification/haptics toggles, link to OS settings, privacy policy, terms. | Links open. | APP_STORE 5.1.1 |
| FR-ACC-008 | Appearance follows system light/dark; no in-app switch. | Toggling OS appearance updates app. | ARCH §7 |

### 1.9 Driver (FR-DRV)

| ID | Requirement | Acceptance criterion | Refs |
|---|---|---|---|
| FR-DRV-001 | Registration collects personal details, licence, identity, vehicle and documents in steps, with progress and resume. | Kill mid-step → resumes at same step. | |
| FR-DRV-002 | Documents captured by camera or system picker, uploaded with progress/retake; no local copy retained after upload; numbers masked. | No document file remains in app storage after success. | SECURITY §7 |
| FR-DRV-003 | Verification status screen shows `pending_review`, `approved`, `rejected` (with reason, resubmit). | T-AS-014. | |
| FR-DRV-004 | Going online requires `approved`, valid documents, foreground location with **precise** accuracy, and an **active access package**. | Toggle blocked with specific message otherwise (`permission_required`, `precise_required`, `no_access_package` — T-AU-025). | BR-070–073 |
| FR-DRV-005 | *(Revised 2026-10-21, D-026.)* Location is requested as When In Use (iOS) / FINE+COARSE (Android) on first go-online after D10; **Always is never requested automatically**; a location session starts only when the driver goes online, continues in the background while available / to pickup / on trip, and stops when offline with no active trip. | Background task unregistered after go-offline; no Always prompt (device test). | D-026 |
| FR-DRV-006 | Android: while online, a foreground service of type `location` (started in the foreground) shows a persistent "You're online" notification. `ACCESS_BACKGROUND_LOCATION` only if device testing shows it is required. | Notification visible while online only. | D-026 |
| FR-DRV-007 | Quick Match request shows pickup, destination, distance, ETA, fare, estimated earnings (full fare — 0% commission), countdown; accept/decline. | Earnings labelled "Estimated"; earnings = fare (T-AU-024). | BR-060, BR-061 |
| FR-DRV-008 | Negotiation request shows passenger offer, suggested fare, range, countdown; Accept / Counter (validated) / Decline. | Counter outside `[offer, max]` blocked. | BR-043 |
| FR-DRV-009 | Driver is notified when the passenger selects another driver, the offer expires, or the response expires. | Request dismissed with message. | BR-044, BR-046 |
| FR-DRV-010 | Trip steps: to pickup → Arrived → Confirm passenger (name) → Start → Complete, in order. | Out-of-order actions disabled. | BR-090 |
| FR-DRV-011 | Driver cannot go offline during an active trip. | Toggle disabled with explanation. | |
| FR-DRV-012 | Driver cancellation after acceptance requires a reason and shows a reliability warning. | Dialog includes warning. | BR-082, BR-083 |
| FR-DRV-013 | Trip complete shows payment status (paid / awaiting transfer / pending; cash only if approved, Q-001) and estimated earnings. | T-AS-017. | |
| FR-DRV-014 | Earnings & payouts: totals by day/week, payout history (simulated). | Empty and list states. | |
| FR-DRV-015 | Driver location sent to backend only while online, throttled by time/distance per activity (`UPDATE_PROFILES`, placeholders, Q-045). **[Backend]** | No pings while offline. | SECURITY §6, D-026 |
| FR-DRV-016 | Drivers shall be able to buy Daily or Monthly access packages (configurable; prices provisional ₦2,000 / ₦60,000) and see status and expiry; buying while active extends from the current expiry. **[Backend]** | `subscribe` / `hasActiveAccess` tests (T-AU-024). Driver UI not yet built. | BR-062, BR-072 |
| FR-DRV-017 | Update frequency shall adapt to activity (available / to pickup / on trip). | Profile changes with activity (T-AU-025). | D-026 |
| FR-DRV-018 | New requests shall pause, with a driver-facing reason, when location permission is missing, only approximate, the session is interrupted, the last fix is stale or accuracy exceeds the dispatch threshold (placeholder 100 m); an active trip continues. **[Backend]** | `canReceiveRequests` false for each issue (T-AU-025). | BR-073, D-026 |
| FR-DRV-019 | After a trip ends the driver returns to available (still online) until they explicitly go offline. | `TRIP_ENDED` → `available` (T-AU-025). | D-026 |

---

## 2. Non-functional requirements

### 2.1 Performance (NFR-PERF)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| NFR-PERF-001 | Cold start to interactive Home ≤ 3 s on mid-range Android (A3 class) release build. | Measured median of 5 launches. |
| NFR-PERF-002 | Screen transitions and sheet drags at ≥ 55 fps on mid-range devices. | Perf monitor shows no sustained drops. |
| NFR-PERF-003 | Search input debounce 250–350 ms; results render ≤ 300 ms after response. | Profiler trace. |
| NFR-PERF-004 | Timers derived from timestamps via a single clock (`useNow`); no per-card intervals. | Code review + T-AU-008. |
| NFR-PERF-005 | Bundle excludes unused icons (per-icon deep imports). | Bundle analysis shows only used MingCute icons. |
| NFR-PERF-006 | Driver background location must not exceed the update profile for the current activity (placeholders in `UPDATE_PROFILES`, tuned via Q-045). | Device log over 10 min online per activity. |

### 2.2 Accessibility (NFR-A11Y)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| NFR-A11Y-001 | Touch targets ≥ 44×44 pt (iOS) / 48×48 dp (Android), via size or `hitSlop`. | T-AC-003; inspector check per screen. |
| NFR-A11Y-002 | Text scales with Dynamic Type / Android font scale up to the largest accessibility size without truncating essential info; `maxFontSizeMultiplier` only on fixed-size controls (tab labels). | Screens usable at largest size (DEVICE_TEST_MATRIX). |
| NFR-A11Y-003 | Text contrast ≥ 4.5:1 (≥ 3:1 for large text and essential UI graphics) in light and dark. | Token contrast test T-AC-015. |
| NFR-A11Y-004 | Every interactive element has role, label, and state (`selected`, `disabled`, `expanded`). | RNTL queries by role/label pass. |
| NFR-A11Y-005 | Information never conveyed by colour alone (selected vehicle, expired response, errors). | Icon/text accompanies colour. |
| NFR-A11Y-006 | Countdown, status changes (matched, offer expired, payment failed) announced to screen readers without spamming each second. | VoiceOver/TalkBack announce at state change and at 10 s left only. |
| NFR-A11Y-007 | Reduce Motion: replace springs/pulses/parallax with fades or static states. | With setting on, no spring animations. |
| NFR-A11Y-008 | Map sheet exposes expand/collapse accessibility actions; map content has a list alternative (results, driver details). | T-AC-007. |
| NFR-A11Y-009 | Focus order follows visual order; modals trap focus; errors moved into focus/announced. | Manual VoiceOver/TalkBack pass. |
| NFR-A11Y-010 | Icons decorative by default; icon-only buttons require `accessibilityLabel`. | T-AC-001, T-AC-003. |

### 2.3 Security (NFR-SEC)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| NFR-SEC-001 | HTTPS/WSS only; ATS defaults kept; no cleartext on Android. | Config review. |
| NFR-SEC-002 | Tokens in secure store only; refresh token rotation; revocation on sign-out/deletion. **[Backend]** | FR-AUTH-007; API test. |
| NFR-SEC-003 | No API secrets in the app bundle; provider keys restricted by bundle ID/package. If Google Maps Platform is adopted (D-025, Proposed), Places/Routes calls go through the backend (recommendation) and only the restricted Maps SDK key ships. | Bundle string scan. |
| NFR-SEC-004 | Server validates all prices, offers, transitions and eligibility. **[Backend]** | Tampered client amount rejected (`OFFER_OUT_OF_RANGE`). |
| NFR-SEC-005 | Rate limiting on OTP and sensitive endpoints. **[Backend]** | 429 with `retryAfter`. |
| NFR-SEC-006 | Payment webhooks verified by signature. **[Backend]** | Unsigned webhook rejected. |
| NFR-SEC-007 | Mock services and OTP bypass excluded from production builds. | FR-AUTH-011. |

### 2.4 Privacy (NFR-PRIV)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| NFR-PRIV-001 | Logs never contain tokens, OTPs, phone, names, email, coordinates, addresses, payment/bank details, documents, free text. | Lint rule bans `console.*`; logger review. |
| NFR-PRIV-002 | Permissions requested only at moment of need; purpose strings as in APP_STORE_COMPLIANCE §5. | No prompt at launch. |
| NFR-PRIV-003 | Rider: no background location; Driver: only while online (D-026), never Always. | Device test; config review. |
| NFR-PRIV-004 | No tracking (`NSPrivacyTracking: false`); privacy manifest complete. | Apple upload without missing-reason email. |
| NFR-PRIV-005 | Persisted active booking contains only fields needed to resume; deleted on completion/cancel/sign-out. | FR-TRIP-007. |
| NFR-PRIV-006 | Retention periods and NDPA obligations confirmed by legal before launch. | Q-016, Q-017 closed. |

### 2.5 Reliability (NFR-REL)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| NFR-REL-001 | Offline: show offline banner within 3 s of connectivity loss; disable network actions with reason; keep active trip display with "Last updated" time. | Airplane-mode test on R07, R09, R13. |
| NFR-REL-002 | Reconnect: on network restore, refetch booking state from server (production) and reconcile; realtime resubscribes. | Server state wins on conflict. |
| NFR-REL-003 | State recovery: active booking restored after app kill/OS eviction with timers derived from timestamps. | Kill during `negotiating`, `driver_en_route`, `payment_pending` → correct screen and state. |
| NFR-REL-004 | Idempotency: every create/mutate request (booking, offer, raise, select, cancel, charge, retry) carries an `Idempotency-Key`; repeats return the original result. **[Backend]** | Replayed request returns same resource, no duplicate. |
| NFR-REL-005 | Network requests time out (proposed 15 s) and retry only idempotent operations with backoff. | Timeout shows retry state. |
| NFR-REL-006 | Mock services expose configurable failure rates (`MOCK_FLAGS`) to exercise every error path. | T-AU-022. |
| NFR-REL-007 | Expiry (quote, offer, response) evaluated as `expiresAt <= now` on every render/resume, never only by timers. | Background/resume test. |
| NFR-REL-008 | Duplicate realtime events are ignored (event `id` dedupe) and out-of-order events rejected by `seq`/`updatedAt`. | Replay test against reducer. |

### 2.6 Internationalisation & formatting (NFR-I18N)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| NFR-I18N-001 | Currency NGN with `₦` prefix, thousands separator `,`, no decimals for whole naira. | FR-FARE-003. |
| NFR-I18N-002 | Phone numbers displayed as `+234 803 123 4567`; stored E.164. | Formatter test. |
| NFR-I18N-003 | Dates/times in device locale, Africa/Lagos time zone for receipts; API in ISO-8601 UTC. | Receipt shows WAT. |
| NFR-I18N-004 | Distances in km (1 decimal < 10 km), durations in min. | Formatter test. |
| NFR-I18N-005 | All user-facing strings centralised for future localisation (Q-040). | No hard-coded copy in feature components (lint/review). |

### 2.7 Compatibility (NFR-COMPAT)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| NFR-COMPAT-001 | iOS 16.4+ and Android 7.0 (API 24)+, target API 36, per Expo SDK 57 (D-001). | Runs on I1 and A1 devices (DEVICE_TEST_MATRIX). |
| NFR-COMPAT-002 | Portrait phones from 4.7" (iPhone SE) to 6.9"; safe areas, notches, Dynamic Island, edge-to-edge Android. | No clipped content on I1–I5, A1–A8. |
| NFR-COMPAT-003 | Android gesture and 3-button navigation; system back on every screen (predictive back setting per Q-013). | T-NAV-004. |
| NFR-COMPAT-004 | Light and dark mode. | Visual check per screen. |
| NFR-COMPAT-005 | Rider app runs in Expo Go (SDK 57); Driver background location requires a development build. | ARCH §10. |
| NFR-COMPAT-006 | Builds with Xcode 26+/iOS 26 SDK via EAS. | EAS build log. |

---

## 3. Traceability summary

| BR range | FR coverage |
|---|---|
| BR-001–003 | FR-FARE-001, -002, -003 |
| BR-010–011 | FR-FARE-007 |
| BR-020–023 | FR-FARE-002, -004, -005, -006 |
| BR-030–033 | FR-QM-001–004 |
| BR-040–049 | FR-NEG-001–012 |
| BR-060–062 | FR-DRV-007, FR-DRV-013, FR-DRV-016 |
| BR-070–073 | FR-DRV-004, FR-DRV-016, FR-DRV-018 |
| BR-080–083 | FR-TRIP-002–004, FR-DRV-012 |
| BR-090–091 | FR-TRIP-005, -006, FR-DRV-010 |
| BR-100–104 | FR-PAY-001–006 |
| BR-105–108 | FR-PAY-005, FR-PAY-009–013, FR-TRIP-010 |
| BR-110–111 | FR-ACC-006, FR-TRIP-009 |
| BR-120 | FR-TRIP-011 |
