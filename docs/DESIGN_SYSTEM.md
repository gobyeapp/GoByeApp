# GoBye — Design System

Source of truth in code: `packages/ui/src/theme/*`. Change tokens there and here together.

## 1. Brand palette

| Token | Hex | Use |
|---|---|---|
| Jade Green | `#0B7A5B` | Primary actions, selected states, success |
| Deep Aubergine | `#251632` | Primary text, identity surfaces, selected brand surfaces |
| Tangerine | `#FF8A3D` | Sparingly: destination marker, route accent, highlight badges. **Never as text on white** (2.35:1) |
| Soft Mint | `#E7F5ED` | Selected card backgrounds, info banners |
| White | `#FFFFFF` | Primary rider background |

The brand board referenced by the brief was not supplied (Q-008); values above come from the brief text.

### Brand directions (preview, D-027)

The final palette is undecided (Q-047). `paletteFor(direction, scheme)` provides two directions, switchable in Settings → "Preview: brand colours":

| Token | Jade (default) light / dark | Aubergine & Tangerine light / dark |
|---|---|---|
| `primary` | #0B7A5B / #3DD9A4 | #251632 (16.9:1 on white) / #D9B8EC (10.7:1 on #14101A) |
| `onPrimary` | #FFFFFF / #14101A | #FFFFFF / #14101A |
| `primaryPressed` | #095E46 / #2FB487 | #3A2449 / #C9A6DE |
| `surfaceSelected` | #E7F5ED / #12382C | #F4EAF7 / #2E1F3D |
| `success` | Jade in both directions | Jade in both directions |

The logo mark and 3D illustrations come from the working brand pack (`ASSET_INVENTORY.md`). Use `<BrandMark>` and `<Illustration>` from `@gobye/ui`; illustrations are always decorative.

## 2. Semantic colour tokens

Measured WCAG contrast ratios (computed 2026-10-21):

| Token | Light | Dark | Notes |
|---|---|---|---|
| `background` | `#FFFFFF` | `#14101A` | |
| `surface` | `#FFFFFF` | `#1E1726` | cards, sheets |
| `surfaceMuted` | `#F6F4F8` | `#281F31` | inputs, grouped rows |
| `surfaceSelected` | `#E7F5ED` (mint) | `#12382C` | selected vehicle/payment |
| `text` | `#251632` (16.9:1) | `#F4F1F7` (16.8:1) | |
| `textSecondary` | `#5E5867` (6.9:1) | `#A39DAB` (7.1:1) | |
| `border` | `#E4E0E9` | `#3A3044` | decorative only (not relied on for meaning) |
| `primary` | `#0B7A5B` (5.3:1 on white) | `#3DD9A4` (10.4:1 on bg) | Dark-mode jade is lightened for contrast — documented deviation |
| `primaryPressed` | `#095E46` | `#2FB487` | |
| `onPrimary` | `#FFFFFF` | `#14101A` | |
| `accent` | `#FF8A3D` | `#FF9F5E` | non-text marks only in light mode |
| `accentText` | `#9A4A12` (6.3:1) | `#FF9F5E` (9.3:1) | tangerine-family text, e.g. "Expires in 0:12" |
| `danger` | `#B42318` (6.6:1) | `#F87171` (6.8:1) | errors, destructive actions |
| `success` | `#0B7A5B` | `#3DD9A4` | always paired with icon + text |
| `scrim` | `rgba(20,16,26,0.45)` | `rgba(0,0,0,0.6)` | |

Rules: never communicate state with colour alone (icon + label always); text ≥ 4.5:1, large/bold text and UI graphics ≥ 3:1.

## 3. Typography — Inter

Inter 400/500/600/700 via `@expo-google-fonts/inter`. Sizes mirror Apple's default Dynamic Type "Large" values so scaling feels native; all text scales with the system setting (`allowFontScaling` on).

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `largeTitle` | 34 / 41 | 700 | Onboarding headlines |
| `title1` | 28 / 34 | 700 | Screen titles |
| `title2` | 22 / 28 | 600 | Sheet titles ("Where are you going?") |
| `title3` | 20 / 25 | 600 | Section titles, fares |
| `headline` | 17 / 22 | 600 | List titles, buttons |
| `body` | 17 / 22 | 400 | Default |
| `callout` | 16 / 21 | 400 | Secondary body |
| `subhead` | 15 / 20 | 500 | Metadata |
| `footnote` | 13 / 18 | 400 | Hints, legal |
| `caption` | 12 / 16 | 500 | Badges, tab labels (max multiplier 1.4) |

