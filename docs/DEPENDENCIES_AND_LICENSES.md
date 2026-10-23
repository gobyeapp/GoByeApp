# GoBye — Dependencies and Licences

Versions are those **installed and verified** in `node_modules` on 2026-10-21 (Expo SDK 57). Native versions were resolved with `EXPO_OFFLINE=1 npx expo install`, which uses the SDK's bundled-module list (the build environment's proxy blocked `api.expo.dev`). Re-run `npx expo install --check` / `npx expo-doctor` on an unrestricted network.

## Runtime (Rider app; Driver will share the same versions)

| Package | Version | Licence | Purpose | Native / Expo Go | Notes |
|---|---|---|---|---|---|
| expo | 57.0.30 | MIT | SDK runtime | Yes / Yes | Upgrade to 58 tracked as Q-026 |
| expo-router | 57.0.28 | MIT | File-based navigation, typed routes | Yes / Yes | JS `Tabs` used (D-003) |
| react | 19.2.3 | MIT | UI | — | Single copy enforced (monorepo) |
| react-native | 0.86.3 | MIT | Native runtime (New Architecture) | — | minSdk 24, targetSdk 36, iOS 16.4+ |
| react-native-svg | 15.15.4 | MIT | SVG rendering for MingCute | Yes / Yes | Peer dep of MingCute |
| **@mingcute/react-native** | **3.0.2** | **Apache-2.0** | Official GoBye icon set (Core Regular/Filled) | JS only | Peer: react ≥18, react-native ≥0.72, react-native-svg ≥13. ESM-only (`"type": "module"`); exports use the `import` condition |
| @mingcute/icons | 3.0.2 | Apache-2.0 | Icon definitions (transitive) | JS only | |
| react-native-maps | 1.27.2 | MIT | Map view, markers, polylines | Yes / Yes | Google Maps keys needed for production Android (and iOS if Google provider) |
| expo-location | 57.0.21 | MIT | Permissions, current position | Yes / Yes (foreground) | Background location needs a dev build |
| expo-haptics | 57.0.3 | MIT | Haptic feedback | Yes / Yes | |
| expo-secure-store | 57.0.4 | MIT | Session token storage (Keychain/Keystore) | Yes / Yes | |
| @react-native-async-storage/async-storage | 2.2.0 | MIT | Non-sensitive persistence, state recovery | Yes / Yes | Never store tokens/PII beyond profile basics |
| @expo-google-fonts/inter | 0.4.2 | MIT (code) + OFL-1.1 (font) | Inter typeface | via expo-font | Include OFL notice in licences screen |
| expo-font | 57.0.4 | MIT | Font loading | Yes / Yes | |
| react-native-reanimated | 4.5.1 | MIT | Sheet & state animations, Reduce Motion | Yes / Yes | Requires react-native-worklets 0.10.1 |
| react-native-worklets | 0.10.1 | MIT | Reanimated runtime | Yes / Yes | |
| react-native-gesture-handler | 2.32.0 | MIT | Sheet drag gestures | Yes / Yes | |
| react-native-safe-area-context | 5.7.0 | MIT | Safe-area insets | Yes / Yes | |
| react-native-screens | 4.26.2 | MIT | Native navigation containers | Yes / Yes | |
| expo-splash-screen / expo-status-bar / expo-system-ui / expo-image / expo-constants / expo-linking | 57.x | MIT | Template platform modules | Yes / Yes | |

## Development

| Package | Version | Licence | Purpose |
|---|---|---|---|
| typescript | 6.0.3 | Apache-2.0 | Type checking (strict) |
| jest | 30.5.2 | MIT | Test runner |
| jest-expo | 57.0.6 | MIT | Jest preset for Expo |
| @testing-library/react-native | 14.1.0 | MIT | Component tests |
| @types/jest, @types/react | 30.x / 19.2 | MIT | Types |

### Added 2026-10-21 (UI update brief) — Rider app, installed with `EXPO_OFFLINE=1 npx expo install`

| Package | Version | Licence | Why |
|---|---|---|---|
| expo-clipboard | ~57.0.2 | MIT | Copy account number, amount, reference, referral code |
| expo-image-picker | ~57.0.20 | MIT | Add / replace profile photo (photo library or camera; permission asked at the moment of use; purpose strings in `app.json`) |
| expo-print | ~57.0.2 | MIT | Receipt PDF |
| expo-sharing | ~57.0.23 | MIT | Share / save the receipt PDF |

