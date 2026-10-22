# GoBye — Architecture

## 1. Overview

GoBye is an npm-workspaces monorepo containing two separately distributable Expo apps and two shared packages.

```
gobye/
├── apps/
│   ├── rider/            GoBye (passenger app)      bundle id: app.gobye.rider (proposed)
│   └── driver/           GoBye Driver               bundle id: app.gobye.driver (proposed)
├── packages/
│   ├── core/             @gobye/core — pure TypeScript domain layer (no React Native imports)
│   └── ui/               @gobye/ui   — design tokens, <Icon>, shared RN components
├── docs/                 product, technical and compliance documentation
├── AGENTS.md  CLAUDE.md  README.md  LOG.md
└── package.json          workspaces + root scripts
```

Runtime stack (verified installed versions in `DEPENDENCIES_AND_LICENSES.md`): Expo SDK 57, React Native 0.86 (New Architecture), React 19.2, Expo Router 57 (typed routes), Reanimated 4 + Worklets, Gesture Handler 2.32, react-native-svg 15, MingCute React Native 3.0.2, react-native-maps 1.27, expo-location, expo-haptics, expo-secure-store, AsyncStorage, Inter.

## 2. Layering

```mermaid
flowchart TD
  subgraph App[apps/rider · apps/driver]
    R[Expo Router routes<br/>src/app/**] --> F[Feature components<br/>src/features/**]
    F --> P[Providers / hooks<br/>src/state/**]
  end
  P --> S[Service interfaces<br/>@gobye/core/services]
  P --> D[Domain logic<br/>@gobye/core: pricing, negotiation, booking machine, validation]
  F --> UI[@gobye/ui<br/>tokens · Icon · components]
  S --> M[Mock implementations<br/>@gobye/core/mocks]
  S -. later .-> B[(GoBye backend<br/>REST + realtime)]
```

Rules:

1. **Routes are thin.** A file in `src/app/` reads params, picks a feature component, and wires navigation. Business logic never lives in a route file.
2. **`@gobye/core` has zero React / React Native imports.** It is unit-tested in Node via Jest.
3. **Apps talk to services only through interfaces** (`AuthService`, `MapService`, `PricingService`, `MatchingService`, `PaymentService`, `TripService`). The current implementations are mocks (`createMockServices()`); a future `createHttpServices(baseUrl)` will satisfy the same interfaces.
4. **All state transitions for a booking go through `bookingReducer`** in `@gobye/core/booking`. Illegal transitions are rejected (returned state unchanged + error flag) and covered by tests.
5. **`@gobye/ui` never imports from an app.** Apps may import from both packages.
6. **Icons only via `<Icon>`** from `@gobye/ui` (decision D-015).

## 3. Navigation (Expo Router)

- Root `Stack` in `src/app/_layout.tsx` hosts providers (outer → inner): `GestureHandlerRootView`, `SafeAreaProvider`, `ServicesProvider`, `SessionProvider`, `AccountProvider`, `LocationProvider`, `BookingProvider`, `ToastProvider`. Theme tokens come from `useTheme()` (system appearance; no provider needed).
- Completed flows reset the stack with `resetTo()` (`src/features/navigation/reset.ts`, D-020).
- `src/app/index.tsx` is a gate that redirects to onboarding, sign-in, or the tabs depending on session state.
- `(tabs)` uses Expo Router JS `Tabs` with a GoBye tab bar (decision D-003). Rider tabs: **Home**, **Activity**, **Account** (three one-word labels, per HIG).
- Booking steps are stack screens pushed over the tabs; pickers (destination search, payment) are presented as `modal` on iOS and slide-up screens on Android.
- Android system back: every stack screen supports back; the booking-searching and active-trip screens intercept back to show "Cancel ride?" instead of silently leaving (predictive back is enabled by default on Android 16 with targetSdk 36).

Route map: see `SCREEN_INVENTORY.md`.

## 4. State

| State | Owner | Persistence |
|---|---|---|
| Session (user, token) | `SessionProvider` | token in `expo-secure-store`; profile in AsyncStorage |
| Active booking | `BookingProvider` (`useReducer(bookingReducer)`) | AsyncStorage key `gobye.activeBooking` — restored on launch for state recovery |
| Ride history, saved places, payment methods, wallet, notifications | `AccountProvider` | AsyncStorage (mock data seeded on first run) |
| Ephemeral UI (sheet position, inputs) | component state | none |

