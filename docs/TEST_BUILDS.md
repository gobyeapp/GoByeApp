# Android test builds and the connected demo (D-075)

How to build installable Android APKs of the rider and driver apps, with a working map, all three
(rider, driver, admin) sharing the same **test** rides through Supabase **gobye-staging**.

Everything here is test data: no real money, no real verification, no real SMS. iPhone builds come later
and need an Apple Developer account (owner decision, paid).

## Decision (D-075) — Android test builds with Google Maps, and the connected demo on gobye-staging (2026-11-26, owner)

- **Why:** the first Android APK closed at once with a NullPointerException. The map (react-native-maps) uses Google Maps on Android, and the apps had no Google Maps key.
- **Maps:** the owner chose Google Maps (D-025 stays the provider) and handles Google Cloud billing. The key comes only from the build variable `GOOGLE_MAPS_ANDROID_API_KEY` (`app.config.js` in both apps). It is restricted to the two Android packages and Maps SDK for Android. Without a key, `MapCanvas` shows "Map not available in this test build" on Android instead of crashing.
- **Builds:** EAS `preview` profile (installable APK, internal distribution) in each app.
- **Shared test data:** the connected demo (D-049) over Supabase **gobye-staging**, not a hosted API yet. Rider and driver builds get `EXPO_PUBLIC_DEMO_RELAY_URL` / `_KEY` from EAS. The admin gets them from the staging environment (`DEMO_RELAY_URL` variable, `DEMO_RELAY_KEY` secret), **preview builds only**.
- **Admin, narrowing D-070:** the Connected demo page now also shows when the build has a relay address (`DEMO_RELAY` in `data/mode.ts`), without the other demo tools. When the address is unset, the page is removed from the bundle, exactly as before.
- **Relay key:** publishable keys (`sb_publishable_…`) go in `apikey` only; a legacy anon key (JWT) also as a bearer token.

## What is in the repository

| File | What it does |
|---|---|
| `apps/rider/app.config.js`, `apps/driver/app.config.js` | Keep everything in `app.json` and add the Android Google Maps key from the build variable `GOOGLE_MAPS_ANDROID_API_KEY` (`tools/expo/with-android-maps-key.js`). The key never goes into git. |
| `packages/ui/src/map/MapCanvas.tsx` | On Android, a build without the key shows "Map not available in this test build" instead of crashing (react-native-maps needs the key on Android). iOS uses Apple Maps. |
| `apps/rider/eas.json`, `apps/driver/eas.json` | EAS profile `preview`: an installable APK for internal testing, using the EAS environment "preview". |
| `.github/workflows/deploy-sites.yml` | Passes `DEMO_RELAY_URL` (variable) and `DEMO_RELAY_KEY` (secret) from the `staging` environment into **preview** admin builds only. |
| `packages/core/src/relay/client.ts` | Sends a publishable key (`sb_publishable_…`) in `apikey` only; a legacy anon key (JWT) also as a bearer token. |

## 1. Supabase: the demo tables (once)

1. Supabase → project **gobye-staging** (ref `ubdfzekvoikrfxrthfiq`). Never the website waitlist project.
2. SQL Editor → New query → paste `supabase/migrations/20261022_demo_relay.sql` → Run.
   It creates `demo_people`, `demo_driver_applications`, `demo_rides`, `demo_ride_responses`, `demo_events`.
3. Project Settings → API Keys: note the project URL (`https://ubdfzekvoikrfxrthfiq.supabase.co`) and the
   **publishable** key (or the legacy **anon** key). Never the secret / service_role key.

**Warning:** anyone with the app's key can read and change these tables. Test data only. To remove them:

```sql
drop table if exists public.demo_events, public.demo_ride_responses, public.demo_rides,
                     public.demo_driver_applications, public.demo_people;
```

Free Supabase projects pause after a week without use. If the apps show "relay unreachable", resume the
project in the Supabase dashboard.

## 2. Google Maps key (owner)

1. Google Cloud console → project `gobye` → link a billing account (the owner adds the card).
   Set a budget alert.
2. APIs & Services → Library → enable **Maps SDK for Android**.
3. Credentials → Create credentials → API key → **Restrict key**:
   - Application restrictions: **Android apps**. Add `app.gobye.rider` and `app.gobye.driver`, each with
     the SHA-1 from step 3.4 below.
   - API restrictions: **Maps SDK for Android** only.

## 3. EAS (Expo) setup, per app

Run in `apps/rider`, then again in `apps/driver`:

1. `npm i -g eas-cli` (once), then `eas login` (your Expo account; free plan).
2. `eas init`. It links the app to an Expo project and adds `extra.eas.projectId` to `app.json`
   (commit that change). If it asks you to add the id yourself, put it in `app.json` under
   `expo.extra.eas.projectId`.
3. Environment variables on expo.dev → the project → Environment variables, environment **preview**:

   | Name | Value | Visibility |
   |---|---|---|
   | `GOOGLE_MAPS_ANDROID_API_KEY` | the Google key | Sensitive |
   | `EXPO_PUBLIC_DEMO_RELAY_URL` | `https://ubdfzekvoikrfxrthfiq.supabase.co` | Plain text |
   | `EXPO_PUBLIC_DEMO_RELAY_KEY` | the publishable / anon key | Plain text |

   `EXPO_PUBLIC_` values are compiled into the app and readable by anyone who has it. That is why only
   the publishable / anon key goes there.
4. `eas credentials` → Android → `preview` → let EAS create the keystore, then copy the **SHA-1
   fingerprint** into the Google key's Android restriction (step 2.3).
5. `eas build -p android --profile preview`. When it finishes, open the link on the phone and install.

## 4. Admin

GitHub → Settings → Environments → **staging**:

- Variable `DEMO_RELAY_URL` = `https://ubdfzekvoikrfxrthfiq.supabase.co`
- Secret `DEMO_RELAY_KEY` = the publishable / anon key (the workflow refuses a secret key)

Then Actions → **Deploy sites (Cloudflare)** → site `admin`, target `preview`. The admin shows
**Operations → Connected demo**. Production admin builds never get the relay.

## 5. Test on the phone

Follow the end-to-end walk in `DEMO_CONNECTED.md` (driver signs up → admin approves → rider books →
driver accepts → trip → payment, all simulated). Record what was tested, on which phone and Android
version, in `TEST_PLAN.md`.
