# GoBye — Asset Inventory

Status: `PREVIEW` (working concept or derived from one — not for release) · `APPROVED` (final, supplied by the product owner) · `TEMPLATE` (Expo default) · `REFERENCE` (kept for the team, not shipped).

**Source pack:** `Go-Bye_Working_Brand_Assets.zip`, received 2026-10-21 (README dated 21 October 2026). The README says it is concept artwork, not a production kit: the curved G with destination dot is the preferred logo direction; no artwork is an authoritative vector master; aubergine/tangerine is the earlier working palette and green a later exploration (final undecided); proposed typography Plus Jakarta Sans (not approved). See D-027, Q-008, Q-046–Q-049.

## In the apps

| Asset | Path | Format / size | Status | Derived from | Notes |
|---|---|---|---|---|---|
| Logo mark | `packages/ui/assets/brand/mark.png` | PNG RGBA 512² (128 KB) | PREVIEW | `01-brand-concepts/logo-concept-breakdown.png` ("The connection") | Raster extraction, white → transparent. Slight texture from generated artwork. Replace with vector export |
| Logo mark, light variant | `packages/ui/assets/brand/mark-inverse.png` | PNG RGBA 512² (68 KB) | PREVIEW | Same, aubergine strokes → white | For dark backgrounds; tangerine dot kept |
| In-app wordmark | `Wordmark` in `packages/ui/src/components/display.tsx` | Mark + Inter 700 text | PREVIEW | Mark above + `BRAND_NAME` | Name styling open (Q-046) |
| Sedan illustration | `packages/ui/assets/brand/sedan.webp` | WebP 512 px (24 KB) | PREVIEW | `03-rendered-assets/sedan.png` | Onboarding (Quick Match), empty Activity |
| Wallet illustration | `packages/ui/assets/brand/wallet.webp` | WebP 512 px (25 KB) | PREVIEW | `03-rendered-assets/wallet.png` | Onboarding (Negotiate), Wallet card |
| Gift illustration | `packages/ui/assets/brand/reward-gift.webp` | WebP 512 px (27 KB) | PREVIEW | `03-rendered-assets/reward-gift.png` | Rewards |
| Destination illustration | `packages/ui/assets/brand/destination.webp` | WebP 512 px (23 KB) | PREVIEW | `03-rendered-assets/destination.png` | Onboarding, location primer |
| Onboarding scene: pickup meet | `packages/ui/assets/onboarding/pickup-meet.webp` | WebP 505² (39 KB) | INTERIM | `01-brand-concepts/brand-applications.png`, top-left photo tile | Replace with commissioned photography (Q-050) |
| Onboarding scene: car livery | `packages/ui/assets/onboarding/car-livery.webp` | WebP 505² (29 KB) | INTERIM | Same board, top-middle tile | Livery shows the concept "Go-Bye" spelling (Q-046) |
| Onboarding scene: rider in car | `packages/ui/assets/onboarding/rider-window.webp` | WebP 246×332 | INTERIM | Same board, bottom-right tile, cropped to exclude headline text | Low resolution; soft on large phones |
| Rider app icon | `apps/rider/assets/images/icon.png` | 1024² PNG | PREVIEW | Mark on white | Small-size legibility not yet checked |
| Rider Android adaptive icon (fg/bg/mono) | `apps/rider/assets/images/android-icon-*.png` | 512² | PREVIEW | Mark; white bg; white silhouette mono | |
| Rider splash (light/dark) | `apps/rider/assets/images/splash-icon.png`, `splash-icon-dark.png` | 400² | PREVIEW | Mark / light mark | Light bg #FFFFFF, dark bg #14101A |
| Driver app icon set + splash | `apps/driver/assets/images/*` | as above | PREVIEW | Light mark on Aubergine #251632 | Distinguishes Driver from Rider |
| Favicons | `apps/*/assets/images/favicon.png` | 48² | PREVIEW | Mark | Web not targeted |
| Map markers | `apps/rider/src/features/map/MapCanvas.tsx` | Vector Views | PREVIEW | Tokens | Distinct by shape + label: pickup (person or passenger photo + "Pickup"), destination (tangerine flag pin), vehicle (car circle; grey when location is stale) |
| Vehicle visuals | `sedan.webp` render (category cards, VehicleSummary) + MingCute `car` | WebP / SVG | PREVIEW / Third-party | — | One car category at launch; Keke hidden (D-029). The render is generic — the actual colour/model/plate is shown as text with a colour swatch |
| MingCute icons | `@mingcute/react-native` | SVG components | Third-party (Apache-2.0) | — | `DEPENDENCIES_AND_LICENSES.md` |
| Inter font | `@expo-google-fonts/inter` | TTF ×4 weights | Third-party (OFL-1.1) | — | Plus Jakarta Sans proposed, not approved (Q-048) |

## Reference only (not shipped)

| File in pack | What it is | Use |
|---|---|---|
| `01-brand-concepts/aubergine-tangerine-board.png` | Logo lock-up, "Your next move." tagline, app icon on orange, livery | Palette/naming reference (Q-046, Q-047) |
| `01-brand-concepts/brand-applications.png` | Applications | Reference |
| `02-colour-exploration/green-direction-not-final.png` | Green direction (Jade, Aubergine, Mint, White) with a different G form | Reference — not approved |
| `04-motion/route-to-logo-study.gif` | 900×520, 114 frames, approximated logo geometry | Splash/loading motion reference; not production-ready |
| `05-ui-concepts/rider-booking-flow.png` | Home + "Choose how to book" concept | Layout reference; differences logged as Q-049 |

Colours sampled from the boards on 2026-10-21 (not authoritative): aubergine ≈ #3D163E, tangerine ≈ #FD751C, jade ≈ #007252, mint ≈ #88FBB6, UI-concept CTA ≈ #471352, selected surface ≈ #F4EAF7.

Before release (Phase 9) every PREVIEW row must become APPROVED (vector masters, final palette, small-size and contrast QA) or be removed.

## Website (`apps/web/assets`, added 2026-10-22)

| Asset | File | Status | Source | Notes |
|---|---|---|---|---|
| Hero video | `hero.mp4` (owner's uploaded video, H.264 1024×576, 4 s, frames unchanged; re-wrapped for fast start, audio removed; 680 KB) and `hero.webm` (VP9 re-encode of the same video for browsers without H.264) | OWNER SUPPLIED | Owner upload, 2026-10-22 | Plays muted and looped in the hero video box. Its phone screen is the video's own rendering of the app |
| Hero poster | `hero-poster.jpg` | OWNER SUPPLIED | First frame of the video | Shown before playback and for reduced motion |
| Logo mark | `logo-mark-inverse.png` | PREVIEW | Copy of `packages/ui/assets/brand/mark-inverse.png` | Working concept; vector master pending |
