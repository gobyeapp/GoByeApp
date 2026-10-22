# GoBye — Android Guidelines

**Scope:** Android behaviour for the GoBye Rider app (`R01`–`R28`) and GoBye Driver app (`D01`–`D17`), see `SCREEN_INVENTORY.md`.
**Reviewed:** 2026-10-21 against developer.android.com and docs.expo.dev (sources in `RESEARCH_SOURCES.md`).
**Status:** guidance only. Nothing here is device-verified. Tick acceptance criteria only after testing (`DEVICE_TEST_MATRIX.md`).

Legend: **[Android]** = stated by Android docs · **[Expo]** = stated by Expo docs · **[Installed]** = read from `node_modules` in this repo · **[GoBye]** = our application · **[Unverified]** = not confirmed against an official source.

---

## 1. Platform baseline (SDK 57)

| Item | Value | Evidence |
|---|---|---|
| Expo / React Native | `expo` 57.0.30, `react-native` 0.86.3 | [Installed] |
| `minSdk` / `targetSdk` / `compileSdk` | **24 / 36 / 36** | [Installed] `node_modules/react-native/gradle/libs.versions.toml` |
| Lowest supported Android | 7.0 (API 24) | [Installed] minSdk 24; [Expo] versions table "7+" |
| Consequence of targetSdk 36 | Android 16 behaviour changes apply on Android 16 devices: edge-to-edge cannot be opted out; predictive back on by default **unless** opted out (see §2) | [Android] Android 16 behaviour changes |

> If D-001 is superseded (SDK 58: compileSdk 37, targetSdk 36 per Expo versions table), re-check this section.

## 2. Navigation, system back and predictive back

- **[Android]** Android 16 behaviour changes: for apps targeting API 36 on Android 16+, predictive back system animations are enabled by default, "`onBackPressed` is not called and `KeyEvent.KEYCODE_BACK` is not dispatched anymore". Apps may temporarily opt out with `android:enableOnBackInvokedCallback="false"`.
- **[Android]** `OnBackPressedCallback` "is always called regardless of the value of `android:enableOnBackInvokedCallback`". Enabled callbacks with default or overlay priority suppress the predictive animation, so they should not be used for logging.
- **[Installed]** Expo's config plugin writes `android:enableOnBackInvokedCallback` from `android.predictiveBackGestureEnabled`, and writes `"false"` unless the value is `true` (`@expo/config-plugins/build/android/PredictiveBackGesture.js`). The config type documents the default as `false`.
- **[GoBye – current state]** Both `apps/rider/app.json` and `apps/driver/app.json` set `"predictiveBackGestureEnabled": false` (template default). The apps therefore **opt out** of the predictive back animation. `ARCHITECTURE.md` §3 says predictive back "is enabled by default on Android 16 with targetSdk 36". That is true for the platform default, but our manifest overrides it. **Open item AND-01:** decide whether to enable the animation and test it with Expo Router / react-native-screens. **[Unverified]** compatibility of Expo Router 57 with `predictiveBackGestureEnabled: true`.
- **[GoBye] Rules:**
  1. Every stack screen supports system back (gesture or 3-button) and returns to the previous screen. Use Expo Router `router.back()` semantics. Do not add custom back handlers except where listed below.
  2. Intercept back (React Native `BackHandler` / navigation `beforeRemove`) **only** on R12 Searching, R11 Negotiate (offer open), R13 Active trip, D13 Active trip, and unsaved driver onboarding forms (D03–D07). Show a confirmation ("Cancel ride?" with any fee per BR-081, or "Discard changes?"). Never trap the user, because a second confirm must leave.
  3. From a tab root, back exits to the launcher (the system default). Do not show "Press back again to exit".
  4. Modal/picker screens (R08, R10) close on back.
  5. Tab bar: JS `Tabs` (D-003), 3 destinations in the Rider app and up to 4 in the Driver app. Labels always visible.
  6. Up/back affordance in the header uses an arrow icon via `<Icon name="back">` with `accessibilityLabel="Navigate up"` **[Unverified: wording not taken from an Android source]**.

## 3. Edge-to-edge, status and navigation bars

