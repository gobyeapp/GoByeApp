/**
 * GoBye domain types. Documented in docs/DATA_MODELS.md — keep both in sync.
 * Conventions: money in integer kobo, distances in metres, durations in seconds,
 * client timestamps in epoch milliseconds.
 */

export type Kobo = number & { readonly __brand: 'Kobo' };

export type UserRole = 'passenger' | 'driver';

export interface User {
  id: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  /** E.164, e.g. +2348031234567 */
  phone: string;
  email?: string;
  createdAt: number;
}

export interface Passenger extends User {
  role: 'passenger';
  rating: number;
  /** Local or remote profile photo URI (brief §3, §13). */
  photoUri?: string;
}

export type VerificationStatus =
  | 'not_started'
  | 'in_progress'
  | 'pending_review'
  /** Staff sent it back: the driver fixes the flagged items and resubmits (D-049). */
  | 'changes_requested'
  | 'approved'
  | 'rejected';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Place {
  id: string;
  title: string;
  subtitle: string;
  coordinate: LatLng;
}

export type SavedPlaceLabel = 'home' | 'work' | 'other';

export interface SavedPlace extends Place {
  label: SavedPlaceLabel;
  name: string;
}

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
  polyline: LatLng[];
  /** True for mock routes — the UI must not present these as live data. */
  isSimulated: boolean;
}

export type VehicleCategoryId = 'keke' | 'go' | 'comfort' | 'xl';

export interface VehicleCategory {
  id: VehicleCategoryId;
  name: string;
  seats: number;
  description: string;
}

export interface Vehicle {
  make: string;
  model: string;
  colour: string;
  plate: string;
  year: number;
  category: VehicleCategoryId;
}

export interface CategoryRate {
  base: Kobo;
  perKm: Kobo;
  perMinute: Kobo;
  minimumFare: Kobo;
}

export interface NegotiationConfig {
  /** Lower bound as a fraction of the suggested fare, e.g. 0.75 */
  minPercent: number;
  /** Upper bound as a fraction of the suggested fare, e.g. 1.5 */
  maxPercent: number;
  offerTtlSeconds: number;
  responseTtlSeconds: number;
  stepKobo: Kobo;
  maxRounds: number;
}

export interface PricingConfig {
  currency: 'NGN';
  roundingStep: Kobo;
  rates: Record<VehicleCategoryId, CategoryRate>;
  negotiation: NegotiationConfig;
  quoteTtlSeconds: number;
  /**
   * Per-trip platform commission. Decided 0% (Q-002, 2026-10-21): drivers pay for access through
   * packages instead. Kept configurable so the rule lives in one place.
   */
  commissionRate: number;
  cancellation: { freeWindowSeconds: number; waitSeconds: number; fee: Kobo };
}

export interface FareBreakdown {
  base: Kobo;
  distance: Kobo;
  time: Kobo;
  multiplier: number;
  /** True when the minimum fare replaced the computed fare. */
  minimumApplied: boolean;
  /** Amount added by rounding so that parts + rounding = total. */
  rounding: Kobo;
  total: Kobo;
}

export interface FareQuote {
  id: string;
  category: VehicleCategoryId;
  breakdown: FareBreakdown;
  suggested: Kobo;
  negotiationRange: { min: Kobo; max: Kobo };
  createdAt: number;
  expiresAt: number;
  isSimulated: boolean;
}

export type BookingMode = 'quick_match' | 'negotiate';
/**
 * Launch scope (Q-001, 2026-10-21): GoBye Wallet and bank transfer. Cash is an open decision and is
 * disabled by default via `PaymentsConfig.enabledMethods`. Cards are not in scope.
 */
export type PaymentMethodType = 'wallet' | 'bank_transfer' | 'cash';

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  label: string;
}

/** Payment-processing charge for a method — always disclosed separately from the fare (Q-002). */
export interface ProcessingFeeRule {
  fixed: Kobo;
  /** Fraction of the fare, e.g. 0.015 */
  percent: number;
  cap?: Kobo;
  /** Who pays it. Only passenger-borne fees are added to the passenger total. */
  bearer: 'passenger' | 'driver' | 'platform';
}

export interface PaymentsConfig {
  enabledMethods: Record<PaymentMethodType, boolean>;
  processingFees: Record<PaymentMethodType, ProcessingFeeRule>;
}

export interface PaymentCharge {
  fare: Kobo;
  processingFee: Kobo;
  /** Amount the passenger pays: fare + passenger-borne processing fee. */
  total: Kobo;
}

/** Driver access package (Q-002): drivers pay for platform access instead of per-trip commission. */
export interface DriverAccessPackage {
  id: 'daily' | 'monthly';
  name: string;
  price: Kobo;
  durationDays: number;
  /** True while the price is provisional. */
  provisional: boolean;
}

export interface DriverSubscription {
  packageId: DriverAccessPackage['id'];
  startsAt: number;
  expiresAt: number;
}

export interface PassengerOffer {
  id: string;
  amount: Kobo;
  round: number;
  createdAt: number;
  expiresAt: number;
}

