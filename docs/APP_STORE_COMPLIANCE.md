# GoBye — App Store Compliance

**Apps:** GoBye (Rider, `app.gobye.rider` — proposed) and GoBye Driver (`app.gobye.driver` — proposed). Two separate App Store Connect records.
**Reviewed:** 2026-10-21. App Review Guidelines page shows "Last Updated: October 16, 2026".
**Status:** planning document. No build has been submitted. Nothing is submitted, and no paid account is configured, without the product owner's explicit authorisation (ARCHITECTURE §10).

> **Mock-only builds must not be submitted as a live transport service.** The current apps run entirely on mock services (simulated drivers, ETAs, payments, verification). Submitting them to the App Store as an operational ride-hailing service would misrepresent the app (Guideline 2.3) and is incomplete (2.1). Mock builds may go to **TestFlight internal testing** only. App Store submission requires a real backend, payment provider, driver verification and applicable regulatory approvals.

Legend: **[Apple]** stated by Apple · **[GoBye]** our plan · **[Unverified]** not confirmed against an official source in this review.

---

## 1. Sources

| Document | URL |
|---|---|
| App Review Guidelines | https://developer.apple.com/app-store/review/guidelines/ |
| App privacy details | https://developer.apple.com/app-store/app-privacy-details/ |
| Privacy manifest files | https://developer.apple.com/documentation/bundleresources/privacy-manifest-files |
| Describing use of required reason API | https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api |
| Requesting authorization to use location services | https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services |
| Handling location updates in the background | https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background |
| `allowsBackgroundLocationUpdates` | https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates |
| `NSLocationTemporaryUsageDescriptionDictionary` | https://developer.apple.com/documentation/bundleresources/information-property-list/nslocationtemporaryusagedescriptiondictionary |
| Upcoming requirements | https://developer.apple.com/news/upcoming-requirements/ |
| TestFlight | https://developer.apple.com/testflight/ |
| HIG — Privacy | https://developer.apple.com/design/human-interface-guidelines/privacy |
| Expo — Privacy manifests (non-Apple) | https://docs.expo.dev/guides/apple-privacy/ |

---

## 2. Review Guidelines mapping

| Guideline | Requirement [Apple] | GoBye response [GoBye] | Applies to |
|---|---|---|---|
| **1.2** User-generated content | Apps where users create/upload/share content must filter objectionable material, offer reporting with timely response, let users block abusive users, and publish contact information. | Ratings comments (≤ 300 chars, BR-111) and support requests are low-risk. **If in-app rider–driver chat is added**, implement report, block and filtering, and publish contact info. Whether 1.2 strictly applies to trip chat is our interpretation, not Apple's wording. | Both (if chat) |
| **2.1(a)** App completeness | Final versions with working URLs and no placeholder content; tested on device; "include demo account info (and turn on your back-end service!) if your app includes a login". Built-in demo mode only "with prior approval by Apple". | Provide in App Review Information: a Rider demo account and an **approved** Driver demo account, OTP bypass instructions for reviewers (e.g. a fixed reviewer number/code honoured by the backend), and a way to complete a trip (sandbox city or simulated driver). Backend must be running during review. Remove "PREVIEW — NOT APPROVED" placeholder assets (D-016) before submission. | Both |
| **2.3 / 2.3.1(a) / 2.3.3** Accurate metadata | Metadata, privacy information, description and screenshots must reflect the core experience; new features described specifically in Notes for Review; screenshots show the app in use, not splash/login. | Screenshots of map, booking, negotiation and trip screens. Only list launched cities and payment methods. Do not describe simulated features as live. Notes for Review explain Quick Match vs Negotiate. | Both |
| **2.5.4** Background services | Background services only for their intended purposes (incl. location). | Driver: background location only while online — available, approaching pickup or on trip — and stopped when offline with no active trip (D-026). Rider: no background mode. | Driver |
| **3.1.3(e)** Goods and services outside the app | Physical goods/services consumed outside the app **must** use payment methods other than IAP (e.g. Apple Pay, card entry). | *(Revised 2026-10-21, D-023/D-024.)* Ride fares via **GoBye Wallet or bank transfer** through a payment provider (cash open, cards not in scope); **no StoreKit / IAP** (BR-101). Processing fees shown separately (BR-105). [Open] Wallet top-ups used only for rides are assumed to fall under the same rule — confirm with App Review if the wallet can buy anything digital. **Driver access packages** (Daily/Monthly) pay for access to a real-world transport marketplace, assumed outside IAP as well — **[Unverified]** confirm the applicable guideline (3.1.3(e) vs 3.1.1) before release (Q-043). | Rider (pay), Driver (packages, payouts) |
| **4.8** Login services | If a third-party/social login sets up or authenticates the primary account, also offer an equivalent login service that limits data to name and email, allows a private email, and doesn't collect interactions for advertising without consent. Exempt if the app uses only the company's own account system (and other listed cases). | Phone + OTP only (D-008, Proposed) — our own account system, so no extra login required. If Google/Facebook login is added, also offer Sign in with Apple (or another compliant service). | Both |
| **5.1.1(i)** Privacy policy | Link in App Store Connect **and** inside the app; states data collected, uses, third-party protection, retention/deletion, how to revoke consent/request deletion. | Privacy policy URL in both records; link in R27 / D17 Settings and on sign-up (R05/D03). Content requires legal review (`SECURITY_PRIVACY.md`). | Both |
| **5.1.1(ii)** Permission | Consent for data collection; easy way to withdraw; purpose strings clearly and completely describe use. | §5 purpose strings; Settings links to system permissions. | Both |
| **5.1.1(iii)** Data minimisation | Request only data relevant to core functionality; prefer out-of-process pickers. | System photo picker for documents; no Contacts permission (manual trusted-contact entry or system picker). Email optional. | Both |
| **5.1.1(v)** Account sign-in / deletion | "If your app supports account creation, you must also offer account deletion within the app." No personal info required unless core or legally required. | R28 / D17 Delete account in-app; backend performs deletion subject to legal retention (explained in the flow). Mock build simulates the request. | Both |
| **5.1.5** Location Services | Use only when directly relevant; location APIs shouldn't be used to provide emergency services; notify and obtain consent before collecting/transmitting/using location; explain the purpose in the app. | Pre-permission screens (R06, D10); location used for pickup, matching, navigation and trip sharing only. Safety screen states no emergency service is contacted (BR-120). | Both |