- **[Android]** "Once you target SDK 35 or higher on a device running Android 15 or higher, your app is displayed edge-to-edge." For API 36 targets on Android 16, `windowOptOutEdgeToEdgeEnforcement` "is deprecated and disabled".
- **[Installed]** Expo prebuild warns that "`edgeToEdgeEnabled` customization is no longer available - Android 16 makes edge-to-edge mandatory" (`@expo/prebuild-config/.../withEdgeToEdge.js`). Do not add `edgeToEdgeEnabled` to `app.json`.
- **[Android]** Pad tappable views by the system-bar insets. Apps "draw in the display cutout" by default, so pad for cutouts. Keep swipeable views (bottom sheets) away from system-gesture insets.
- **[GoBye] Rules:**
  - Use `react-native-safe-area-context` (5.7.0 installed) `useSafeAreaInsets()` for every screen. The **map** may draw under the status bar and navigation bar. Controls (LocateButton, search field, MapSheet grabber, tab bar, primary buttons) must sit inside the insets.
  - `MapSheet` (D-010): its collapsed position includes the bottom inset. Its drag handle must not sit inside the bottom gesture area.
  - Status-bar icon colour follows the theme: dark icons on light surfaces and light icons in dark mode or over dark map styles (`expo-status-bar` `style="auto"` or set explicitly per screen). **[Unverified]** that this is per-screen behaviour on Expo Router 57.
  - Test both gesture navigation and 3-button navigation (`DEVICE_TEST_MATRIX.md`). The 3-button bar has a larger bottom inset.

## 4. Keyboard and input

- **[Installed]** `android.softwareKeyboardLayoutMode` defaults to `resize` (maps to `windowSoftInputMode`). Keep the default.
- **[GoBye]** Forms (R03 phone, R04 OTP, R05 name, R08 search, R11 offer, R16 comment, R26 support, D03–D07): the focused field and primary button stay visible above the keyboard. Use `KeyboardAvoidingView` only where `resize` is not enough, and test this on Android, not just iOS.
- Input types: phone uses `keyboardType="phone-pad"` with `autoComplete="tel"`; OTP uses `number-pad` with `textContentType="oneTimeCode"` (iOS) / `autoComplete="sms-otp"` (Android); money uses `number-pad`.
- The IME action (`returnKeyType`) advances to the next field or submits. Back with the keyboard open closes the keyboard first (system behaviour; do not intercept).
- **[Unverified]** IME inset guidance. The Android edge-to-edge page links to a separate keyboard page that was not reviewed.

## 5. Permissions

### 5.1 Location (D-012; Driver revised by D-026, 2026-10-21)

> **Reconciliation 2026-10-21.** Earlier text below planned to request `ACCESS_BACKGROUND_LOCATION` at D10 on first go-online. D-026 replaces that for the Driver: the location session starts **in the foreground** when the driver taps Go online, using foreground permission (FINE + COARSE, precise required) and a `location` foreground service, which Android allows without background permission when started while the app is visible (§5.2 quote). `ACCESS_BACKGROUND_LOCATION` is requested **only if device testing shows it is required** — e.g. if `expo-location`'s `startLocationUpdatesAsync` refuses to start without it **[Unverified — verify in the Driver dev build]** — and then separately, after foreground, behind D10. Where the table below conflicts, this note wins.

- **[Android]** Request `ACCESS_FINE_LOCATION` **and** `ACCESS_COARSE_LOCATION` in a single request. Requesting FINE alone is ignored on some Android 12 releases. The app "should still work when the user grants only approximate location access".
- **[Android]** Background access requires `ACCESS_BACKGROUND_LOCATION` (Android 10+). Request it **incrementally after** foreground access. On Android 11+, a combined request "doesn't grant your app either permission". On Android 11+ the dialog has no "Allow all the time" option and the user must enable it in Settings. Show an explanation screen with the localised option label (`getBackgroundPermissionOptionLabel()`) and a decline path.
- **[Android]** Google Play restricts background location to apps that need it for core features. **[Unverified]** current Play Console permissions-declaration steps and video requirements.
- **[Expo]** `expo-location` adds COARSE and FINE automatically. `isAndroidBackgroundLocationEnabled` (default `false`) adds `ACCESS_BACKGROUND_LOCATION`. `requestBackgroundPermissionsAsync()` opens system settings on Android 11+. Background location "is not supported in the Expo Go app".

| | Rider | Driver |
|---|---|---|
| COARSE + FINE | Yes, requested at R06 when engaging pickup | Yes, at sign-in / dashboard |
| `ACCESS_BACKGROUND_LOCATION` | **No.** `isAndroidBackgroundLocationEnabled` stays `false` | ~~Yes, requested at D10 on first go-online~~ **Only if required** after device testing (D-026); if needed, requested separately after foreground, from D10 |
| Approximate only | Works: manual pickup is offered, plus a prompt to allow precise location for pickup accuracy | Works for browsing. **Going online needs precise location** (decided, D-026 / BR-073); if precise is turned off while online, new requests pause and the driver is told |
| Denied | Manual pickup/destination entry (R06 "Enter pickup manually") | Cannot go online. Show Settings link via `Linking.openSettings()`. Revoked while online → new requests pause, driver notified; active trip continues |

