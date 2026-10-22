# GoBye — Device Test Matrix

**Rule:** a cell may change from `Untested` only after the scenario has actually been executed on the listed device or emulator. Record the date, build (commit / EAS build ID), tester and result (`Pass`, `Fail – BUG-id`, `Blocked – reason`). Never mark a scenario as tested from code review or a simulator run of a different device.

**Supported range (SDK 57, D-001):** iOS 16.4+ · Android 7.0 (API 24)+ · target API 36. Portrait only.
**Build types:** `Go` = Expo Go (SDK 57) · `Dev` = development build (`eas build --profile development`, required for Driver background location) · `Rel` = release/TestFlight/internal-testing build.

Status as of 2026-10-21: **nothing has been tested on any device or emulator.**

---

## 1. Device set

| ID | Type | Device (or equivalent) | OS | Screen class | Notes | Status |
|---|---|---|---|---|---|---|
| I1 | iPhone, small | iPhone SE (2nd/3rd gen) | iOS 16.4 (minimum) | 4.7", Home button, no notch | Smallest supported layout | Untested |
| I2 | iPhone, small | iPhone 13 mini | iOS 17.x | 5.4", notch | | Untested |
| I3 | iPhone, standard | iPhone 15 / 16 | iOS 18.x | 6.1", Dynamic Island | | Untested |
| I4 | iPhone, large | iPhone 15/16/17 Pro Max or Plus | iOS 26.x (latest) | 6.7"+, Dynamic Island | Liquid Glass system UI | Untested |
| I5 | iOS Simulator | iPhone SE + Pro Max simulators | iOS 26.x | — | Requires macOS (owner uses Windows; EAS + physical devices instead) | Untested |
| A1 | Android, small/low-end | ≤ 5.5", 2–3 GB RAM | Android 7.0/7.1 (API 24/25, minimum) | Small, 3-button nav | Pre-runtime-notification-permission, pre-background-location permission | Untested |
| A2 | Android, mid | ~6.1" | Android 10 (API 29) | Medium | First version with `ACCESS_BACKGROUND_LOCATION` | Untested |
| A3 | Android, mid | ~6.4" | Android 12 (API 31/32) | Medium | Approximate-location option | Untested |
| A4 | Android, large | ~6.7" | Android 13 (API 33) | Large | `POST_NOTIFICATIONS` runtime permission | Untested |
| A5 | Android, mid | ~6.3" | Android 14 (API 34) | Medium | FGS type `location` required | Untested |
| A6 | Android, large | ~6.7" | Android 15 (API 35) | Large, cutout | Edge-to-edge enforced (target ≥ 35) | Untested |
| A7 | Android, Pixel | Pixel 8/9 class | Android 16 (API 36) | Medium | Target-36 behaviour (predictive back, edge-to-edge no opt-out) | Untested |
| A8 | Android, foldable/tablet | Foldable or 10" tablet | Android 15/16 | Large screen | Portrait-only app on large screen | Untested |
| A9 | Android Emulator | Pixel AVDs API 24, 30, 34, 36 | — | — | | Untested |

## 2. Configuration dimensions

Run the core flows (§3) under each configuration on the devices marked.

| Config | Values | I1 | I2 | I3 | I4 | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Navigation mode | iOS Home button / Home indicator | Untested | Untested | Untested | Untested | — | — | — | — | — | — | — | — |
| Navigation mode | Android gesture navigation | — | — | — | — | — | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| Navigation mode | Android 3-button navigation | — | — | — | — | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| Font scaling | Default | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| Font scaling | Largest standard size | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| Font scaling | iOS Accessibility sizes (AX1–AX5) / Android max (200% where available) | Untested | — | Untested | Untested | — | — | — | — | Untested | — | Untested | — |
| Display size | Android "Display size" largest | — | — | — | — | Untested | — | — | — | Untested | — | Untested | — |
| Appearance | Light | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| Appearance | Dark | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| Motion | Reduce Motion / Remove animations ON | Untested | — | Untested | Untested | — | — | — | Untested | — | — | Untested | — |
| Screen reader | VoiceOver ON | Untested | — | Untested | Untested | — | — | — | — | — | — | — | — |
| Screen reader | TalkBack ON | — | — | — | — | — | — | Untested | — | Untested | — | Untested | — |
| Language/region | English (Nigeria), 24-hour clock | Untested | — | Untested | — | Untested | — | — | — | — | — | Untested | — |

