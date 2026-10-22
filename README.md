# GoBye

**Your ride. Your say.** — a mobile-first ride-hailing platform for Nigeria · https://gobye.app

GoBye offers two ways to book:

- **Quick Match** — accept the platform's suggested fare and get matched with an eligible driver.
- **Negotiate** — propose your own fare within a fair range; drivers accept or counter, and you choose.

This repository contains two native apps built with React Native + Expo:

| App | Path | Store name | Bundle ID (proposed) | Status |
|---|---|---|---|---|
| Rider | `apps/rider` | GoBye | `app.gobye.rider` | Full booking journey built on **simulated services** |
| Driver | `apps/driver` | GoBye Driver | `app.gobye.driver` | Configured shell — Phase 4 next |

> ⚠️ **Preview build.** Drivers, ETAs, routes, payments, verification and safety features are simulated and labelled as such in the UI. Nothing here is a live transport or payment service.


## Run the rider app on your phone (Expo Go)

Run Expo **from the app folder or through the root scripts**, never `npx expo start` in the repo root (that fails with "Unable to resolve module ../../App").

```bash
npm install
npm start            # same as: cd apps/rider && npx expo start
npm run rider:tunnel # if the phone can't reach your PC on the same Wi-Fi
```
Scan the QR code with Expo Go (latest version; the app uses Expo SDK 57).

## Technology

Expo SDK 57 · React Native 0.86 (New Architecture) · React 19.2 · TypeScript (strict) · Expo Router (typed routes) · Reanimated 4 · Gesture Handler · react-native-maps · expo-location · **MingCute icons** (`@mingcute/react-native`) · Inter · Jest + React Native Testing Library. Full inventory: [`docs/DEPENDENCIES_AND_LICENSES.md`](docs/DEPENDENCIES_AND_LICENSES.md).

