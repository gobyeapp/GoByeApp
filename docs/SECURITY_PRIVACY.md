# GoBye — Security & Privacy

**Scope:** Rider and Driver apps (current mock build) and the security boundaries the future backend must enforce.
**Reviewed:** 2026-10-21.
**Status:** the current build uses mock services only. Nothing here is a legal opinion. Items marked **[Legal review]** must be confirmed by qualified counsel before launch; items marked **[Unverified]** were not confirmed against an official source.

Related: `APP_STORE_COMPLIANCE.md` (Apple requirements, purpose strings, disclosures), `ARCHITECTURE.md` §4–§6, `DATA_MODELS.md`, `BUSINESS_RULES.md`, `BACKEND_HANDOVER.md`.

---

## 1. Principles

1. **Collect the minimum.** Only data needed for booking, matching, trip safety, payment and legally required records (App Review 5.1.1(iii)).
2. **Backend is the authority.** Prices, matching, eligibility, verification and payment settlement are never trusted from the client (ARCHITECTURE §9).
3. **Secrets in the Keychain.** Apple HIG: "Store sensitive information in a keychain"; "Never store passwords or other secure content in plain-text files."
4. **Ask at the moment of need.** Permissions are requested in context, never at launch (HIG Privacy; Core Location).
5. **No sensitive data in logs.**

---

## 2. Authentication

| Item | Current build | Production requirement |
|---|---|---|
| Method | Phone number + 6-digit OTP, **mocked**: any code except `000000` succeeds (D-008, Proposed) | Real SMS/WhatsApp OTP via backend provider |
| OTP handling | Never stored; field cleared after submit | Single use, short expiry, attempt limits, resend cooldown, rate limiting per number/device/IP, no OTP in API responses or logs |
| Session token | Mock opaque token | Short-lived access token + rotating refresh token; server-side revocation on sign-out and account deletion |
| Third-party login | None | If added, comply with App Review 4.8 (see compliance doc) |
| App Review | — | Reviewer test number/code honoured server-side only for designated demo accounts; cannot be used for other numbers |

Mock OTP logic must be compiled out or disabled in production builds (guard by build profile, not a runtime flag the user can change).

---

## 3. Sensitive storage on device

| Data | Store | Notes |
|---|---|---|
| Access / refresh tokens | `expo-secure-store` (iOS Keychain) | Never AsyncStorage. Deleted on sign-out and deletion. |
| Profile (name, phone, rating) | AsyncStorage | Unencrypted — acceptable for low sensitivity; cleared on sign-out. |
| Active booking (`gobye.activeBooking`) | AsyncStorage | Contains pickup/destination coordinates for state recovery. Minimise: store only fields needed to resume; **delete on trip completion/cancellation** and on sign-out. |
| Ride history, saved places, wallet (mock) | AsyncStorage | Mock data. In production, fetch from backend; cache only recent items. |
| Card data | **Never** | Cards are not in scope (D-023, 2026-10-21); no card UI exists. |
| Bank-transfer details (virtual account shown at trip end) | In the booking state only while `payment_pending` | Mock: simulated "GoBye Demo Bank" number derived from the booking ID. Production: provider-issued, short-lived; never persist after payment; no bank logins ever entered in the app. |
| Payment attempt counter (`paymentAttempts`) | AsyncStorage (with the active booking) | Needed for idempotency keys across restarts (BR-108); not sensitive. |
| Driver documents | **Not persisted** on device after upload | See §7. |

[Unverified] Exact `expo-secure-store` Keychain accessibility option to use (e.g. "after first unlock") — check Expo SDK 57 docs; choose an option that does not sync tokens to other devices.

---

## 4. Personal data inventory

