# GoBye — Data Models

Source of truth: `packages/core/src/types.ts`. This document explains the models; if they disagree, the code wins and this document must be updated in the same change.

Conventions: IDs are opaque strings; timestamps are ISO-8601 UTC strings in API payloads and epoch milliseconds in client state; money is `Kobo` (integer); distances in metres; durations in seconds.

## Identity

```ts
type UserRole = 'passenger' | 'driver';

interface User {
  id: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  phone: string;          // E.164, e.g. +2348031234567
  email?: string;
  photoUrl?: string;
  createdAt: number;
}

interface Passenger extends User { role: 'passenger'; rating: number; savedPlaces: SavedPlace[] }

type VerificationStatus = 'not_started' | 'in_progress' | 'pending_review' | 'approved' | 'rejected';

interface Driver extends User {
  role: 'driver';
  rating: number;
  completedTrips: number;
  verification: VerificationStatus;
  vehicle: Vehicle;
}
```

## Location & routes

```ts
interface LatLng { latitude: number; longitude: number }

interface Place {
  id: string;
  title: string;          // "Ikeja City Mall"
  subtitle: string;       // "Obafemi Awolowo Way, Ikeja"
  coordinate: LatLng;
}

interface SavedPlace extends Place { label: 'home' | 'work' | 'other'; name: string }

interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
  polyline: LatLng[];
  isSimulated: boolean;   // true for mock routes — UI must not present as live
}
```

## Vehicles

```ts
type VehicleCategoryId = 'keke' | 'go' | 'comfort' | 'xl';

interface VehicleCategory { id: VehicleCategoryId; name: string; seats: number; description: string }

interface Vehicle { make: string; model: string; colour: string; plate: string; year: number; category: VehicleCategoryId }
```

## Pricing

```ts
type Kobo = number & { __brand: 'Kobo' };

interface CategoryRate { base: Kobo; perKm: Kobo; perMinute: Kobo; minimumFare: Kobo }

interface PricingConfig {
  currency: 'NGN';
  roundingStep: Kobo;
  rates: Record<VehicleCategoryId, CategoryRate>;
  negotiation: { minPercent: number; maxPercent: number; offerTtlSeconds: number; responseTtlSeconds: number; stepKobo: Kobo; maxRounds: number };
  quoteTtlSeconds: number;
  commissionRate: number;   // 0 (D-024: 0% per trip, decided 2026-10-21)
  cancellation: { freeWindowSeconds: number; waitSeconds: number; fee: Kobo };
}

interface FareBreakdown { base: Kobo; distance: Kobo; time: Kobo; multiplier: number; minimumApplied: boolean; rounding: Kobo; total: Kobo }  // parts + rounding = total

interface FareQuote {
  id: string;
  category: VehicleCategoryId;
  breakdown: FareBreakdown;
  suggested: Kobo;
  negotiationRange: { min: Kobo; max: Kobo };
  expiresAt: number;
  isSimulated: boolean;
}
```

## Booking & negotiation

```ts
type BookingMode = 'quick_match' | 'negotiate';
// Launch scope (D-023): wallet + bank_transfer. 'cash' is an open decision, disabled via
// PaymentsConfig.enabledMethods. Cards are not in scope ('card', last4, brand removed 2026-10-21).
type PaymentMethodType = 'wallet' | 'bank_transfer' | 'cash';

interface PaymentMethod { id: string; type: PaymentMethodType; label: string }

interface PassengerOffer { id: string; amount: Kobo; round: number; createdAt: number; expiresAt: number }

type DriverResponseKind = 'accept' | 'counter';
interface DriverResponse {
  id: string;
  offerId: string;
  driver: DriverSummary;
  kind: DriverResponseKind;
  amount: Kobo;            // = offer amount for 'accept'
  etaSeconds: number;
  createdAt: number;
  expiresAt: number;
}

interface DriverSummary { id: string; firstName: string; rating: number; completedTrips: number; vehicle: Vehicle; coordinate: LatLng }

type BookingStatus =
  | 'draft' | 'quoted' | 'submitting' | 'searching' | 'negotiating'
  | 'matched' | 'driver_en_route' | 'driver_arrived' | 'in_progress'
  | 'payment_pending' | 'completed' | 'cancelled' | 'no_drivers' | 'failed';

interface Booking {
  id: string;
  mode: BookingMode;
  status: BookingStatus;
  pickup: Place;
  destination: Place;
  route: RouteEstimate;
  quote: FareQuote;
  paymentMethod: PaymentMethod;
  offer?: PassengerOffer;
  responses: DriverResponse[];
  driver?: DriverSummary;
  agreedFare?: Kobo;
  fareLockedAt?: number;
  matchedAt?: number; arrivedAt?: number; startedAt?: number; completedAt?: number;
  createdAt: number;
  updatedAt: number;
  cancellation?: { by: UserRole; reason?: string; fee: Kobo; at: number };
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
  paymentAttempts?: number;        // persisted; idempotency key = `${bookingId}-${attempt}` (BR-108)
  awaitingPaymentAction?: boolean; // true after a bank-transfer trip ends until the passenger confirms the transfer (BR-107)
}
```