> Current repo state: neither `app.json` configures the `expo-location` plugin yet. *(Update 2026-10-21: the Driver `app.json` now has `"name": "GoBye Driver"`, `"slug": "gobye-driver"`, `"scheme": "gobyedriver"`; the template-name part of AND-02 is resolved.)* **Open item AND-02** (plugin config).

### 5.2 Foreground service (Driver only)

- **[Android]** From Android 14 (API 34) every foreground service needs a type. Location uses `foregroundServiceType="location"` and `FOREGROUND_SERVICE_LOCATION`, with COARSE or FINE granted and location services on. It "cannot create a `location` foreground service while your app is in the background, unless you've been granted the `ACCESS_BACKGROUND_LOCATION`".
- **[Expo]** `isAndroidForegroundServiceEnabled` defaults to `true` when background location is enabled. `startLocationUpdatesAsync(task, { foregroundService: { notificationTitle, notificationBody, notificationColor?, killServiceOnDestroy? } })`. `androidForegroundServiceIcon` is a 96×96 all-white PNG.
- **[GoBye]** Start updates only when the driver taps **Go online** (app in the foreground), with the notification "You're online · GoBye Driver is using your location to receive ride requests". Stop updates and unregister the task on **Go offline**, sign-out and account deletion.
- **[GoBye — D-026]** Keep the service running while `available`, `to_pickup` or `on_trip`; Go offline is blocked during an active trip. Update interval/distance adapt to activity (`UPDATE_PROFILES`, placeholders, Q-045) — change the request when activity changes. If the service is killed, permission revoked, precise turned off or fixes go stale, pause new requests and show the reason in-app (and in the notification if feasible). Services stopped by the OS (battery optimisation, OEM task killers common on budget Android devices) must be detected on next fix/resume **[Unverified — device testing]**.

### 5.3 Notifications

- **[Android]** `POST_NOTIFICATIONS` is a runtime permission on Android 13+. For apps targeting 13+, notifications are off by default until granted. Ask in context, after a user action. If it is denied, foreground-service notices still appear in Task Manager but not in the drawer.
- **[GoBye]** Rider: ask after the first booking is submitted ("Get notified when your driver arrives"). Driver: ask on first go-online, after the foreground-location request (and before any background-location request, if one proves necessary), so that only one system dialog appears at a time. Never ask at first launch.
- **Notification channels [Unverified – not reviewed today]:** channels are required on Android 8+. GoBye proposes these channels: `trip_updates` (high importance: driver assigned/arrived), `ride_requests` (Driver, high), `account` (default), `promotions` (low, off unless opted in), and the foreground-service channel. `expo-notifications` is **not installed**. Verify the channel API (`setNotificationChannelAsync`) against the SDK 57 docs before implementing. Push delivery depends on the backend (`BACKEND_HANDOVER.md`).

## 6. Accessibility (TalkBack, font scaling, touch targets, contrast)

- **[Android]** Touch targets at least **48dp × 48dp**. Content descriptions describe purpose, not visuals, must be unique per list item, and must avoid redundancy ("Submit", not "Submit button"). Text contrast is **4.5:1** (under 18sp, or bold under 14sp), otherwise **3:1**.
- **[GoBye]**
  - All `Pressable`s use `hitSlop` or min size so the target is ≥ 48dp on Android (and ≥ 44pt on iOS). Icon-only buttons have `accessibilityLabel` and `accessibilityRole="button"`. Decorative MingCute icons are hidden from accessibility (D-015).
  - TalkBack order follows visual order: search, then sheet content, then primary action. The map is one focusable region with a summary label (e.g. "Map. Pickup: Ikeja City Mall"). Markers are not individually traversed unless actionable. **[Unverified]** react-native-maps marker accessibility on Android.
  - `MapSheet` exposes expand/collapse as accessibility actions (`accessibilityActions` with `activate`/`increment`/`decrement`), so TalkBack users can operate it without dragging.
  - Timers (BR-042/BR-044) announce state changes with `AccessibilityInfo.announceForAccessibility` at expiry, not every second.
  - Font scaling: `allowFontScaling` stays on (D-014). Layouts must reflow at the largest system font scale (200% on Android 14+ **[Unverified – not reviewed today]**) without clipping primary actions. `maxFontSizeMultiplier` applies only to tab labels and fixed chips.
  - Reduce motion / "Remove animations": respect `AccessibilityInfo.isReduceMotionEnabled()` and Reanimated's reduced-motion setting for the search pulse and sheet springs.
  - Do not use colour alone: offer states use text and icons (e.g. "Expired") besides colour.

