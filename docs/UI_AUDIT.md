# GoBye Rider: UI and UX audit

Date: 2026-10-21 (evening). Scope: every screen and route implemented in `apps/rider`, the shared design system in `packages/ui`, the Driver app shell and the admin preview console. Companion file: `docs/RESPONSIVENESS_AUDIT.md` (viewport matrix and render results).

**Testing honesty.** Screens were rendered in a web build in headless Chromium at ten widths and two themes (see the responsiveness audit). Nothing in this audit was run on a physical phone or simulator. Native maps, the on-screen keyboard, OS text size, safe areas on real hardware and gesture navigation still need device checks (`docs/DEVICE_TEST_MATRIX.md`).

## 1. Screen inventory (actual routes)

| # | Screen | Route | States covered |
|---|---|---|---|
| R01 | Launch gate (restores session and live trip) | `index.tsx` | loading, signed out, needs profile, each booking status |
| R02 | Onboarding (3 photo scenes) | `onboarding.tsx` | auto advance, reduced motion |
| R03 | Phone sign in / sign up | `auth/phone.tsx` | empty, invalid, submitting, error |
| R04 | OTP verification | `auth/otp.tsx` | invalid, resend cooldown, error |
| R05 | Name / profile setup | `auth/name.tsx` | invalid, terms unchecked |
| R06 | Location pre permission | `permission-location.tsx` | undetermined, denied, restricted |
| R07 | Home and map | `(tabs)/index.tsx` | locating, denied, approximate, live trip, payment outstanding |
| R08 | Location search (destination, pickup, saved place) | `booking/search.tsx` | suggestions, typing, results, no results, error |
| R09 | Choose pickup on map | `booking/pickup-map.tsx` | finding address, found, not found |
| R10 | Ride options and fare estimate | `booking/options.tsx` | quoting, quoted, expired, unavailable, error, unpaid trip |
| R11 | Negotiate | `booking/negotiate.tsx` | composing, invalid, open, responses, expired, max rounds |
| R12 | Driver searching | `booking/searching.tsx` | searching, no drivers |
| R13 | Driver assigned, arriving, arrived, trip in progress | `trip.tsx` (ApproachView, InTripView) | approaching, delayed, arrived, reconnecting, in progress |
| R14 | Payment successful | `trip-paid.tsx` | paid only |
| R15 | Trip completed (pay) and trip summary (rate, receipt) | `trip-complete.tsx`, `trip-summary.tsx` | idle, wallet short, processing, transfer pending, failed, reversed; summary unrated, rated, skipped |
| R16 | Receipt | `receipt/[id].tsx` | default |
| R17 | Rate driver (from history) | `rate/[id].tsx` | default, low rating reasons |
| R18 | Activities (history) | `(tabs)/activity.tsx` | loading, empty, list |
| R19 | Trip details | `ride/[id].tsx` | default |
| R20 | Wallet | `(tabs)/wallet.tsx` | loading, empty, error, deposit in progress |
| R21 | Account | `(tabs)/account.tsx` | default |
| R22 | Personal details | `account/profile.tsx` | saving, invalid |
| R23 | Saved places | `account/places.tsx` | empty, list |
| R24 | Notifications | `account/notifications.tsx` | empty, list |
| R25 | Invite friends | `account/rewards.tsx` | loading, empty, error, programme off |
| R26 | Appearance | `account/appearance.tsx` | Light, Dark, System |
| R27 | Location access | `account/location.tsx` | granted, approximate, denied |
| R28 | Safety and emergency | `account/safety.tsx` | default |
| R29 | Support, request submission and confirmation | `account/support.tsx` | form, submitted |
| R30 | Legal and licences | `account/settings.tsx` | default |
| R31 | Delete account | `account/delete.tsx` | confirming, requested |
| — | Retired redirects | `booking/payment.tsx`, `account/wallet.tsx` | redirect only |
| Sheets | Passenger, Change pickup, Pickup note, Payment method, Help, Deposit, Transaction detail, Profile photo | shared `Sheet` | discard confirmation where input exists |
| Driver | Phase 4 placeholder | `apps/driver/src/app/index.tsx` | placeholder only |

**Not implemented, and required by the product documents** (documented, not built in this audit): account recovery (lost phone number), an app wide offline banner (screens show their own error and retry states; there is no network listener), driver app screens (Phase 4), lock screen trip status (spec only, `DYNAMIC_ISLAND_SPEC.md`).