## 3. Connectivity scenarios

| ID | Scenario | How | iOS (I3) | Android (A5) | Android low-end (A1) |
|---|---|---|---|---|---|
| N1 | Offline at launch | Airplane mode before launch | Untested | Untested | Untested |
| N2 | Goes offline on Home (R07) | Toggle airplane mode | Untested | Untested | Untested |
| N3 | Offline during quote (R09) | Mock flag `MOCK_FLAGS` failure / airplane mode | Untested | Untested | Untested |
| N4 | Offline during Quick Match search (R12) | Airplane mode mid-search | Untested | Untested | Untested |
| N5 | Offline during negotiation with live responses (R11) | Airplane mode with responses visible | Untested | Untested | Untested |
| N6 | Offline during active trip (R13 / D13) | Airplane mode mid-trip | Untested | Untested | Untested |
| N7 | Slow network (2G/3G profile, high latency) | Network Link Conditioner (iOS) / emulator network speed | Untested | Untested | Untested |
| N8 | Reconnect after offline (state resync, no duplicate booking) | Restore connectivity | Untested | Untested | Untested |
| N9 | Weak GPS (indoors), accuracy shown | Indoor test | Untested | Untested | Untested |

## 4. Permission states

### Rider (foreground only)

| ID | State | Expected | iOS 16.4 (I1) | iOS 26 (I4) | Android 7 (A1) | Android 12 (A3) | Android 16 (A7) |
|---|---|---|---|---|---|---|---|
| PR1 | Not determined, then grant precise | Pickup from GPS | Untested | Untested | Untested | Untested | Untested |
| PR2 | Grant approximate only | Manual-pickup path + precise prompt | — | Untested | — | Untested | Untested |
| PR3 | Denied | Manual entry, Settings link | Untested | Untested | Untested | Untested | Untested |
| PR4 | iOS "Allow Once", relaunch | Re-request at next pickup | Untested | Untested | — | — | — |
| PR5 | Restricted (iOS Screen Time / MDM) | Manual entry, no Settings nag | Untested | Untested | — | — | — |
| PR6 | Location services off system-wide | Prompt to enable, manual entry | Untested | Untested | Untested | Untested | Untested |
| PR7 | Permission revoked while app backgrounded | Graceful downgrade on resume | Untested | Untested | Untested | Untested | Untested |
| PR8 | Notifications denied | Trip works; in-app status only | Untested | Untested | — | — | Untested |

### Driver (Dev build required)

| ID | State | Expected | iOS 16.4 (I1) | iOS 26 (I4) | Android 10 (A2) | Android 14 (A5) | Android 16 (A7) |
|---|---|---|---|---|---|---|---|
> **Revised 2026-10-21 (D-026, Q-012 resolved).** PD1–PD3 were written for an Always / "Allow all the time" flow. Under D-026 the Driver requests **When In Use + precise only** and never requests Always; PD1–PD3 are kept for history but superseded by PD9–PD20 where they differ. PD4 is now decided (not a proposal).