## 7. Other system behaviour

- **Orientation:** both apps are `portrait` (`app.json`). Large screens and foldables show portrait letterboxed. **[Unverified]** Android 16 large-screen orientation-override behaviour for targetSdk 36. Review before release.
- **Dark theme:** `userInterfaceStyle: "automatic"`. Follow the system setting with no in-app switch (ARCHITECTURE §7).
- **Process death:** the active booking is restored from AsyncStorage (`gobye.activeBooking`). Expiry is derived from timestamps (ARCHITECTURE §4).
- **Maps:** `react-native-maps` 1.27.2 [Installed]. Store builds need `androidGoogleMapsApiKey` (config plugin) restricted to package name + SHA-1 [Expo]. Expo Go needs no key for development. Google Maps Platform is the **proposed** provider (D-025): keep the Google logo and attribution visible above `MapSheet` (map padding); Places/Routes keys stay on the backend (recommendation), only the restricted Maps SDK key ships in the app.
- **Payments:** launch methods Wallet + bank transfer (D-023); no Google Play Billing — rides, wallet top-ups and driver packages pay for a real-world service **[Unverified: confirm against current Play payments policy before release]**.

## 8. Acceptance criteria per screen group

| Group | Screens | Criteria (all on Android 7 / 12 / 14 / 16, gesture + 3-button) |
|---|---|---|
| Launch & auth | R01–R05, D01–D02 | A-AUTH-1: back from R04 returns to R03 with the phone number kept. A-AUTH-2: the keyboard never covers the focused field or primary button. A-AUTH-3: OTP autofill offered (`sms-otp`). A-AUTH-4: no permission prompts before R06/D09. |
| Location permission | R06, D10 | A-LOC-1: FINE+COARSE requested together. A-LOC-2: approximate-only grant leads to a working manual-pickup path. A-LOC-3: denied state shows a Settings link and app remains usable (Rider). A-LOC-4: Driver background requested only after foreground, from D10, with option label and "Not now" — **only if it proves required (D-026)**; otherwise never requested. A-LOC-5: Rider manifest contains **no** `ACCESS_BACKGROUND_LOCATION`. A-LOC-6 (D-026): Driver cannot go online with approximate-only location; revoking permission or turning precise off while online pauses new requests with an in-app reason. |
| Map home & booking | R07–R12, D09 | A-MAP-1: map edge-to-edge and controls inside insets, verified with a cutout device. A-MAP-2: sheet drag handle not in the gesture area, and sheet operable via TalkBack actions. A-MAP-3: back from R09 returns to R08/R07 without losing the destination. A-MAP-4: back on R12 / R11 (offer open) shows a cancel confirmation. A-MAP-5: all controls ≥ 48dp. |
| Active trip | R13–R14, D11–D14 | A-TRIP-1: back shows "Cancel ride?" including any fee (BR-081). A-TRIP-2: Driver foreground-service notification is visible while online and gone after going offline. A-TRIP-3: app killed and reopened restores the trip. A-TRIP-4: with `POST_NOTIFICATIONS` denied, the trip still works and the FGS notice appears in Task Manager. |
| Lists & account | R15–R28, D15–D17 | A-ACC-1: at 200% font scale, rows wrap and do not truncate the primary label. A-ACC-2: TalkBack reads each row with a unique label. A-ACC-3: Settings → "Location" / "Notifications" open the system app settings. A-ACC-4: delete account reachable in ≤ 3 taps from Account. |
| Driver onboarding | D03–D08 | A-DRV-1: back from a half-filled form asks "Discard changes?". A-DRV-2: document upload uses the system photo picker (no broad storage permission) **[Unverified on Android 7–12 fallback]**. |

## 9. Open items

| ID | Item |
|---|---|
| AND-01 | `predictiveBackGestureEnabled` is `false` in both apps (opt-out). Decide and test. |
| AND-02 | Driver `app.json` still uses template `name`/`slug`/`scheme` "rider". `expo-location` plugin not configured in either app. |
| AND-03 | Notification channels and `expo-notifications` not reviewed or installed. |
| AND-04 | Play Console background-location declaration requirements not verified. |
| AND-05 | Large-screen/foldable orientation behaviour under targetSdk 36 not verified. |
| AND-06 | (2026-10-21) Verify in the Driver dev build whether `expo-location` background updates with a foreground service start with foreground permission only, or require `ACCESS_BACKGROUND_LOCATION` (D-026). Test locked screen, background, app killed and OEM battery optimisation (`DEVICE_TEST_MATRIX.md`). |