Why SDK 57 and not 58: see decision D-001 in [`docs/DECISIONS.md`](docs/DECISIONS.md) (Expo Go for SDK 58 isn't released yet).

## Structure

```
gobye/
├── apps/
│   ├── rider/            src/app = routes (Expo Router) · src/features · src/state (providers)
│   ├── driver/           Phase 4
│   └── admin/            GoBye Management: staff web app (Vite + React), one workspace per team, on test data
├── packages/
│   ├── core/             @gobye/core — domain types, money, pricing, negotiation, booking state machine,
│   │                     validation, service interfaces and mock services (pure TypeScript, unit-tested);
│   │                     platform/ = management model: permissions, ledger, workflows, approvals, test dataset
│   └── ui/               @gobye/ui — design tokens, <Icon> (MingCute), Button, TextField, MapSheet, …
├── docs/                 product, technical, platform and compliance documentation
├── CLAUDE.md  AGENTS.md  LOG.md
└── package.json          npm workspaces
```

## Requirements

- Node.js 22 LTS (even-numbered LTS; odd releases unsupported by Expo)
- npm 10+
- To run on a phone: the **Expo Go** app (SDK 57) on iOS or Android, signed in to an Expo account
- Optional: Android Studio emulator; Xcode 26.4+ on macOS for the iOS simulator
- Driver background location (Phase 4) will need a development build (`eas build --profile development`)

## Getting started

```bash
npm install                 # from the repo root (installs all workspaces)
npm run rider               # starts Metro for the Rider app; scan the QR code with Expo Go
```

In the preview: sign in with any Nigerian mobile number (e.g. `0803 123 4567`) and any 6-digit code except `000000`.

## Commands

| Command (repo root) | What it does |
|---|---|
| `npm run rider` / `npm run driver` | Start the dev server for an app |
| `npm run admin` | Start GoBye Management at http://localhost:5180 (choose a test staff account to sign in) |
| `npm run admin:build` | Typecheck and build the management app into `apps/admin/dist` |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | Jest (core, rider) and Vitest (admin) in every workspace |
| `cd apps/rider && npx expo export --platform android --platform ios` | Production bundle check |
| `cd apps/rider && npx expo install <pkg>` | Add a native package at the SDK-compatible version |

## Current status (2026-10-21, updated after owner decisions)

- ✅ Documentation set (Phase 0) — see index below
- ✅ Shared core: pricing, negotiation, booking state machine, validators, mock services — 59 unit tests
- ✅ Design system + MingCute icon wrapper — component tests
- ✅ Rider app: photo onboarding → phone/OTP → location primer → Home (editable pickup, "For me / Someone else") → search / choose pickup on map → route & fare → Quick Match or Negotiate → searching / offers → matched (driver photo, actual vehicle, PIN) → live trip → trip complete → confirm payment (wallet or bank transfer to the driver) → rating → receipt PDF; four tabs Home · Activities · Wallet · Account; referrals, Light/Dark/System appearance, profile photo, saved places, notifications, safety, support and account deletion — all on simulated services
- ✅ Owner decisions applied (2026-10-21): Wallet + bank transfer at launch (cash open), 0% commission with driver access packages, processing fees shown separately, driver location-session policy in core, Abuja + Lagos mock places
- ✅ Working brand pack integrated as **preview**: concept logo mark, app icons/splash, 3D illustrations, and a Settings switch to compare the two palette directions
- ⏳ Not yet run on physical devices or emulators ([`docs/DEVICE_TEST_MATRIX.md`](docs/DEVICE_TEST_MATRIX.md))
- ⏳ Driver app (Phase 4), real maps/payments/backend (Phases 5–6)

## Connected demo (rider + driver + admin)

Run `npm run demo:relay`, then start the apps with `npx expo start -c` and the admin with `npm run admin`: they share test records over your Wi-Fi. Steps and the Supabase option: [docs/DEMO_CONNECTED.md](docs/DEMO_CONNECTED.md).

## Management platform

The staff platform specification is in [`docs/management/`](docs/management/README.md) (11 files: foundation, every workspace module with users, screens, fields, actions, approvals, status changes, effects, jobs, states and acceptance checks, the connections between workspaces, and the implementation and verification plan). The clickable prototype is `apps/admin` (see [`apps/admin/BUILDING.md`](apps/admin/BUILDING.md)). It runs on a deterministic **test dataset** with simulated latency and failures; nothing is connected to a real provider, bank or person.

## Documentation index

| Area | Documents |
|---|---|
| Start here | [`CLAUDE.md`](CLAUDE.md) · [`AGENTS.md`](AGENTS.md) · [`LOG.md`](LOG.md) · [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) · [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| Product | [`PRODUCT_REQUIREMENTS_DOCUMENT.md`](docs/PRODUCT_REQUIREMENTS_DOCUMENT.md) · [`SRS.md`](docs/SRS.md) · [`USER_FLOWS.md`](docs/USER_FLOWS.md) · [`BUSINESS_RULES.md`](docs/BUSINESS_RULES.md) · [`OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) |
| Design | [`DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) · [`SCREEN_INVENTORY.md`](docs/SCREEN_INVENTORY.md) · [`UI_STATES.md`](docs/UI_STATES.md) · [`ASSET_INVENTORY.md`](docs/ASSET_INVENTORY.md) |
| Engineering | [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`DATA_MODELS.md`](docs/DATA_MODELS.md) · [`API_CONTRACTS.md`](docs/API_CONTRACTS.md) · [`BACKEND_HANDOVER.md`](docs/BACKEND_HANDOVER.md) · [`DEPENDENCIES_AND_LICENSES.md`](docs/DEPENDENCIES_AND_LICENSES.md) |
| Quality | [`TEST_PLAN.md`](docs/TEST_PLAN.md) · [`DEVICE_TEST_MATRIX.md`](docs/DEVICE_TEST_MATRIX.md) |
| Platform & compliance | [`IOS_GUIDELINES.md`](docs/IOS_GUIDELINES.md) · [`ANDROID_GUIDELINES.md`](docs/ANDROID_GUIDELINES.md) · [`APP_STORE_COMPLIANCE.md`](docs/APP_STORE_COMPLIANCE.md) · [`SECURITY_PRIVACY.md`](docs/SECURITY_PRIVACY.md) · [`RESEARCH_SOURCES.md`](docs/RESEARCH_SOURCES.md) |

## Licences

Project code: proprietary (owner to confirm). Third-party: MingCute Icons (Apache-2.0), Inter (SIL OFL 1.1), Expo/React Native and others (MIT) — see the dependency inventory.