---

## 3. Location configuration

[Apple] `NSLocationWhenInUseUsageDescription` is required for When In Use **and** Always requests; `NSLocationAlwaysAndWhenInUseUsageDescription` for Always. Requests fail immediately if keys are missing. Request at the moment of need. An app holding When In Use can ask for Always **once**.
[Apple] Background updates require `UIBackgroundModes` containing `location`; `allowsBackgroundLocationUpdates` defaults to `false`; setting it `true` without the background mode "is a fatal error". With it enabled and updates started in the foreground, a When In Use app keeps running in the background and shows the background-location indicator. Always is needed for the system to **relaunch** a terminated app (significant change, visits, region monitoring only).

| | Rider | Driver |
|---|---|---|
| Authorisation | When In Use (D-012) | **When In Use + precise only; Always never requested automatically** (D-026, 2026-10-21). *(Superseded: "When In Use, then Always on first go-online".)* |
| `NSLocationWhenInUseUsageDescription` | Yes | Yes |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | **No** (omit) | **Not needed** for the D-026 flow. **[Verify in dev build]** `expo-location`'s config plugin may still add/require it when background location is enabled; if it is emitted, keep accurate text (§5) — its presence alone does not prompt the user |
| `NSLocationTemporaryUsageDescriptionDictionary` | Yes (`pickup`) | Optional (`pickup`) — use if precise was declined |
| `UIBackgroundModes: location` | **No** | Yes |
| `allowsBackgroundLocationUpdates` | — | `true`, set before starting updates **in the foreground** when the driver goes online; blue background-location indicator shown |
| Background updates | None | While online (available / to pickup / on trip); stopped when offline with no active trip |

**Review note for D-012 — resolved 2026-10-21 (Q-012 → D-026):** the product owner chose When In Use + background mode, started in the foreground, with no automatic Always request ([Apple](https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates)). Consequence: if the system terminates the app, tracking does not relaunch it; the server detects stale positions and pauses matching, and the driver is notified (D-026). Notes for Review should explain the background indicator and that tracking runs only while online.

Expo configuration: set Info.plist keys through the `expo-location` config plugin or `ios.infoPlist` in each app's `app.json`. [Unverified] exact `expo-location` plugin option names for SDK 57 — check https://docs.expo.dev/versions/v57.0.0/sdk/location/ before editing. Background location needs a development build (ARCHITECTURE §10).

---

## 4. Precise vs approximate location