Fare amounts use `fontVariant: ['tabular-nums']`.

## 4. Spacing, radii, elevation

- Spacing scale (pt/dp): `xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 · huge 48`. Screen horizontal margin: 20.
- Radii: `sm 8 · md 12 · lg 16 · xl 24 (sheets) · pill 999`.
- Elevation: one shadow token for floating controls on the map (`shadow.float`); sheets use `shadow.sheet`. No other shadows.

## 5. Touch targets & layout

- Minimum interactive size **48×48** (satisfies Apple 44pt and Android 48dp). Enforced by `Pressable` wrappers (`minHeight`/`hitSlop`).
- Respect safe areas on all edges (Dynamic Island, home indicator, Android edge-to-edge gesture bar).
- Layouts reflow at accessibility text sizes: fare rows stack vertically when `fontScale > 1.3`.

## 6. Iconography — MingCute

- Package: `@mingcute/react-native@3.0.2` (Apache-2.0), styles **Core Regular** and **Core Filled** only.
- Use only `<Icon name variant size color />` from `@gobye/ui`. The registry (`packages/ui/src/icons/registry.ts`) maps semantic names to verified MingCute components via deep imports (`@mingcute/react-native/core-regular/<file>`).
- Sizes: `xs 16 · sm 20 · md 24 (default) · lg 28 · xl 32`.
- Regular = default/inactive/secondary actions; Filled = selected tabs, active location markers, important status.
- Colours: active `primary`, inactive `textSecondary`, status semantic colours.
- Icons are decorative by default (`accessibilityElementsHidden`); the parent control carries the label.

## 7. Components (`@gobye/ui`)

| Component | Variants / states | Accessibility |
|---|---|---|
| `Button` | primary, secondary, tertiary (text), destructive; sizes md/lg; loading, disabled, pressed | role `button`, `accessibilityState.disabled/busy` |
| `IconButton` | filled, plain; on-map floating | label required (TS-enforced) |
| `TextField` | default, focused, error, disabled; prefix (e.g. +234), helper/error text | label linked; error announced |
| Search entry | Home: pressable "Search destination" field (role `search`); Search screen: `TextField` with search icon | |
| `ListItem` | leading icon, title, subtitle, trailing (chevron / value / switch) | role `button` when pressable |
| `RadioRow` / `Checkbox` | selected/unselected, disabled | role `radio` / `checkbox` + checked state |
| `SegmentedControl` | 2–3 segments | role `tab`, selected state |
| `Card` | plain, selected (mint) | — |
| `MapSheet` | snap points, grabber, keyboard aware | grabber has `adjustable`-style expand/collapse actions |
| `Toast` | info, success, error | announced via `AccessibilityInfo.announceForAccessibility` |
| `Skeleton` | line, block | hidden from screen readers; parent announces "Loading" |
| `EmptyState` / `ErrorState` | icon, title, body, action (Retry) | |
| `Badge`, `SimulatedBadge`, `Divider`, `Card`, `StarRating`, `Wordmark` (placeholder), `Screen`, `Section`, `SwitchRow` | `@gobye/ui` | |
| `VehicleOption`, `FareBreakdownView`, `DriverCard`, `ResponseCard`, `SearchingPulse`, payment row | Rider feature components (`apps/rider/src/features/booking/components.tsx`) | spoken naira labels via `nairaAccessibilityLabel` |
| `ScreenHeader` | back, title, trailing action | back button labelled "Back" |
| Tab bar | Expo Router `Tabs` with MingCute Regular/Filled `tabBarIcon`, one-word labels | provided by React Navigation |

`SimulatedBadge` ("Simulated") must appear next to any mock ETA, driver location, payment status or verification state shown as if live.

## 8. Motion