## 2. Issues found and fixed

| Area | Problem | Fix |
|---|---|---|
| Typography | Display sizes too large (34 / 28 pt titles) dominated small phones, as seen on the rating and bank transfer screenshots | Scale tightened: hero 28, page title 24, section 20, card 18, body 16, secondary 15/14, caption 12. Per variant caps on OS text scaling (titles 1.4 to 1.6×, body 2×) so large text sizes stay usable |
| Buttons | Large buttons 56 pt tall; disabled primary looked half enabled | Large 52 pt (touch target kept ≥ 48), disabled uses a neutral fill with grey text |
| Colour | Brand purples, mint and lavender tints used for everyday surfaces and actions | Monochrome token system with separate status colours and brand accents (D-034) |
| Copy | Em and en dashes and hyphens in visible text (about 60 strings across apps, core mocks and admin) | Rewritten as sentences, commas or "to" ranges; placeholders that showed a dash now say "Calculating" or "Not available" |
| Inputs | Fields with a prefix or icon overflowed at 320 px; icon pushed out | `TextField` row uses flexible widths |
| Onboarding | Body text clipped at 320×568 | Photo area takes the remaining height; smaller headline under 360 px |
| Home | Sheet covered most of the map on small phones; pickup address cut off | Lower sheet, smaller heading under 360 px, address wraps |
| Ride options | Fare and booking choice below the fold on short screens; journey rows overlapped when an address wrapped | Taller sheet on short screens, mode cards stack under 360 px, route connector no longer overlaps |
| Searching | Cancel cut off at 568 px tall | Sheet height follows the screen and scrolls |
| Trip complete | Footer buttons wrapped to two lines at 320 px | Short labels under 380 px with full spoken labels |
| Wallet | Transaction descriptions squeezed to 3 or 4 lines | Status badge moves below the description on narrow screens |
| Profile | Opening Personal details straight after a restart showed empty fields (real bug, not web only) | Fields fill when the session loads |
| Switches | Thumb invisible on the white track in dark mode | Thumb contrasts with the track in both themes |
| Toasts | Brand coloured toast with hard coded icon colours | Inverse neutral surface, status icon colours from tokens |
| Sheets | No separation from a black page in dark mode | Hairline border on sheets in dark mode; shadows only in light mode |
| Navigation bar | Active tab relied on colour | Filled icon plus semibold label plus colour |
| Maps | Purple tinted dark map; brand filled vehicle marker | Neutral dark style; vehicle marker in text colour, grey when stale; route line tangerine |
| Splash | Wrong theme could flash before the saved appearance loaded | Splash stays until the saved Light, Dark or System choice is applied; root and Android navigation background follow the theme |

## 3. The blue settings button in the screenshots

It is **Expo Go's developer tools button**, drawn by Expo Go over every project during development. It is not part of GoBye's code and does not exist in a production or development build of the app. To hide it while testing in Expo Go, open the developer menu (shake the phone) and turn off the floating tools button in its settings. No app change is needed.

## 4. Consistency rules now enforced

- Spacing from the shared scale (4, 8, 12, 16, 20, 24, 32) and `layout` tokens: page margin 20, container padding 16, icon box 40, icon to text gap 12, section gap 24.
- Radii: controls 14, cards 20, sheets 28. Borders hairline in the border token.
- One `Sheet` implementation for short tasks; pages for long tasks.
- Buttons: primary, secondary, tertiary (text), destructive, icon; loading and disabled states built in.
- Icons: MingCute Regular for default, Filled for selected and status; sizes from `iconSizes`.
- Status: pending, processing, successful, failed, reversed, each with an icon and a written label.

## 5. Remaining issues and recommendations

1. Device verification on iPhone and Android (keyboard, safe areas, OS text size up to the largest setting, gesture back, native maps). Rows are listed in `DEVICE_TEST_MATRIX.md`.
2. Add an app wide offline notice using a network listener (needs `@react-native-community/netinfo`, not installed).
3. Account recovery flow when a passenger loses access to their number.
4. Landscape: the app is portrait only (`app.json` orientation); keep it that way unless the product requires otherwise.
5. Plus Jakarta Sans (Q-055) when the owner approves the font change.