## Payments (`packages/core/src/payments.ts`, added 2026-10-21)

```ts
// Payment-processing charge for a method — always disclosed separately from the fare (BR-105).
interface ProcessingFeeRule {
  fixed: Kobo;
  percent: number;                 // fraction of the fare, e.g. 0.015
  cap?: Kobo;
  bearer: 'passenger' | 'driver' | 'platform';  // only passenger-borne fees are added to the passenger total
}

interface PaymentsConfig {
  enabledMethods: Record<PaymentMethodType, boolean>;
  processingFees: Record<PaymentMethodType, ProcessingFeeRule>;
}

interface PaymentCharge { fare: Kobo; processingFee: Kobo; total: Kobo }  // total = fare + passenger-borne fee

// Drivers pay for access instead of per-trip commission (D-024).
interface DriverAccessPackage {
  id: 'daily' | 'monthly';
  name: string;
  price: Kobo;
  durationDays: number;
  provisional: boolean;            // true while the price is provisional
}

interface DriverSubscription { packageId: DriverAccessPackage['id']; startsAt: number; expiresAt: number }
```

Mock values: `MOCK_PAYMENTS_CONFIG` — wallet on (fee ₦0, platform-borne), bank_transfer on (₦50 fixed, passenger-borne, **placeholder**), cash off (₦0). `DRIVER_ACCESS_PACKAGES` — daily ₦2,000 / 1 day, monthly ₦60,000 / 30 days, both **provisional**. Helpers: `enabledMethods`, `processingFee`, `paymentCharge`, `walletCovers`, `subscribe` (buying while active extends from current expiry), `hasActiveAccess`.

## Driver location session (`packages/core/src/driver/locationSession.ts`, added 2026-10-21, D-026)

```ts
type DriverActivity = 'offline' | 'available' | 'to_pickup' | 'on_trip';
type DriverLocationPermission =
  | 'undetermined' | 'denied' | 'restricted'
  | 'when_in_use_approximate' | 'when_in_use_precise' | 'always_precise';
type TrackingIssue =
  | 'permission_missing' | 'approximate_only' | 'background_unavailable'
  | 'session_interrupted' | 'stale_position' | 'low_accuracy' | 'no_access_package';

interface LocationFix { latitude: number; longitude: number; accuracyMeters: number; at: number }

interface DriverLocationState {
  activity: DriverActivity;
  permission: DriverLocationPermission;
  backgroundCapable: boolean;      // background updates configured and allowed on this device
  sessionActive: boolean;
  sessionStartedAt?: number;
  lastFix?: LocationFix;
  interrupted: boolean;
  hasActiveTrip: boolean;
}

interface UpdateProfile { intervalMs: number; distanceMeters: number; staleAfterMs: number }
```

Events: `PERMISSION_CHANGED`, `GO_ONLINE` (requires foreground + precise permission and active access; errors `permission_required` / `precise_required` / `no_access_package`), `GO_OFFLINE` (error `finish_trip_first` during an active trip), `TRIP_ASSIGNED`, `PASSENGER_PICKED_UP`, `TRIP_ENDED` (back to `available`), `FIX`, `SESSION_INTERRUPTED`, `SESSION_RESUMED`. `UPDATE_PROFILES` (placeholders): available 15 s / 50 m / stale 60 s; to_pickup 5 s / 15 m / stale 20 s; on_trip 5 s / 20 m / stale 20 s. `MAX_DISPATCH_ACCURACY_M = 100` (placeholder). `canReceiveRequests` is false unless available, session active and no issues (`permission_missing`, `approximate_only`, `session_interrupted`, `stale_position`, `low_accuracy`). "Always" permission is never required.

## Trips, receipts, ratings

```ts
interface TripReceipt {
  bookingId: string;
  fare: Kobo;
  processingFee: Kobo;     // disclosed separately from the fare; 0 when none applies (BR-105)
  totalPaid: Kobo;         // fare + processingFee
  breakdown: FareBreakdown;
  paymentMethod: PaymentMethod;
  paymentStatus: 'paid' | 'failed' | 'pending' | 'refunded';
  pickup: Place; destination: Place; driver?: DriverSummary;
  startedAt: number; completedAt: number;
  distanceMeters: number; durationSeconds: number;
  isSimulated: boolean;
}

interface Rating { bookingId: string; stars: 1 | 2 | 3 | 4 | 5; comment?: string; reasons?: string[] }
```

## Wallet & notifications

```ts
interface WalletTransaction { id: string; type: 'top_up' | 'ride_payment' | 'refund' | 'reward' | 'payout'; amount: Kobo; createdAt: number; description: string }

interface AppNotification { id: string; title: string; body: string; createdAt: number; read: boolean; kind: 'trip' | 'payment' | 'promo' | 'safety' | 'account' }
```