| Data | Rider | Driver | Source | Purpose | Sensitivity |
|---|---|---|---|---|---|
| First/last name | ✓ | ✓ | User | Identification to the other party | Medium |
| Phone number (E.164) | ✓ | ✓ | User | Sign-in, trip contact (masked calling in future) | Medium |
| Email | Optional | Optional | User | Receipts, account | Medium |
| Profile photo | Optional | ✓ | User | Identification at pickup | Medium |
| Precise location (foreground) | ✓ | ✓ | Device | Pickup, matching, navigation | **High** |
| Background location | — | ✓ (online only: available / to pickup / on trip — D-026) | Device | Matching, arrival tracking | **High** |
| Location accuracy, permission state, tracking issues | — | ✓ (online only) | Device | Pause matching when stale/approximate/lost (D-026) | Medium |
| Driver access package purchases | — | ✓ | System | Access to go online (D-024) | Medium |
| Saved places (home/work) | ✓ | — | User | Convenience | **High** (reveals home) |
| Trip history (routes, times, fares) | ✓ | ✓ | System | Receipts, disputes, records | **High** |
| Ratings and comments | ✓ | ✓ | User | Quality, safety | Medium |
| Payment method type (wallet / bank transfer) and payment records; payer details the provider may return for transfers | ✓ | — | Provider | Payment | Medium |
| Payout bank details | — | ✓ | User | Payouts | **High** |
| Driver's licence, identity document, vehicle documents | — | ✓ | User | Verification, regulatory | **High** |
| Vehicle make/model/colour/plate | — | ✓ | User | Identification at pickup | Medium |
| Trusted contact | ✓ (local only, BR-120) | — | User | Trip sharing (future) | Medium (third-party data) |
| Support messages | ✓ | ✓ | User | Support, disputes | Medium |

---

## 5. Permissions

| Permission | Rider | Driver | When requested |
|---|---|---|---|
| Location — When In Use | ✓ | ✓ | Rider: on engaging pickup (R06). Driver: on opening map / going online. |
| Location — background (iOS: When In Use + `UIBackgroundModes: location`, started in foreground) | ✗ | ✓ | Starts when the driver goes online (D-026). No separate prompt on iOS. |
| Location — **Always** (iOS) | ✗ | ✗ **Never requested automatically** (D-026) | — |
| Android `ACCESS_BACKGROUND_LOCATION` | ✗ | Only if device testing shows it is required (D-026; ANDROID_GUIDELINES AND-06) | Separately, after foreground, behind D10 |
| Precise location | ✓ preferred | ✓ **required to go online** (BR-073) | — |
| Temporary precise location | ✓ (`pickup`) | Optional | Only if user granted approximate |
| Camera | Only if profile photo capture is added | ✓ | When the driver taps "Take photo" |
| Photos | ✗ (use system picker) | ✗ preferred (system picker) | — |
| Notifications | ✓ | ✓ | After first booking / when going online |
| Contacts | ✗ | ✗ | Not requested; manual entry or system contact picker |

Denied/restricted states must keep the app usable where possible (manual pickup entry for riders). Purpose strings: `APP_STORE_COMPLIANCE.md` §5.

---

## 6. Location privacy, minimisation and retention

**Collection**
- Rider: foreground only; no location collection after the app leaves the foreground (D-012).
- Driver: background collection **only while online** (available, approaching pickup, on trip); `allowsBackgroundLocationUpdates` enabled on go-online (started in the foreground, blue indicator visible) and disabled on go-offline; background task unregistered when offline with no active trip (D-026). If permission or updates are lost, matching pauses and the driver is notified — the app never silently escalates to Always.
- Send location to the backend only when needed: driver while online; rider at pickup selection and, if required, during the active trip while foregrounded.
- Show GPS accuracy to the user; never present simulated positions/ETAs as live (labelled "Simulated").

**Minimisation**
- Throttle driver updates by time and distance, adapted to activity (placeholder `UPDATE_PROFILES`: available 15 s/50 m; to pickup 5 s/15 m; on trip 5 s/20 m — to be tuned, Q-045).
- The rider sees the driver's location only between match and trip completion; the driver sees the rider's pickup point, not live rider location.
- Saved places are stored only when the user explicitly saves them.
- Do not use location for advertising or tracking (privacy manifest `NSPrivacyTracking: false`).

**Retention** — **[Legal review]** No retention periods have been decided. The backend must define, per data class:
- raw location pings (driver online sessions, in-trip traces);
- completed trip records (route summary, fare, timestamps) — likely needed for disputes (BR-110: 7 days, mock), tax and regulatory records;
- driver verification documents;
- support and safety reports.
Raw high-frequency location should be reduced to a trip summary as early as legal and dispute requirements allow.

---

## 7. Driver documents

- Capture via camera or the system photo picker; upload directly to backend storage over TLS; **do not keep copies** in app storage, AsyncStorage or the photo library after a successful upload.
- Show upload progress and allow retake; mask document numbers in the UI after submission (e.g. last four characters).
- Mock build: documents are not uploaded or persisted; screens use placeholders.
- Recommendation: strip image metadata (EXIF, including GPS) before upload. [Unverified] whether `expo-image-picker`/`expo-image-manipulator` strips EXIF by default — check SDK 57 docs.
- Backend: encrypted at rest, access restricted to the verification role, every access audit-logged, retention per §6.