[Apple] Users may grant approximate location; an app can request temporary full accuracy with a purpose key from `NSLocationTemporaryUsageDescriptionDictionary` via `requestTemporaryFullAccuracyAuthorization(withPurposeKey:)`.
[GoBye] Rider pickup needs precise location. If approximate is granted: show "Your location is approximate", ask the rider to confirm the pin, and request temporary precise access with key `pickup`. [Unverified] whether `expo-location` exposes the temporary full accuracy request; if not, the manual pin-confirmation path is the fallback.

---

## 5. Purpose strings (draft — product owner to approve)

Style [Apple HIG]: brief, complete, active sentence; sentence case; ends with a full stop.

**Rider (GoBye)**

| Key | Draft text |
|---|---|
| `NSLocationWhenInUseUsageDescription` | GoBye uses your location to set your pickup point, show drivers near you and share your trip progress while you use the app. |
| `NSLocationTemporaryUsageDescriptionDictionary` → `pickup` | GoBye needs your precise location so your driver can find you at the right pickup point. |
| `NSCameraUsageDescription` (only if profile photo capture is added) | GoBye uses the camera so you can take a profile photo. |

**Driver (GoBye Driver)**

| Key | Draft text |
|---|---|
| `NSLocationWhenInUseUsageDescription` | GoBye Driver uses your location to show ride requests near you and guide you to pickups and drop-offs. |
| `NSLocationAlwaysAndWhenInUseUsageDescription` (only if the `expo-location` plugin emits it — Always is never requested, D-026) | GoBye Driver uses your location in the background only while you are online, so you keep receiving nearby requests and riders can follow your arrival. Tracking stops when you go offline. |
| `NSLocationTemporaryUsageDescriptionDictionary` → `pickup` | GoBye Driver needs your precise location to match you with nearby riders and navigate to pickups. |
| `NSCameraUsageDescription` | GoBye Driver uses the camera so you can photograph your licence, identity and vehicle documents for verification. |
| `NSPhotoLibraryUsageDescription` (only if the system photo picker is not sufficient) | GoBye Driver lets you choose photos of your documents for verification. |

Notifications permission (both apps) has no Info.plist string; request it in context (e.g. after first booking / when going online), not at launch.

---

## 6. App privacy details (App Store Connect)

[Apple] Required for new apps and updates; covers data collected by third-party SDKs; "collect" = sent off device and retained longer than needed to serve the request in real time; Precise Location = resolution of three or more decimal places; payment details entered into and handled solely by a third-party payment service you never access need not be disclosed; answers can be updated without a new build.

Draft disclosures (to be finalised once SDKs and backend are fixed; "Linked" assumes data tied to the account; no tracking planned):

| Data type | Rider | Driver | Purpose | Linked | Tracking |
|---|---|---|---|---|---|
| Precise Location | Yes | Yes (incl. background while online) | App functionality | Yes | No |
| Name | Yes | Yes | App functionality | Yes | No |
| Phone Number | Yes | Yes | App functionality (sign-in, trip contact) | Yes | No |
| Email Address | Optional | Optional | App functionality | Yes | No |
| User ID | Yes | Yes | App functionality | Yes | No |
| Customer Support | Yes | Yes | App functionality | Yes | No |
| Payment Info | Cards not in scope (D-023). Bank transfers are made from the rider's own banking app to a provider virtual account; evaluate whether payer details returned by the provider webhook count as collected | Yes — payout bank account number | App functionality | Yes | No |
| Photos or identity documents | No | Yes (licence, ID, vehicle documents, profile photo) | App functionality (verification) | Yes | No |

To evaluate (categories not verified in this review): Purchase History (ride/fare history), User Content (ratings comments, support messages), Contacts (trusted contact if uploaded), Crash Data / Performance Data / Other Diagnostic Data (depends on crash SDK), Sensitive Info, Other Financial Info (wallet balance, earnings). The exact App Store Connect category for identity documents is **[Unverified]**.

---

## 7. Privacy manifest plan

[Apple] `PrivacyInfo.xcprivacy` declares `NSPrivacyTracking`, `NSPrivacyTrackingDomains`, `NSPrivacyCollectedDataTypes` and `NSPrivacyAccessedAPITypes`. Since **1 May 2024**, App Store Connect rejects uploads that use required reason APIs without declared reasons. Each SDK must declare its own usage.
[Expo docs] Configure via `expo.ios.privacyManifests` in `app.json`; Apple does not always parse manifests bundled in static CocoaPods dependencies, so app-level declarations may need to include dependencies' reasons (copy from `node_modules/<pkg>/ios/PrivacyInfo.xcprivacy`).