Timers (offer expiry, response expiry, simulated driver movement) are driven by a single `useNow(intervalMs)` clock hook; expiry is always **derived** from timestamps (`expiresAt <= now`) rather than mutated by timers, so a backgrounded app that resumes shows correct expiry immediately.

## 5. Services and mocks

```ts
interface GoByeServices {
  auth: AuthService;          // requestOtp(phone), verifyOtp(phone, code), deleteAccount()
  maps: MapService;           // searchPlaces(q, near), reverseGeocode(coord), getRoute(a, b)
  pricing: PricingService;    // quote(route, category) -> FareQuote
  matching: MatchingService;  // quickMatch(booking) / openNegotiation(offer) -> event stream
  trips: TripService;         // driver location/phase simulation for an assigned trip
  payments: PaymentService;   // listMethods(), charge(bookingId, method) -> result
}
```

Mocks simulate latency (300–1500 ms), configurable failure rates (`MOCK_FLAGS`), and Lagos geography (a fixed list of real public landmarks with approximate coordinates). Every mock result carries `isSimulated: true`, which the UI uses to label ETAs and payments as simulated.

Realtime: matching and trip progress are modelled as `subscribe(listener) => unsubscribe` event streams, mirroring the future WebSocket contract in `BACKEND_HANDOVER.md`.

## 6. Location

`LocationService` (app-side, wraps `expo-location`) exposes `getPermissionStatus()`, `requestForeground()`, `getCurrentPosition()`; accuracy (`coords.accuracy`) is surfaced to the UI ("GPS accuracy ±35 m"). If permission is denied or restricted, the rider sets pickup manually. The Driver app adds a background task (`expo-task-manager`) registered only when the driver goes online (decision D-012).

## 7. Theming

`@gobye/ui/theme` exports `lightColors`, `darkColors`, `spacing`, `radii`, `typography`, `iconSizes`, `motion`. `useTheme()` returns the scheme-specific palette via `useColorScheme()`. Per Apple HIG there is no in-app appearance switch; the app follows the system setting.

## 8. Testing

- `@gobye/core`: Jest unit tests for pricing, money formatting, negotiation range/expiry/selection, booking state machine, validators.
- `apps/*`: Jest (`jest-expo`) + React Native Testing Library for shared components (accessibility roles/labels, disabled states).
- Device tests: `DEVICE_TEST_MATRIX.md` (nothing marked tested until executed).

## 9. Future backend integration

Swap `createMockServices()` for an HTTP/WebSocket implementation behind the same interfaces. The backend becomes the authority for pricing, matching, payment settlement, driver eligibility and verification. See `API_CONTRACTS.md` and `BACKEND_HANDOVER.md`.

### 9.1 Infrastructure layer (D-051)

Implemented in code and tested locally; not deployed:
- **Config:** `packages/core/src/infra/env.ts` — typed public config per environment (`apps/*/src/state/publicConfig.ts`), refuses secrets and production mocks.
- **API client:** `infra/http.ts` — the single way apps will call `https://api.gobye.app/v1` (request ids, timeouts, idempotency, safe retries). HTTP implementations of the service interfaces in §5 will be built on it.
- **Edge:** `infra/cloudflare` — API gateway Worker in front of backend origins (provider pending), upload signer and public media Workers over R2. Website and admin stay on Vercel, DNS-only.
- **Files:** `packages/core/src/files` — classes, validation, quarantine/scan lifecycle, private access.
- **Traffic:** `packages/core/src/traffic` — origins, policies, failover, privileged changes (admin page is a simulation).
- **Realtime / observability:** `infra/realtime.ts`, `infra/observability.ts` — provider-agnostic.

See `INFRASTRUCTURE_ARCHITECTURE.md` for the diagram and status per component.

## 10. Build & distribution

- Development: Expo Go (SDK 57) for the Rider app; Driver background location needs a development build (`eas build --profile development`).
- Release: EAS Build + EAS Submit, separate `eas.json` per app, separate bundle identifiers / package names. Nothing is submitted without explicit authorisation.