---

## 8. Logging restrictions

**Never log** (console, crash reports, analytics, breadcrumbs, network logs):
- tokens, OTP codes, session IDs;
- phone numbers, names, emails;
- coordinates or addresses (pickup, destination, driver position, saved places);
- payment details (even last four), bank details;
- document images or numbers;
- free-text user content (ratings comments, support messages).

**Allowed:** booking/trip IDs, state transition names, error codes, coarse timings, app/OS version, `isSimulated` flags.

Implementation rules:
- One `logger` wrapper in the apps; `console.*` banned in app code via lint rule; production builds drop debug logs.
- Any crash-reporting SDK must have PII scrubbing configured and be declared in App privacy details and the privacy manifest.
- Network error logging records endpoint and status only, never bodies or headers.

---

## 9. Account deletion and retention obligations

- **Apple:** account deletion must be offered in-app (App Review 5.1.1(v)); the privacy policy must explain retention/deletion and how to request deletion (5.1.1(i)).
- **App flow (R28 / D17):** explain what is deleted, what must be retained and for how long, outstanding balances (wallet, unpaid fares, driver payouts), then confirm. Mock build simulates the request.
- **Backend:** delete or irreversibly anonymise personal data; revoke all tokens; remove from matching; retain only records with a legal basis (e.g. completed trip and payment records, safety incidents, verification records) for the required period, then delete.
- **Nigeria Data Protection Act 2023 [Legal review]:** GoBye operates in Nigeria and will process personal data of Nigerian residents. Applicability, lawful bases, data-subject rights (including deletion), retention, breach notification, cross-border transfer rules for any non-Nigerian hosting or SDK vendors, and any registration obligations must be confirmed with counsel. No specific obligations are asserted in this document.
- **Transport and financial regulation [Legal review]:** record-keeping duties from transport authorities, payment regulators and tax rules may require retention that overrides deletion requests; to be confirmed.

---

## 10. Future backend security boundaries

| Area | Requirement |
|---|---|
| Transport | HTTPS/TLS only (App Transport Security defaults kept); WebSocket over TLS. |
| AuthN/AuthZ | Every request authenticated; role checks (passenger vs driver vs admin); a user can access only their own trips and the counterpart details of an active trip. |
| Pricing and offers | Server computes quotes and validates offers/counteroffers against BR-040–BR-049; client values are advisory. |
| Matching | Server enforces eligibility (BR-070) and single assignment per driver (BR-047); idempotency keys on booking submission (BR-033). |
| Payments | Wallet ledger and bank transfers via provider virtual accounts; **webhooks verified by signature** and deduplicated; a passenger's "I've sent the transfer" never marks a payment paid on its own; processing fees computed server-side; idempotency key `${bookingId}-${attempt}`; amounts in kobo. Cards not in scope (D-023). |
| Location | Rate-limited ingestion; driver location exposed to a rider only for their matched trip; retention per §6. |
| Documents | Encrypted object storage, pre-signed short-lived upload URLs, restricted reviewer access, audit log. |
| Abuse | OTP and API rate limiting; device/account fraud checks; reporting and blocking if chat is added (App Review 1.2). |
| Secrets | No API secrets in the app bundle; map/provider keys restricted by bundle ID where the provider supports it. If Google Maps Platform is adopted (D-025, Proposed): only the Maps SDK key ships in the app, restricted per platform (iOS bundle ID; Android package + SHA-1) and per API; **Places and Routes calls go through the backend** with server-held keys (recommendation). Google receives device/map usage data — disclose in the privacy policy and App privacy details **[Legal review]**. |
| Deletion | Deletion pipeline across databases, storage, logs and processors; documented retention exceptions. |
| Monitoring | Security logging without PII (§8); incident response and breach-notification process [Legal review]. |

---

## 11. Open items

1. D-008 sign-in method confirmation.
2. Retention periods for every data class (§6) — [Legal review].
3. NDPA 2023 obligations — [Legal review].
4. Crash/analytics SDK choice and its PII configuration.
5. Payment provider choice (Q-042; launch methods decided in D-023) and the data it returns about payers.
6. Masked phone calling between rider and driver (avoid exposing real numbers).