| PD1 | Foreground granted, background not yet asked | D10 shown on first go-online *(superseded: D10 now precedes the When In Use request — see PD9)* | Untested | Untested | Untested | Untested | Untested |
| PD2 | Background granted ("Always" / "Allow all the time") | Online; updates continue with screen off *(superseded: Always is not requested; if a driver grants it in Settings, behaviour must match PD10)* | Untested | Untested | Untested | Untested | Untested |
| PD3 | Background declined | Explain limitation; online only while app is open **[proposal — superseded by D-026; Android only if background permission proves required]** | Untested | Untested | Untested | Untested | Untested |
| PD4 | Approximate only | Cannot go online; explanation + Open Settings (D-026, BR-073) | — | Untested | — | Untested | Untested |
| PD5 | Foreground service notification while online | Persistent "You're online" notification | — | — | Untested | Untested | Untested |
| PD6 | Go offline | Updates stop, notification removed, task unregistered | Untested | Untested | Untested | Untested | Untested |
| PD7 | App swiped away while online | Behaviour per `killServiceOnDestroy` decision | Untested | Untested | Untested | Untested | Untested |
| PD8 | Notifications denied while online (Android 13+) | FGS notice visible in Task Manager | — | — | — | Untested | Untested |
| PD9 | First go-online: D10 → When In Use prompt, precise granted | Online (available); **no Always prompt at any point**; no separate background prompt on iOS | Untested | Untested | Untested | Untested | Untested |
| PD10 | Online (available), screen **locked** 10 min | Updates continue at the `available` profile; iOS blue indicator; Android notification; position not flagged stale | Untested | Untested | Untested | Untested | Untested |
| PD11 | Online, app in **background** (other app in front) 10 min | Updates continue; requests still delivered (push dependent, Q-014) | Untested | Untested | Untested | Untested | Untested |
| PD12 | To pickup / on trip with screen locked | Faster profile (5 s) applied; rider sees fresh driver position | Untested | Untested | Untested | Untested | Untested |
| PD13 | App **killed** by the user (swipe away) while online | iOS: updates stop (no relaunch without Always) → server marks stale, matching paused; on reopen, driver told and session resumes. Android: per `killServiceOnDestroy` | Untested | Untested | Untested | Untested | Untested |
| PD14 | App terminated by the OS / OEM battery optimiser while online | Detected as stale/interrupted; matching paused; driver notified on reopen | Untested | Untested | Untested | Untested | Untested |
| PD15 | Location permission **revoked in Settings mid-session** (available) | New requests paused; reason shown; no crash; restoring permission resumes | Untested | Untested | Untested | Untested | Untested |
| PD16 | Permission revoked **during an active trip** | Trip continues (rider sees "last updated"); driver told to restore; cannot take new requests | Untested | Untested | Untested | Untested | Untested |
| PD17 | **Precise Location turned off** mid-session | `approximate_only` → requests paused with "Turn on Precise Location" | — | Untested | — | Untested | Untested |
| PD18 | **Interrupted session** (Location Services off system-wide / airplane + GPS off / tunnel) then restored | `session_interrupted` / `stale_position` while lost; resumes and un-pauses on next fix | Untested | Untested | Untested | Untested | Untested |
| PD19 | Go offline while on trip | Blocked: "Finish the trip first" | Untested | Untested | Untested | Untested | Untested |
| PD20 | Battery drain over 60 min online (available) and 30 min on trip | Record % drain per profile for Q-045 tuning | Untested | Untested | Untested | Untested | Untested |
| PD21 | Built Info.plist / manifest inspection | iOS: `UIBackgroundModes` location present; whether `NSLocationAlwaysAndWhenInUseUsageDescription` is emitted by `expo-location`. Android: whether `ACCESS_BACKGROUND_LOCATION` is needed for `startLocationUpdatesAsync` (AND-06) | Untested | Untested | Untested | Untested | Untested |

### Pickup accuracy validation — proposed Google Maps Platform (D-025, Q-007; Dev build with `PROVIDER_GOOGLE` + backend Places/Routes)

Per point: search the place, compare the result/pin with the actual kerbside pickup point (metres), check reverse-geocode label, and compare Routes ETA with observed travel time (peak and off-peak). Pass threshold to be agreed (proposal: pin within 30 m of a usable pickup point).

