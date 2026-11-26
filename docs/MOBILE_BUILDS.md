# Mobile test builds with EAS Build (D-074)

Installable test builds of **GoBye** (rider, `apps/rider`) and **GoBye Driver** (`apps/driver`). They run on
**simulated services** (`EXPO_PUBLIC_USE_MOCKS=true`): no hosted API and no `*.gobye.app` address is needed
or used. The apps' public configuration is not wired to screens yet, so the API address falls back to
`localhost` and is never called.

## Free plan limits (checked 26 Nov 2026, [expo.dev/pricing](https://expo.dev/pricing.md))

- **Builds:** 15 Android and 15 iOS builds a month. They are low priority, so expect waits of 90+ minutes at busy times.
- **Timeouts and parallel builds:** a build times out after 45 minutes. Up to 5 builds can run at once, only 1 of them on macOS.
- **Charges:** the free plan never charges. At the monthly limit, builds stop until the 1st of the next month ([billing FAQ](https://docs.expo.dev/billing/faq.md)).
- **Usage:** each app/platform is one build. Building both apps for Android uses 2 of the 15.

## Profiles (`apps/<app>/eas.json`)

| Profile | Android | iOS | Needs |
|---|---|---|---|
| `preview` | Installable **APK**, shared by link or QR code | **Simulator** build (runs in Xcode's iOS Simulator on a Mac only) | A free Expo account |
| `demo` | Same as `preview`, plus variables stored in the EAS **preview** environment (connected demo) | Same | Demo relay variables on EAS (below) |
| `ios-device` | (same APK) | Ad hoc build for registered iPhones | **Apple Developer Program, $99/yr**: owner approval first |

Version numbers come from `app.json` (`appVersionSource: local`). Native folders are generated on the build
server from `app.json` (`android/` and `ios/` stay git-ignored). `eas build` runs from the app folder;
the upload contains the whole repository so the `@gobye/core` and `@gobye/ui` workspaces are included.

## First APK (from your computer)

```
npm install -g eas-cli        # once
eas login                     # your Expo account (free)
cd apps/rider
eas init                      # once per app: creates the project on expo.dev and adds its id to app.json
npm run build:apk             # = eas build --platform android --profile preview
```

- Answer **Yes** to "Generate a new Android Keystore?". Expo stores it; keep it, because it signs every later build.
- When the build finishes, the terminal and expo.dev show an install link and a QR code. Open the link on an Android phone, download the APK and allow "Install unknown apps" for the browser.
- Repeat in `apps/driver`.
- Commit the two `app.json` changes (`extra.eas.projectId` and `owner`).

Root shortcuts: `npm run rider:apk` and `npm run driver:apk`, after `eas init` has been run in each app.

## From GitHub instead

**Actions → Build apps (EAS)** queues builds without your computer. It needs:
- the `projectId` committed;
- the Android keystore created by the first build from your computer;
- `EXPO_TOKEN` added under Settings → Environments → staging (create it at expo.dev → Account settings → Access tokens).

## iOS

- **Now, free:** `npm run build:ios-sim` gives a Simulator build. It installs only in Xcode's Simulator on a Mac, not on an iPhone.
- **iPhone, free:** use Expo Go with `npx expo start --tunnel`, if Expo Go in the App Store supports SDK 57. If it doesn't, use the web preview.
- **Real iPhones, TestFlight or ad hoc:** these need the Apple Developer Program ($99/yr, D-U-N-S first for a company account). Ask the owner before enrolling. After that, use `eas build -p ios --profile ios-device`, or a store profile for TestFlight.

## Connected demo in a build (optional)

The `demo` profile reads `EXPO_PUBLIC_DEMO_RELAY_URL` and `EXPO_PUBLIC_DEMO_RELAY_KEY` from the EAS **preview** environment ([DEMO_CONNECTED.md](DEMO_CONNECTED.md)):

```
eas env:create --environment preview --name EXPO_PUBLIC_DEMO_RELAY_URL --value https://<project>.supabase.co --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_DEMO_RELAY_KEY --value <anon key> --visibility sensitive
eas build -p android --profile demo
```

- **Values:** only the project URL and the public anon/publishable key, never a service role key or database URL.
- **Tables:** the demo tables let that key read and write. Run `supabase/migrations/20261022_demo_relay.sql` only on a project used for demos, and drop the tables afterwards.
- **Rebuilds:** a local Wi-Fi relay address does not work in a shared APK, so changing the relay means a new build.
