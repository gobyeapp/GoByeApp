# GoBye Rider: Responsiveness audit

Date: 2026-10-21. Scope: every implemented Rider screen reachable in the mock build, at ten viewport widths, in light and dark appearance.

## Method (what was actually done)

- **Rendering:** the Rider app was exported as a **web build** (Expo web, `react-native-web`) and driven in headless Chromium 1194 with Playwright 1.56. This is a QA path only; the native iOS and Android bundles do not include the web stubs (checked: the web map placeholder string is absent from both Hermes bundles).
- **Flow:** one scripted journey per run (`tools/qa-web/run.js`): onboarding, phone, OTP, name, Home, location primer, search, ride options (Quick Match and Negotiate), pickup note sheet, searching, driver approaching, arrived, trip in progress, help sheet, trip complete, payment (wallet, method sheet, bank transfer, checking, result), trip complete after payment, passenger sheet, pickup sheet, choose pickup on map, Activities, Wallet, deposit sheet and details, Account and every Account page (profile, places, notifications, referrals, appearance, location, safety, support, legal, delete).
- **Matrix:** at each stable state the script resized the same page through all widths and switched the browser colour scheme (light, dark), so every capture shows the real app state, not a re-render from scratch. Timed trip states (approaching, arrived, in progress, checking) were captured at a subset of widths because the mock trip keeps moving.
- **Automated checks per capture:** document wider than the viewport; any visible text, button or input extending past the left or right edge (excluding horizontal scrollers such as the onboarding pager); single-line text cut with an ellipsis.
- **Visual review:** contact sheets at 320 and 430, light and dark, were inspected for every screen; further spot checks at 360, 375 and 480.
- **Passes:** pass 1 (664 captures) found the issues below; fixes were made; pass 2 (664 captures) confirmed them.

Viewport heights used: 320×568, 360×740, 375×667, 390×844, 393×852, 402×874, 414×896, 430×932, 440×956, 480×1000.

## Results

Legend per cell: light/dark. **P** pass · **F** fixed in this audit (failed in pass 1, passes in pass 2) · **T** intentional single-line truncation only (see notes) · **I** open issue · **–** not captured at that width or theme.

| Screen | 320 | 360 | 375 | 390 | 393 | 402 | 414 | 430 | 440 | 480 |
|---|---|---|---|---|---|---|---|---|---|---|
| 01-onboarding | F/F | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 02-phone | F/F | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 02b-phone-filled | F/– | P/– | P/– | P/– | P/– | P/– | P/– | P/– | P/– | P/– |
| 03-otp | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 04-name | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 05-home | T/T | T/T | T/T | T/T | T/T | T/T | T/T | T/T | P/P | P/P |
| 06-search | F/F | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 06b-search-results | P/– | P/– | P/– | P/– | P/– | P/– | P/– | P/– | P/– | P/– |
| 07-options | F/F | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 07b-options-negotiate | P/– | P/– | P/– | P/– | P/– | P/– | P/– | P/– | P/– | P/– |
| 07c-pickup-note-sheet | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 08-searching | F/F | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 09-approaching | P/P | P/P | –/– | P/P | –/– | –/– | –/– | P/P | –/– | P/P |
| 10-arrived | P/P | –/– | –/– | –/– | –/– | –/– | –/– | P/P | –/– | –/– |
| 11-in-trip | T/T | –/– | P/P | P/P | –/– | –/– | –/– | P/P | –/– | P/P |
| 11b-help-sheet | T/T | –/– | –/– | –/– | –/– | –/– | –/– | P/P | –/– | –/– |
| 12-trip-complete | F/F | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 13-payment-wallet | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 13b-payment-method-sheet | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 13c-payment-transfer | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 13d-payment-checking | P/P | –/– | –/– | –/– | –/– | –/– | –/– | P/P | –/– | –/– |
| 13e-payment-result | P/P | –/– | –/– | P/P | –/– | –/– | –/– | P/P | –/– | –/– |
| 14-trip-complete-paid | F/F | –/– | –/– | P/P | –/– | –/– | –/– | P/P | –/– | –/– |
| 15-passenger-sheet | T/T | T/T | T/T | T/T | T/T | T/T | T/T | T/T | P/P | P/P |
| 16-pickup-sheet | T/T | –/– | –/– | –/– | –/– | –/– | –/– | T/T | –/– | –/– |
| 17-pickup-map | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 20-activities | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 21-wallet | F/F | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 21b-deposit-sheet | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 21c-deposit-details | P/P | –/– | –/– | P/P | –/– | –/– | –/– | P/P | –/– | –/– |
| 22-account | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 23-profile | F/F | F/F | F/F | F/F | F/F | F/F | F/F | F/F | F/F | F/F |
| 24-places | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 25-notifications | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 26-referrals | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 27-appearance | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 28-location | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 29-safety | F/F | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 30-support | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 31-legal | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |
| 32-delete | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P | P/P |