/** Where a passenger sends a bank transfer for this driver (0% commission: paid to the driver). */
export interface DriverPayoutAccount {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export interface DriverSummary {
  id: string;
  firstName: string;
  lastName?: string;
  /** Driver photo URL when provided by the backend; UI falls back to initials. */
  photoUrl?: string;
  payoutAccount?: DriverPayoutAccount;
  rating: number;
  completedTrips: number;
  vehicle: Vehicle;
  coordinate: LatLng;
}

export type DriverResponseKind = 'accept' | 'counter';

export interface DriverResponse {
  id: string;
  offerId: string;
  driver: DriverSummary;
  kind: DriverResponseKind;
  amount: Kobo;
  etaSeconds: number;
  createdAt: number;
  expiresAt: number;
}

export type BookingStatus =
  | 'draft'
  | 'quoted'
  | 'submitting'
  | 'searching'
  | 'negotiating'
  | 'matched'
  | 'driver_en_route'
  | 'driver_arrived'
  | 'in_progress'
  | 'payment_pending'
  | 'completed'
  | 'cancelled'
  | 'no_drivers'
  | 'failed';

export interface Cancellation {
  by: UserRole;
  reason?: string;
  fee: Kobo;
  at: number;
}

export interface Booking {
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
  matchedAt?: number;
  arrivedAt?: number;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
  cancellation?: Cancellation;
  paymentStatus?: PaymentStatus;
  /** Number of payment retries; part of the idempotency key so retries survive relaunch. */
  paymentAttempts?: number;
  /** Why the last attempt didn't complete (e.g. a transfer not seen yet — still pending, not failed). */
  /** Why a payment is still pending: a transfer not seen yet, or a request whose result didn't come back in time. */
  paymentNotice?: 'transfer_not_received' | 'not_confirmed';
  /** Waiting for the passenger to act before charging (e.g. confirm a bank transfer was sent). */
  awaitingPaymentAction?: boolean;
  /** 4-digit pickup PIN the passenger tells the driver before the trip starts. */
  pickupPin?: string;
  /** Live data from the trip feed (brief §7–8): latest ETA, first ETA after match, last fix time. */
  driverEtaSeconds?: number;
  driverEtaInitialSeconds?: number;
  driverLocationAt?: number;
  /** Set when booking for someone else (passenger selector). */
  rider?: { name: string; phone: string };
  /** Passenger's landmark / gate instructions for the driver (e.g. "Gate 2, by the pharmacy"). */
  pickupNote?: string;
}

/**
 * pending: not yet paid (awaiting the passenger or verification) · processing: request in flight
 * (duplicate actions blocked) · paid: confirmed by the payment authority · failed · reversed: a debit
 * that was returned · refunded.
 */
export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'reversed' | 'refunded';

export interface TripReceipt {
  bookingId: string;
  fare: Kobo;
  /** Disclosed separately from the fare; 0 when none applies. */
  processingFee: Kobo;
  /** fare + processingFee */
  totalPaid: Kobo;
  breakdown: FareBreakdown;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  pickup: Place;
  destination: Place;
  driver?: DriverSummary;
  startedAt: number;
  completedAt: number;
  distanceMeters: number;
  durationSeconds: number;
  isSimulated: boolean;
}

export interface Rating {
  bookingId: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  reasons?: string[];
}

export type WalletTransactionType = 'top_up' | 'ride_payment' | 'refund' | 'reward' | 'payout';
export type WalletTransactionStatus = 'pending' | 'successful' | 'failed' | 'reversed';

export interface WalletTransaction {
  id: string;
  type: WalletTransactionType;
  /** Positive for credits, negative for debits. */
  amount: Kobo;
  createdAt: number;
  description: string;
  status: WalletTransactionStatus;
  /** Linked trip, for trip payments and refunds. */
  bookingId?: string;
}

export type NotificationKind = 'trip' | 'payment' | 'promo' | 'safety' | 'account';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  kind: NotificationKind;
}

/** Discriminated result used by validators and services. */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

/* ---------- Admin-configured service settings (brief §5, §12) ---------- */

export interface CategoryConfig {
  id: VehicleCategoryId;
  enabled: boolean;
  name: string;
  seats: number;
  description: string;
  /** Illustration key for the category. */
  image: 'sedan';
  sortOrder: number;
}

export interface ReferralProgramConfig {
  enabled: boolean;
  /** What a friend must do before a referral qualifies (never "sign up" alone). */
  qualifyingRule: 'first_completed_paid_trip';
  qualifyingDescription: string;
  referrerReward: Kobo;
  maxRewardedReferrals: number;
  /** Days an invite stays valid. */
  inviteExpiryDays: number;
  /** Days before an earned reward expires if unused. */
  rewardExpiryDays: number;
  link: string;
}

export type PromotionPlacement = 'home' | 'wallet';
export interface Promotion {
  id: string;
  enabled: boolean;
  placements: PromotionPlacement[];
  /** Short bold headline. */
  title: string;
  /** One concise sentence including the key condition. */
  body: string;
  /** 3D render that matches the campaign. */
  art: 'sedan' | 'gift' | 'wallet' | 'destination';
  /** Offer page content (shown when the card is opened). */
  details: string[];
  /** Where the offer page's action leads. */
  action: { label: string; route: string };
  sortOrder: number;
}
export interface PromotionsConfig {
  /** Seconds between automatic slides; 0 turns auto advance off. */
  autoAdvanceSeconds: number;
  items: Promotion[];
}

export interface ServiceConfig {
  categories: CategoryConfig[];
  referral: ReferralProgramConfig;
  pickupPin: { enabled: boolean; digits: number };
  /** Admin-managed promotional cards (Home and Wallet). */
  promotions: PromotionsConfig;
  /** True while values are placeholders, not admin-published settings. */
  isSimulated: boolean;
}

/**
 * invited: code shared, friend hasn't signed up · qualifying: signed up, first paid trip not yet
 * complete · qualified: first paid trip complete, reward being issued · rewarded: reward credited ·
 * expired: invite or qualification window ran out. Signing up alone never earns a reward.
 */
export type ReferralStatus = 'invited' | 'qualifying' | 'qualified' | 'rewarded' | 'expired';

export interface Referral {
  id: string;
  name: string;
  status: ReferralStatus;
  invitedAt: number;
  updatedAt: number;
  reward?: Kobo;
}
