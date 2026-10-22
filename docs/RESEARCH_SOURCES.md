# GoBye — Research Sources (evidence register)

All sources were reviewed on **2026-10-21** from official pages. Findings were extracted from the live page text. Anything not stated by the source is marked **[Unverified]** here or in the linked project document. Do not add rows for pages that were not actually read.

**Tooling note (D-013):** the official Expo Claude Code plugin (`expo@claude-plugins-official`) was **not installed** in the cloud build session (marketplace not configured; installation needs the owner's permission). `.claude/settings.json` in the repo enables it for local sessions. Expo documentation was read directly instead. The Expo MCP server was not connected.

**Network note:** in the build container, `api.expo.dev` was blocked by the network proxy, so `npx expo install` was run with `EXPO_OFFLINE=1`. Offline mode resolves versions from the locally bundled SDK compatibility data rather than the API **[Unverified: exact resolution mechanism]**. Run `npx expo install --check` / `npx expo-doctor` on an unrestricted network before release.

**SDK note:** most Expo pages were read at `/versions/latest/` (currently SDK 58). The project uses **SDK 57** (D-001). Where SDK 57 behaviour could differ, the installed package in `node_modules` was checked, or the item is marked.

---

Project-file paths marked *(planned)* do not exist yet; at the time of writing the apps contain only `src/app/_layout.tsx` and `src/app/index.tsx`.

## 1. Expo

| # | Title | URL | Platform / SDK | Key implementation decision | Project files | Unresolved |
|---|---|---|---|---|---|---|
| E1 | Expo Skills | https://docs.expo.dev/skills/ | Claude Code / any SDK | Install with `claude plugin install expo@claude-plugins-official`; the plugin also registers the Expo MCP server | `.claude/settings.json`, `DECISIONS.md` D-013 | Plugin not installed in the cloud session |
| E2 | Using Claude Code with Expo | https://docs.expo.dev/agents/claude/ | Claude Code | Project-scope install with `--scope project`; `/mcp` to sign in; template ships `AGENTS.md` + `.claude/settings.json` | `AGENTS.md`, `.claude/settings.json` | Not verified locally |
| E3 | Expo MCP Server | https://docs.expo.dev/mcp/ | SDK 54+ for local tools | Endpoint `https://mcp.expo.dev/mcp`. Local automation is iOS-simulator/macOS only, so the Windows owner cannot use it | — | Not connected |
| E4 | SDK versions table | https://docs.expo.dev/versions/latest/ | SDK 56–58 | SDK 57 = RN 0.86, React 19.2.3, Android 7+ (target 36), iOS 16.4+, Xcode 26.4+ | `DECISIONS.md` D-001, `ARCHITECTURE.md` | New Architecture status not stated on page **[Unverified]** |
| E5 | Expo changelog / SDK 58 release | https://expo.dev/changelog/sdk-58 | SDK 58 | Stay on SDK 57: "Expo Go for SDK 58 ... will be released within a few weeks". Native tabs stable in 58 | `DECISIONS.md` D-001, D-003 | Upgrade path once Expo Go 58 ships |
| E6 | Expo changelog index | https://expo.dev/changelog | — | Expo Go now requires login (Sep 3 2026) | `README.md` (dev setup) | — |
| E7 | Expo Router — Tabs | https://docs.expo.dev/router/advanced/tabs/ | Router (latest) | JS `Tabs` in `(tabs)/_layout.tsx`; `href: null` hides a tab | `apps/*/src/app/(tabs)/_layout.tsx` (planned), D-003 | — |
| E8 | Expo Router — Native tabs | https://docs.expo.dev/router/advanced/native-tabs/ | SDK 54–58 | Rejected: icons must be SF/Material/images, not MingCute components; SDK 57 import is `unstable-native-tabs` | D-003 | Revisit if MingCute is exported to images |
| E9 | Expo Router — Modals | https://docs.expo.dev/router/advanced/modals/ | Router (latest) | `formSheet` not used for map sheet: Android max 3 detents, no header, dims background | D-010, `ARCHITECTURE.md` §3 | — |
| E10 | Expo Router — Typed routes | https://docs.expo.dev/router/reference/typed-routes/ | Router (latest) | `experiments.typedRoutes: true` (enabled in both `app.json`) | `apps/*/app.json` | Page says "beta" |
| E11 | MapView (react-native-maps) | https://docs.expo.dev/versions/latest/sdk/map-view/ | SDK 58 page (1.29.11 recommended) | Use react-native-maps (in Expo Go); production keys via `androidGoogleMapsApiKey` / `iosGoogleMapsApiKey` | D-004, `MapCanvas` (planned) | Installed 1.27.2 for SDK 57; provider choice open (Q-007) |
| E12 | Maps (expo-maps) | https://docs.expo.dev/versions/latest/sdk/maps/ | SDK 58 page | Rejected: Apple Maps only on iOS, iOS 17+, dev build | D-004 | Expo Go support not stated **[Unverified]** |
| E13 | Location (expo-location) | https://docs.expo.dev/versions/latest/sdk/location/ (also cited: https://docs.expo.dev/versions/v57.0.0/sdk/location/) | SDK 57/58 | Rider foreground only; Driver background + foreground service; background unsupported in Expo Go | D-012, `ANDROID_GUIDELINES.md` §5, `APP_STORE_COMPLIANCE.md` | Plugin not yet configured in `app.json` |
| E14 | Work with monorepos | https://docs.expo.dev/guides/monorepos/ | SDK 52+ | npm workspaces `apps/*` + `packages/*`; one React / RN version | root `package.json`, D-002 | — |
| E15 | Submit to the Apple App Store | https://docs.expo.dev/submit/ios/ | EAS | `eas build --auto-submit`, `ascAppId` per app; no submission without authorisation | `APP_STORE_COMPLIANCE.md` | Apple account not configured |
| E16 | Apple privacy (Expo guide) | https://docs.expo.dev/guides/apple-privacy/ | SDK 57 | `expo.ios.privacyManifests` in `app.json` | `APP_STORE_COMPLIANCE.md` §privacy manifests | Audit after first production build |

## 2. Android

| # | Title | URL | Platform | Key implementation decision | Project files | Unresolved |
|---|---|---|---|---|---|---|
| A1 | Design & Plan (hub) | https://developer.android.com/design | Android | Entry point; quality/accessibility/permissions guides | `ANDROID_GUIDELINES.md` | — |
| A2 | Make apps more accessible | https://developer.android.com/guide/topics/ui/accessibility/apps | Android | 48dp targets; contrast 4.5:1 / 3:1; purposeful content descriptions | `ANDROID_GUIDELINES.md` §6, `packages/ui` | — |
| A3 | Display content edge-to-edge | https://developer.android.com/develop/ui/views/layout/edge-to-edge | Android 15+ / target 35+ | Edge-to-edge always; insets via safe-area-context | `ANDROID_GUIDELINES.md` §3 | IME page not reviewed |
| A4 | Behavior changes: Android 16 | https://developer.android.com/about/versions/16/behavior-changes-16 | target 36 | Edge-to-edge opt-out disabled; predictive back default (opt-out possible) | `ANDROID_GUIDELINES.md` §2–3 | AND-01 (app.json opts out) |
| A5 | Predictive back gesture | https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture | Android 13+ | Intercept back only on cancel-sensitive screens | `ANDROID_GUIDELINES.md` §2 | — |
| A6 | Location permissions | https://developer.android.com/training/location/permissions | Android | Must work with approximate location; FGS type location | D-012 | — |
| A7 | Request runtime location permissions | https://developer.android.com/develop/sensors-and-location/location/permissions/runtime | Android 11/12+ | FINE+COARSE together; background requested separately | D-012, R06, D10 | — |
| A8 | Request background location | https://developer.android.com/develop/sensors-and-location/location/permissions/background | Android 11+ | D10 explanation screen with option label + decline | D10 | Play Console declaration not covered **[Unverified]** |
| A9 | Notification runtime permission | https://developer.android.com/develop/ui/views/notifications/notification-permission | Android 13+ | Ask in context, never at launch | `ANDROID_GUIDELINES.md` §5.3 | Channels page not reviewed (AND-03) |
| A10 | Foreground service types | https://developer.android.com/develop/background-work/services/fgs/service-types | Android 14+ | Driver FGS type `location` + `FOREGROUND_SERVICE_LOCATION` | D-012 | — |

Installed evidence: `node_modules/react-native/gradle/libs.versions.toml` (minSdk 24, targetSdk 36, compileSdk 36); `node_modules/@expo/config-plugins/build/android/PredictiveBackGesture.js`; `node_modules/@expo/prebuild-config/build/plugins/unversioned/edge-to-edge/withEdgeToEdge.js`.

## 3. Apple

Apple sources were reviewed in this session and are applied in `IOS_GUIDELINES.md`, `APP_STORE_COMPLIANCE.md` and `SECURITY_PRIVACY.md`. The "page date" is the change date shown on the page, where one was recorded.

| # | Title | URL | Page date | Key implementation decision | Project files | Unresolved |
|---|---|---|---|---|---|---|
| P1 | App Review Guidelines | https://developer.apple.com/app-store/review/guidelines/ | Last updated Oct 16 2026 | In-app account deletion (5.1.1(v)); no IAP for rides (3.1.3(e)); no extra login service while phone+OTP only (4.8); mock builds not submitted as live service | `APP_STORE_COMPLIANCE.md`, BR-101, D-008 | D-008 still Proposed |
| P2 | HIG — Accessibility | https://developer.apple.com/design/human-interface-guidelines/accessibility | 9 Jun 2025 | 44×44pt targets, Dynamic Type, VoiceOver labels | `IOS_GUIDELINES.md` | — |
| P3 | HIG — Typography | https://developer.apple.com/design/human-interface-guidelines/typography | — | Body 17 baseline; text scales | D-014 | — |
| P4 | HIG — Layout | https://developer.apple.com/design/human-interface-guidelines/layout | 9 Sep 2026 | Safe areas, margins | `IOS_GUIDELINES.md` | — |
| P5 | HIG — Tab bars | https://developer.apple.com/design/human-interface-guidelines/tab-bars | 8 Jun 2026 | 3 one-word Rider tabs | D-003, `ARCHITECTURE.md` §3 | — |
| P6 | HIG — Sheets | https://developer.apple.com/design/human-interface-guidelines/sheets | 24 Mar 2026 | Non-modal map sheet with grabber | D-010 | — |
| P7 | HIG — Maps | https://developer.apple.com/design/human-interface-guidelines/maps | 18 Dec 2024 | Map-first home; controls do not obscure map | R07, R09, R13 | — |
| P8 | HIG — Search fields | https://developer.apple.com/design/human-interface-guidelines/search-fields | 8 Jun 2026 | "Where are you going?" field, suggestions | R07, R08 | — |
| P9 | HIG — Motion | https://developer.apple.com/design/human-interface-guidelines/motion | 9 Sep 2025 | Reduce Motion support | D-010, R12 | — |
| P10 | HIG — Playing haptics | https://developer.apple.com/design/human-interface-guidelines/playing-haptics | 7 May 2024 | Haptics on state changes, user can disable | R27, `expo-haptics` | — |
| P11 | HIG — Feedback | https://developer.apple.com/design/human-interface-guidelines/feedback | — | Clear status/error feedback | `UI_STATES.md` | — |
| P12 | HIG — Alerts | https://developer.apple.com/design/human-interface-guidelines/alerts | 2 Feb 2024 | Confirm destructive actions (cancel ride, delete account) | R13, R28 | — |
| P13 | HIG — Privacy | https://developer.apple.com/design/human-interface-guidelines/privacy | 21 Jun 2023 | Pre-permission screen with single "Continue" | R06, D10 | — |
| P14 | HIG — Loading | https://developer.apple.com/design/human-interface-guidelines/loading | 9 Jun 2025 | Skeleton/progress states | `UI_STATES.md` | — |
| P15 | HIG — Dark Mode | https://developer.apple.com/design/human-interface-guidelines/dark-mode | 6 Aug 2024 | Follow system; no in-app switch | `ARCHITECTURE.md` §7 | — |
| P16 | Requesting authorization to use location services | https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services | — | When-In-Use key needed for both modes; Always key not needed for Driver while Always is never requested (D-026) — verify expo-location plugin output in the dev build | `APP_STORE_COMPLIANCE.md` §5 | — |
| P17 | Handling location updates in the background | https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background | — | `UIBackgroundModes: location` for Driver only | D-012 | — |
| P18 | `allowsBackgroundLocationUpdates` | https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates | — | Enabled on go-online, disabled on go-offline | `SECURITY_PRIVACY.md` | — |
| P19 | `NSLocationTemporaryUsageDescriptionDictionary` | https://developer.apple.com/documentation/bundleresources/information-property-list/nslocationtemporaryusagedescriptiondictionary | — | `pickup` purpose key for temporary precise location | `APP_STORE_COMPLIANCE.md` | — |
| P20 | Privacy manifest files | https://developer.apple.com/documentation/bundleresources/privacy-manifest-files | — | `NSPrivacyTracking: false`; declare collected data types | `APP_STORE_COMPLIANCE.md` | Audit after first build |
| P21 | Describing use of required reason API | https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api | — | Declare reasons incl. dependencies' | `APP_STORE_COMPLIANCE.md` | Same |
| P22 | App privacy details | https://developer.apple.com/app-store/app-privacy-details/ | — | Nutrition label: location, contact info, identifiers | `APP_STORE_COMPLIANCE.md` | Depends on backend/analytics choices |
| P23 | Upcoming requirements | https://developer.apple.com/news/upcoming-requirements/ | — | Xcode 26 / iOS 26 SDK required for uploads since 28 Apr 2026, met by EAS images | D-001 | — |
| P24 | TestFlight | https://developer.apple.com/testflight/ | — | Internal then external testing; external needs beta review | `APP_STORE_COMPLIANCE.md` | — |

## 4. MingCute

| # | Title | URL | Version | Key implementation decision | Project files | Unresolved |
|---|---|---|---|---|---|---|
| M1 | mingcute-icons (GitHub README) | https://github.com/mingcute-design/mingcute-icons | — | Apache-2.0; 1,663 icons × Core Regular/Filled; RN needs `react-native-svg` ≥ 13 | D-015, `DEPENDENCIES_AND_LICENSES.md` | — |
| M2 | `@mingcute/react-native` (npm registry metadata + package files) | https://www.npmjs.com/package/@mingcute/react-native | 3.0.2 (published/modified 2026-07-31) | Deep imports `@mingcute/react-native/core-regular/<icon>`; props `size`, `color`, `primaryColor`, `secondaryColor`, `secondaryOpacity`, `title` + `SvgProps`; peers react ≥18, RN ≥0.72, react-native-svg ≥13 | `packages/ui` `<Icon>` (planned) | npmjs.com web page failed to load; data from registry API and tarball |