**T notes:** the Home and Work shortcut chips and the in-trip journey progress label are single-line by design; the full address is in the row above or on the next screen.

## Issues found and fixed

| # | Problem (pass 1) | Where | Fix |
|---|---|---|---|
| 1 | Text inputs with a prefix or leading icon overflowed the screen at 320 (input kept its intrinsic width; search icon pushed off) | `packages/ui/src/components/TextField.tsx` | Input can shrink (`minWidth: 0`); browser focus outline removed on the web QA build only |
| 2 | Onboarding body text clipped on short screens (320×568) because the photo had a fixed share of the height | `apps/rider/src/app/onboarding.tsx` | Photo height is now what's left after the fixed text area and the actions (min 140); headline steps down a size under 360 wide |
| 3 | Home sheet covered most of the map on compact phones and the heading wrapped to two lines | `apps/rider/src/app/(tabs)/index.tsx` | Compact sheet heights (320 / 480) and a smaller heading under 360 wide or 700 tall; pickup address wraps to two lines instead of cutting off |
| 4 | Ride options: on short screens the fare and booking method sat below the fold; at 320 the two booking-method cards were too narrow to read | `apps/rider/src/app/booking/options.tsx` | Taller sheet on short screens; cards stack vertically under 360 wide |
| 5 | Searching: the Cancel button was cut off at 568 tall | `apps/rider/src/app/booking/searching.tsx` | Sheet height follows the screen (360 to 440) and its content scrolls |
| 6 | Trip complete: "Back to Home" and "View in Activities" wrapped to two lines each at 320, making the footer very tall | `apps/rider/src/app/trip-complete.tsx` | Shorter labels ("Home", "Activities") under 380 wide; the spoken labels stay full |
| 7 | Wallet rows: description squeezed to three or four lines by the amount and status column at 320 | `apps/rider/src/features/wallet/TransactionRow.tsx` | Under 380 wide the status badge moves under the description |
| 8 | Profile opened directly (app restored on that page) showed empty name fields | `apps/rider/src/app/account/profile.tsx` | Fields fill once the signed-in user loads (a real bug, not web-only) |
| 9 | Web build crashed on the Appearance override | `packages/ui/src/theme/useTheme.ts` | Guarded; native behaviour unchanged |

QA-only additions: `features/map/MapCanvas.web.tsx` (neutral grid with the same markers, because react-native-maps has no web version), a web fallback for the simulated session token in `state/storage.ts` (native still uses the Keychain or Keystore), and `react-native-web`, `@expo/metro-runtime` and a matching `react-dom` in the Rider app.

## Not tested (limitations)

- **Real devices and simulators:** nothing here ran on an iPhone or Android phone. Native rendering (Hermes, Yoga on device), real safe areas, notches and the home indicator, Android navigation bars, gesture navigation and hardware back were not exercised.
- **Native maps:** the map is a placeholder in the web build; marker legibility, map padding behind sheets and dark map styling on Apple or Google Maps are untested.
- **Keyboards:** no software keyboard appears in headless Chromium, so keyboard overlap of sheets and forms is untested.
- **System font scaling:** browser zoom is not the same as iOS Dynamic Type or Android font scale; the per-variant caps in `Text` are untested on a device.
- **Landscape:** not captured (the apps are portrait-only in `app.json`).
- **Gestures:** sheet dragging and swipe-to-dismiss were not exercised; sheets were opened and closed with taps.
- **Random mock outcomes:** no-drivers, transfer not received and reconnecting states depend on random mock flags; the runs captured whichever occurred (reconnecting and no-drivers did not occur in these runs).

## How to re-run

```bash
cd apps/rider && EXPO_OFFLINE=1 CI=1 npx expo export --platform web --output-dir /tmp/web
WEB_ROOT=/tmp/web node tools/qa-web/server.js   # serves the export on :8099
node tools/qa-web/run.js               # WIDTHS=320,430 to limit widths
```

Representative screenshots (320 and 430, light and dark) are in `docs/qa-screenshots/`.