Durations: `fast 150ms · base 250ms · slow 400ms`; standard easing `Easing.bezier(0.2, 0, 0, 1)`. Motion communicates state (sheet snapping, vehicle selection, search pulse, match confirmation, driver progress). With Reduce Motion enabled (`useReducedMotion()` from Reanimated): pulses and camera fly-tos are replaced with fades/instant changes. No continuous animation except the searching pulse, which stops when matched.

Haptics (`expo-haptics`): `selection` on vehicle/segment change; `success` on match and fare agreement; `warning` on offer expiry; `error` on failed payment. Haptics can be turned off in Settings.

## 9. Map styling

- Pickup marker: Jade filled circle with white ring. Destination: Tangerine square marker with Aubergine ring. Driver: Aubergine car marker (MingCute `car` Filled).
- Route polyline: Aubergine 4pt with Jade start; muted map style where provider supports it.
- Floating controls (locate, back) are 48pt circles on `surface` with `shadow.float`; keep the provider logo/legal link visible above the sheet's lowest detent.

## 10. Layout and alignment rules (testing brief §14, 2026-10-21)

Tokens in `layout` (`packages/ui/src/theme/tokens.ts`):

| Token | Value | Use |
|---|---|---|
| `page` | 20 | Horizontal page padding on every screen and sheet |
| `container` | 16 | Inner padding of grouped containers and cards |
| `iconBox` | 40 | Circle/square behind leading icons and avatars in rows |
| `iconGap` | 12 | Gap between the icon box and row text |
| `rowGap` / `section` | 8 / 24 | Between rows / between sections |
| `controlRadius` / `cardRadius` / `sheetRadius` | 14 / 20 / 28 | Inputs and chips / cards and groups / sheets |

- Row dividers start at `container + iconBox + iconGap`, so they line up with the row text, not the icon.
- Icons are centred on their box; text baselines in a row share one left edge (nested hierarchy).
- **Sheets** for short choices (payment method, passenger, pickup source, appearance-style choices); **pages** for long tasks (payment confirmation, wallet, referrals).
- Light appearance: page, card and sheet are #FFFFFF; separation comes from hairline neutral borders (#E6E6EA), neutral fills (#F4F4F6) and `shadows.card`, never grey or lavender page backgrounds.
- Keep buttons bold: one primary per screen; secondary/tertiary for alternatives; destructive only for cancel/delete.

New shared components (`components/patterns.tsx`): `Sheet`, `Avatar` (photo with initials fallback), `ListGroup`, `StatusBadge` (pending / processing / successful / failed / reversed / info / neutral — icon + text, never colour alone), `ProgressBar` (driven by data), `KeyValue`. App-level: `CopyRow`, `VehicleSummary`, `CategoryCard`.

## 11. Colour system (2026-10-21, D-034) — supersedes §1–2

| Group | Token | Light | Dark |
|---|---|---|---|
| Background | `background` (page, headers, safe areas, tab bar) | #FFFFFF | #000000 |
| Surface | `surface` (sheets, dialogs, menus) | #FFFFFF | #1A1A1A |
| Surface | `surfaceMuted` (inputs, grouped content) | #F7F7F7 | #111111 |
| Surface | `surfaceSelected` | #F0F0F0 | #262626 |
| Surface | `card` | #FFFFFF | #1A1A1A |
| Text | `text` / `textSecondary` | #171717 / #666666 | #FAFAFA / #A3A3A3 |
| Border | `border` | #E8E8E8 | #292929 |
| Action | `primary` / `onPrimary` | #171717 / #FFFFFF | #FAFAFA / #000000 |
| Action | `secondary` / `onSecondary` | #F2F2F2 / #171717 | #262626 / #FAFAFA |
| Action | `inverseSurface` / `onInverse` (toasts) | #171717 / #FFFFFF | #262626 / #FAFAFA |
| Status | `success` / `successSurface` | #15803D / #EAF6EE | #4ADE80 / #0F2A1A |
| Status | `warning` / `warningSurface` | #B45309 / #FEF4E6 | #FBBF24 / #2B2108 |
| Status | `danger` / `dangerSurface` | #C62828 / #FDECEC | #F87171 / #2C1313 |
| Overlay | `scrim` | rgba(0,0,0,.45) | rgba(0,0,0,.7) |
| Brand accent | `accent` / `accentText` / `mapRoute` | #FF751F / #B4500F / #FF751F | #FF8A40 / #FF9A5C / #FF8A40 |
| Brand (raw) | `brand.aubergine`, `brand.tangerine` | #351A40, #FF751F | same |

