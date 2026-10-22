import type {
  Booking,
  DriverResponse,
  DriverSummary,
  FareQuote,
  Kobo,
  LatLng,
  PassengerOffer,
  Passenger,
  PaymentMethod,
  Place,
  Result,
  RouteEstimate,
  Referral,
  ServiceConfig,
  VehicleCategoryId,
  WalletTransaction,
} from '../types';

/**
 * Service boundaries. The app depends only on these interfaces. Current implementations are
 * mocks (`createMockServices`); the backend implementation will follow docs/API_CONTRACTS.md.
 */

export type Unsubscribe = () => void;

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as Parameters<typeof clearTimeout>[0]),
};

export interface OtpChallenge {
  phone: string;
  resendAfterSeconds: number;
  isSimulated: boolean;
}

export interface Session {
  token: string;
  user: Passenger;
  isNewUser: boolean;
}

export type SocialProvider = 'apple' | 'google';

/** A step that still needs the phone code before the session starts (sign up, password sign in, social). */
export interface PhoneStep {
  /** E.164 number the code goes to; null when the account has no phone yet (new social sign up). */
  phone: string | null;
  /** Prefilled profile from Apple / Google, for a new account. */
  profile?: { firstName: string; lastName: string; email?: string };
  isSimulated: boolean;
}

export interface AuthService {
  /** Create an account with email + password; the phone is verified next (requestOtp → verifyOtp). */
  signUp(input: { fullName: string; email: string; phone: string; password: string }): Promise<Result<PhoneStep>>;
  /** Email or phone + password, then a code to the account's phone (two steps). */
  signIn(identifier: string, password: string): Promise<Result<PhoneStep>>;
  /** Apple / Google. Existing account → code to its phone; new account → ask for a phone first. */
  socialSignIn(provider: SocialProvider): Promise<Result<PhoneStep>>;
  /** Sends a 6 digit reset code by email. Always succeeds for a valid email (no account enumeration). */
  requestPasswordReset(email: string): Promise<Result<{ email: string; resendAfterSeconds: number; isSimulated: boolean }>>;
  resetPassword(email: string, code: string, newPassword: string): Promise<Result<true>>;
  requestOtp(phone: string): Promise<Result<OtpChallenge>>;
  verifyOtp(phone: string, code: string): Promise<Result<Session>>;
  /** `current` lets a mock (or a token-only backend) recover the signed-in user after an app restart. */
  updateProfile(token: string, profile: { firstName: string; lastName: string; email?: string }, current?: Passenger): Promise<Result<Passenger>>;
  requestAccountDeletion(token: string): Promise<Result<{ requestId: string; isSimulated: boolean }>>;
  signOut(token: string): Promise<void>;
}

export interface MapService {
  searchPlaces(query: string, near?: LatLng): Promise<Place[]>;
  reverseGeocode(coordinate: LatLng): Promise<Place>;
  getRoute(from: LatLng, to: LatLng): Promise<RouteEstimate>;
}

export interface CategoryAvailability {
  category: VehicleCategoryId;
  available: boolean;
  reason?: string;
  /** Simulated pickup ETA in seconds. */
  pickupEtaSeconds: number;
}

export interface PricingService {
  quoteAll(route: RouteEstimate): Promise<FareQuote[]>;
  quote(route: RouteEstimate, category: VehicleCategoryId): Promise<FareQuote>;
  availability(pickup: LatLng): Promise<CategoryAvailability[]>;
}

export type QuickMatchEvent = { type: 'matched'; driver: DriverSummary } | { type: 'no_drivers' };

export type NegotiationEvent = { type: 'response'; response: DriverResponse } | { type: 'closed' };

export interface MatchingService {
  startQuickMatch(booking: Booking, listener: (e: QuickMatchEvent) => void): Unsubscribe;
  openNegotiation(booking: Booking, offer: PassengerOffer, listener: (e: NegotiationEvent) => void): Unsubscribe;
  /** Authority check used before locking a negotiated fare (BR-047). */
  isDriverAvailable(driverId: string): boolean;
  /** Release a driver when a booking is cancelled/completed. */
  releaseDriver(driverId: string): void;
}

export type TripEvent =
  | { type: 'driver_location'; coordinate: LatLng; etaSeconds: number }
  /** The live feed paused (no fixes); UI shows "Reconnecting…" once positions go stale. */
  | { type: 'feed_paused' }
  | { type: 'driver_arrived' }
  | { type: 'trip_started' }
  | { type: 'trip_completed' };

export interface TripService {
  follow(booking: Booking, listener: (e: TripEvent) => void): Unsubscribe;
}

export interface ChargeResult {
  /** 'not_received': a bank transfer hasn't been seen yet — the payment stays pending (never "failed" or "paid"). */
  status: 'paid' | 'failed' | 'not_received';
  reference: string;
  failureReason?: string;
  isSimulated: boolean;
}

export interface PaymentService {
  listMethods(): Promise<PaymentMethod[]>;
  charge(params: { bookingId: string; method: PaymentMethod; amount: Kobo; idempotencyKey: string }): Promise<ChargeResult>;
}

export interface ConfigService {
  /** Admin-published settings: enabled vehicle categories, referral programme, pickup PIN. */
  getServiceConfig(): Promise<ServiceConfig>;
}

export interface DepositInstructions {
  transactionId: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  amount: Kobo;
  reference: string;
  expiresAt: number;
  isSimulated: boolean;
}

export interface WalletService {
  listTransactions(): Promise<WalletTransaction[]>;
  /** Start a deposit by bank transfer; the credit stays `pending` until the provider confirms it. */
  requestDeposit(amount: Kobo): Promise<DepositInstructions>;
  /** Poll a pending deposit (simulated confirmation). */
  checkDeposit(transactionId: string): Promise<WalletTransaction['status']>;
}

export interface ReferralService {
  listReferrals(): Promise<Referral[]>;
}

export interface GoByeServices {
  config: ConfigService;
  wallet: WalletService;
  referrals: ReferralService;
  auth: AuthService;
  maps: MapService;
  pricing: PricingService;
  matching: MatchingService;
  trips: TripService;
  payments: PaymentService;
}