Plan per app:
1. Start with `NSPrivacyTracking: false`, empty `NSPrivacyTrackingDomains`.
2. Declare `NSPrivacyAccessedAPICategoryUserDefaults` with `CA92.1` (example given by Apple/Expo; AsyncStorage and many RN libraries use UserDefaults — confirm).
3. Run a production EAS build, then audit every `PrivacyInfo.xcprivacy` under `node_modules` (React Native, Expo modules, `react-native-maps`, Reanimated, AsyncStorage, any crash/analytics SDK) and add missing categories/reasons to `ios.privacyManifests`. [Unverified] full reason-code list — read the Apple page above when adding entries.
4. Mirror `NSPrivacyCollectedDataTypes` with §6.
5. Treat Apple's post-upload email about missing reasons as a blocker.

```json
{
  "expo": {
    "ios": {
      "privacyManifests": {
        "NSPrivacyAccessedAPITypes": [
          {
            "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
            "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]
          }
        ]
      }
    }
  }
}
```

---

## 8. Build and distribution requirements

- [Apple, since 28 Apr 2026] Uploads must be built with **Xcode 26 or later** using the **iOS 26 SDK**. GoBye: EAS Build images for SDK 57 use Xcode 26.4+ (D-001).
- [Apple, since 9 Sep 2026] iOS apps must **target iOS 13 or later** (Expo SDK 57's own minimum is higher — check its docs).
- [Apple, 31 Jan 2026] Answer the updated age-rating questions in App Store Connect.
- [Apple] TestFlight: up to 100 internal testers (team roles); up to 10,000 external testers; first external build requires TestFlight App Review; beta description, review info and feedback email required; public links available; up to 100 builds; 30 devices per tester. [Unverified] build expiry period (commonly 90 days — not stated on the page reviewed).
- [Apple] Privacy policy URL required in App Store Connect; support URL and accessibility "nutrition labels" are available in App Store Connect (HIG Accessibility page).

---

## 9. Release checklist (per app — all unchecked)

**Readiness gate**
- [ ] Real backend, payment provider, driver verification and regulatory approvals in place (no mock services in the release build)
- [ ] All "Simulated" / "PREVIEW — NOT APPROVED" labels and assets removed or replaced with approved assets
- [ ] Product owner's written authorisation to submit

**Account and identifiers**
- [ ] Apple Developer Program membership (owner-managed)
- [ ] Bundle IDs registered: `app.gobye.rider`, `app.gobye.driver`
- [ ] App Store Connect records created; EAS credentials configured

**Build**
- [ ] Built with Xcode 26+ / iOS 26 SDK via EAS Build
- [ ] Deployment target ≥ iOS 13 (and ≥ Expo SDK minimum)
- [ ] Info.plist purpose strings approved and present (§5); Rider has no Always key or background mode
- [ ] Driver `UIBackgroundModes: location` present; background updates only while online
- [ ] Driver never shows an Always prompt (D-026); `NSLocationAlwaysAndWhenInUseUsageDescription` presence checked in the built Info.plist and its text accurate if present
- [ ] `ios.privacyManifests` complete; no missing-reason email from Apple (include Google Maps SDK if D-025 is accepted)
- [ ] No StoreKit/IAP for ride fares, wallet top-ups or driver access packages
- [ ] If Google Maps is used: Google logo/attribution visible on every map screen (not hidden by sheets)

**Privacy and accounts**
- [ ] Privacy policy (legal-reviewed) linked in App Store Connect and in-app
- [ ] Terms of service linked
- [ ] App privacy details answered (§6) incl. third-party SDKs
- [ ] In-app account deletion works end to end against the backend
- [ ] Permission requests only at point of need; pre-permission screens single-button

**Review information**
- [ ] Rider demo account + reviewer OTP instructions
- [ ] Approved Driver demo account + reviewer OTP instructions
- [ ] Backend live during review; test trip path documented in Notes for Review
- [ ] Notes for Review describe Quick Match, Negotiate, background location use (Driver)

**Metadata**
- [ ] Description, keywords and cities accurate; nothing simulated described as live
- [ ] Screenshots show the app in use (no splash/login-only shots)
- [ ] Age rating questionnaire answered
- [ ] Support URL and contact details published

**Testing**
- [ ] TestFlight internal build tested on small and large iPhones (`DEVICE_TEST_MATRIX.md`)
- [ ] VoiceOver, largest Dynamic Type, Dark Mode, Reduce Motion checked
- [ ] Permission denied / approximate / restricted paths checked
- [ ] External TestFlight beta review passed (if used)