Rules: brand colours only as accents (logo, illustrations, route lines, rating stars, rewards). Selected = neutral fill/border + radio/check/weight. Disabled primary = `secondary` fill with `textSecondary` label. Contrast of every text/status pair is ≥ 4.5:1 in both themes (checked by `ui-components.test.tsx`). Light mode may use `shadows.card`; dark mode uses surface steps and hairline borders.

## 12. Navigation, banners and skeletons (D-035)

- **Floating tab bar:** tray radius 28, `navSurface` fill (light shadow, dark hairline border), max width 420, item min height 52. Selected: `navActive` colour + filled icon + semibold caption. Badges use `danger` with `onPrimary` text.
- **Brand banner:** radius 22, `brandBanner` fill, `onBrandBanner` text, pill action chip, illustration bleeding off the right edge. Pending variant: `accent` fill with black text.
- **Skeletons:** blocks use `secondary` (light) / `surfaceSelected` (dark), 900 ms in-out pulse to 55% opacity, one pulse per `SkeletonGroup`; rows mirror `iconBox` 40 + two text lines + trailing value.
- **Wallet benchmark:** profile header (avatar 44, name, bell), panel radius 32 on `surfaceMuted`, centred 40 pt balance with `textSecondary` kobo, three equal tiles (radius 18, min height 72), history card radius 24 with written, coloured statuses.

## 13. Management platform (admin web) — 2026-10-23, D-053

The admin web has its own tokens in `apps/admin/src/styles.css`. Screens never use raw colours.

- **Brand:** `--jade #0B7A5B` (actions), `--aubergine #251632` (sidebar, toasts), `--tangerine #FF8A3D` (count badges, highlighted bar), `--mint #E7F5ED` (selected and soft states).
- **Surfaces:**
  - Light: canvas `#F6F7F6`, cards `#FFFFFF`, sunken `#F1F3F2`.
  - Dark: canvas `#0F0C13`, cards `#18141D`.
  - Text: `#141A17`, with `#56605B` for secondary text.
- **Status pairs:** success, warning, danger, info and neutral, each a text colour on a tinted background, all 4.5:1 or better. Always shown with an icon or a word.
- **Scale:**
  - Spacing on a 4px step: `--s1` to `--s10`.
  - Radii 8 / 12 / 16 plus pill.
  - Sidebar 240px, or a 64px rail. Topbar 60px. Content up to 1280px.
  - Motion 120 / 200 ms, switched off under reduced motion.
- **Type:** Inter in sizes 12 / 13 / 14 / 16 / 20 / 24 / 26. Every figure uses tabular numbers.
- **Shell:**
  - Sidebar grouped as Home, Operations, People, Care and safety, Finance, Growth, Insights, Settings, Administration and Technical.
  - The selected page uses the MingCute **Core Filled** icon, a mint accent bar and white text.
  - Collapse control in the sidebar header. The choice is remembered; with no saved choice it starts as a rail below 1200px.
  - Topbar: breadcrumb, city and date scope, search (Ctrl/Cmd+K), notifications and the account menu (theme, prototype tools, sign out).
  - Finance and Settings pages show their sibling pages as a pill bar.
- **Components** (`src/ui/kit.tsx`):
  - `PageHead` (eyebrow, meta pills), `Section` (description), `Card` (title + actions).
  - `Stat` as a KPI card (icon; tone on the icon and edge, never on the figure; whole card links to the detail page).
  - `FilterBar`; `Table` (sticky header, sortable columns via `sortValue`, paging via `pageSize`, "1 to 25 of N").
  - `Tabs` (arrow keys, count pills); `Drawer` side sheet (focus moves in, Tab stays inside, focus returns on close); `Empty` with a tinted icon.
- **Time:** every date and time shows in Africa/Lagos (`format.ts`, `TZ`, `lagosDay`), whatever the viewer's computer is set to.