### Added 2026-10-21 (responsive QA only), Rider app

| Package | Version | Licence | Why |
|---|---|---|---|
| react-native-web | ~0.21.0 | MIT | Web build used only to render screens for responsive screenshot testing (docs/RESPONSIVENESS_AUDIT.md) |
| @expo/metro-runtime | ~57.0.17 | MIT | Required by Expo web builds |
| react-dom | 19.2.3 | MIT | Pinned to match React 19.2.3 for the web build |

## Planned (not installed)

| Package | Why | When |
|---|---|---|
| expo-task-manager | Driver background location task | Phase 4 (Driver) |
| expo-notifications | Push/local notifications, Android channels | Backend phase (Q-014) |
| expo-document-picker | Driver document uploads | Phase 4 |

## Licence obligations

- **MingCute (Apache-2.0):** keep the package's `LICENSE` in distributions (npm package includes it); list "MingCute Icons — Apache License 2.0 — © MingCute Design" in the in-app licences screen (Settings → Legal → Open-source licences). Do not use MingCute Pro artwork; only the public Core Regular/Filled styles are included.
- **Inter (SIL OFL 1.1):** font may be bundled; include the OFL notice; do not sell the font by itself.
- **MIT packages:** include copyright + licence text in the open-source notices screen/file (generate with a licence-collection script before release).


## Management web app (`apps/admin`, added 2026-10-21)

| Package | Version | Licence | Purpose |
|---|---|---|---|
| vite | 7.1.12 | MIT | Dev server and production build |
| @vitejs/plugin-react | 5.0.4 | MIT | React support for Vite |
| react-router-dom | 7.9.4 | MIT | Hash routing between workspaces |
| @mingcute/icons | 3.0.2 | Apache-2.0 | Framework-neutral MingCute Core Regular definitions for the web (same official set as the apps; previously a transitive dependency) |
| react / react-dom | 19.2.3 | MIT | Same versions as the rider app |
| vitest | 3.2.4 | MIT | Unit and render tests (dev) |
| jsdom | 26.1.0 | MIT | DOM for tests (dev) |
| @testing-library/react | 16.3.0 | MIT | Render tests (dev) |
| typescript | ~6.0.3 | Apache-2.0 | Same as the other workspaces (dev) |

Inter is reused from `@expo-google-fonts/inter` (SIL OFL 1.1) and bundled by Vite.

## Website (`apps/web`)

| Package | Version | Licence | Where | Why |
|---|---|---|---|---|
| three (vendored: `vendor/three.module.min.js`, `vendor/RoomEnvironment.js`, `vendor/RoundedBoxGeometry.js`) | 0.160.0 | MIT (`vendor/THREE-LICENSE.txt`) | Footer 3D road (`footer3d.js`) | Real-time road and cars. Loaded on demand only when the footer comes near (about 167 KB gzipped), self-hosted so no third-party CDN is involved. |

**2026-10-22:** the driver app now also uses `@react-native-async-storage/async-storage`, `expo-clipboard`, `expo-haptics`, `expo-image-picker` (licence, ID, vehicle papers, selfie), `expo-location` (When In Use only), `expo-secure-store`, `react-native-maps`, `react-native-web`, `react-dom` and `@expo/metro-runtime`, at the same versions as the rider app (rows above). No new packages were added to the repository.

**2026-10-22:** `expo-video` ~57.0.5 (MIT), rider app (and the driver app from 2026-10-22, D-048). It plays the silent welcome loop (`assets/video/road-dark.mp4 / road-light.mp4`), with the config plugin added by `expo install`. The video was rendered from the site's own three.js road scene, so there are no third-party media rights to clear.

## Tools used outside the app bundles (2026-10-23)

| Tool | Use | License | Note |
|---|---|---|---|
| `bpy` (Blender as a Python module) 5.2 | `tools/3d/render.py` renders the admin's 3D icons | GPL-3.0 (the tool); rendered images are the project's own output | Not a project dependency; install with `pip install bpy pillow` only to regenerate assets |
| Pillow | Downsamples renders to WebP | HPND | Same as above |