| ID | City | Location (mock places are approximate) | iOS (I3) | Android (A5) | Android low-end (A1) |
|---|---|---|---|---|---|
| PA1 | Abuja | Nnamdi Azikiwe International Airport (arrivals) | Untested | Untested | Untested |
| PA2 | Abuja | Jabi Lake Mall | Untested | Untested | Untested |
| PA3 | Abuja | Wuse Market | Untested | Untested | Untested |
| PA4 | Abuja | National Mosque / Eagle Square / Millennium Park | Untested | Untested | Untested |
| PA5 | Abuja | Ceddi Plaza (Central Business District) | Untested | Untested | Untested |
| PA6 | Abuja | Residential estate address (unnamed street / landmark-based) | Untested | Untested | Untested |
| PA7 | Lagos | Murtala Muhammed International Airport | Untested | Untested | Untested |
| PA8 | Lagos | Ikeja City Mall / mainland landmark | Untested | Untested | Untested |
| PA9 | Lagos | Victoria Island / Lekki address | Untested | Untested | Untested |
| PA10 | Lagos | Residential estate address (landmark-based directions) | Untested | Untested | Untested |
| PA11 | Both | Routes ETA vs observed (5 trips per city, peak + off-peak) | Untested | Untested | Untested |
| PA12 | Both | Google logo/attribution visible above `MapSheet` at all snap points | Untested | Untested | Untested |

## 5. Core flow × device

| ID | Flow | I1 | I3 | I4 | A1 | A4 | A6 | A7 | A8 |
|---|---|---|---|---|---|---|---|---|---|
| F1 | Rider sign-in (R03–R05) | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F2 | Rider Quick Match booking → trip → receipt → rating | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F3 | Rider Negotiate: offer → responses → select → trip | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F4 | Rider cancellation (free window / with fee) | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F5 | System back / swipe-back across booking flow | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F6 | Keyboard on all forms | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F7 | Safe areas / edge-to-edge / cutouts / status bar colour | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F8 | Background → foreground with offer timer running | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F9 | Kill & reopen during active trip (state recovery) | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F10 | Delete account (R28 / D17) | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F11 | Driver onboarding → approved → go online → request → trip → complete | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F12 | Driver negotiation: accept / counter / decline | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F13 | Rider pays by bank transfer: details → I've sent the transfer → checking → paid / not received → check again / switch to wallet (simulated) | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F14 | Kill & reopen while awaiting transfer / checking (no double charge) | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F15 | Wallet shortfall: Quick Match blocked, Negotiate response not selectable | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |
| F16 | Driver buys access package → goes online (Driver UI not yet built) | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested |

## 6. Execution log

| Date | Build | Device ID | Scenario IDs | Result | Tester | Notes |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | No executions recorded |

## UI update brief checks (added 2026-10-21) — NOT YET RUN

| ID | Check | iPhone | Android | Result |
|---|---|---|---|---|
| DV-UI-01 | Bottom tabs are exactly Home · Activities · Wallet · Account; Android back from each tab behaves | ☐ | ☐ | Not run |
| DV-UI-02 | Appearance Light / Dark / System applies immediately and persists after force-quit; map follows | ☐ | ☐ | Not run |
| DV-UI-03 | Edit pickup via pencil → search, choose on map, current location; options re-route and re-price | ☐ | ☐ | Not run |
| DV-UI-04 | Add / replace / remove profile photo (library + camera permission prompts); Home avatar updates | ☐ | ☐ | Not run |
| DV-UI-05 | Payment states: wallet paid, wallet too low, transfer checking → not received → paid, duplicate taps ignored, no Pay later (back is blocked until paid), Check later + Home banner while a transfer is awaiting confirmation | ☐ | ☐ | Not run |
| DV-UI-06 | Only "GoBye Car" offered; no Keke anywhere | ☐ | ☐ | Not run |
| DV-UI-07 | Onboarding drift animates; still with Reduce Motion / Remove animations | ☐ | ☐ | Not run |
| DV-UI-08 | Keyboard and tab bar never cover inputs or primary buttons (sheets, deposit, passenger) | ☐ | ☐ | Not run |
| DV-UI-09 | Receipt PDF generates and opens the share sheet | ☐ | ☐ | Not run |
