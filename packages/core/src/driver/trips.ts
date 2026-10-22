import { haversineMeters } from '../geo';
import { kobo, roundUpTo } from '../money';
import { createQuote } from '../pricing/fare';
import { MOCK_PRICING_CONFIG } from '../pricing/config';
import { MOCK_PLACES, seededRandom } from '../mocks/data';
import { simulateRoute } from '../mocks/services';
import type { Kobo, LatLng, PaymentMethodType, Place, PricingConfig, Result, RouteEstimate, VehicleCategoryId } from '../types';

/**
 * Driver side of a trip (D11–D16): incoming requests, the counter-offer rules, the trip stages with the
 * pickup PIN check, and the earnings summary. 0% commission (Q-002): the driver keeps the whole fare.
 */

export interface RiderSummary {
  firstName: string;
  rating: number;
  completedTrips: number;
  photoUrl?: string;
}

export type RequestKind = 'quick_match' | 'negotiate';

export interface IncomingRequest {
  id: string;
  kind: RequestKind;
  rider: RiderSummary;
  pickup: Place;
  destination: Place;
  route: RouteEstimate;
  /** Distance and time from the driver to the pickup. */
  pickupDistanceMeters: number;
  pickupEtaSeconds: number;
  /** Quick Match: the platform fare. Negotiate: the rider's offer. */
  amount: Kobo;
  /** Platform suggestion for this trip (shown next to a rider's offer). */
  suggested: Kobo;
  /** Highest counteroffer allowed (negotiation range max). */
  maxCounter: Kobo;
  paymentMethod: PaymentMethodType;
  pickupNote?: string;
  createdAt: number;
  expiresAt: number;
  isSimulated: true;
}

/** Seconds a driver has to answer a request (placeholder; responseTtlSeconds in pricing config). */
export const REQUEST_TTL_SECONDS = 20;

export function isRequestOpen(req: IncomingRequest, now: number): boolean {
  return req.expiresAt > now;
}

/** Up to three quick counter amounts above the rider's offer, rounded to the step and capped at the maximum. */
export function counterSuggestions(req: Pick<IncomingRequest, 'amount' | 'suggested' | 'maxCounter'>, config: PricingConfig = MOCK_PRICING_CONFIG): Kobo[] {
  const step = config.negotiation.stepKobo;
  const base = roundUpTo(kobo(req.amount + step), step);
  const candidates = [base, roundUpTo(kobo(Math.max(base, req.suggested)), step), roundUpTo(kobo(req.amount + step * 4), step)];
  return [...new Set(candidates.filter((c) => c > req.amount && c <= req.maxCounter))].sort((a, b) => a - b).slice(0, 3) as Kobo[];
}

/** A counteroffer must be above the rider's offer and within the allowed range (BR-043). */
export function validateCounter(amount: Kobo, req: Pick<IncomingRequest, 'amount' | 'maxCounter'>): Result<Kobo> {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'Enter an amount.' };
  if (amount <= req.amount) return { ok: false, error: 'A counteroffer must be higher than the rider’s offer. To take their price, accept it.' };
  if (amount > req.maxCounter) return { ok: false, error: 'That’s above the most this trip allows.' };
  return { ok: true, value: amount };
}

/* ---------- Trip stages ---------- */

export type DriverTripStage = 'to_pickup' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';

export interface DriverTrip {
  id: string;
  kind: RequestKind;
  rider: RiderSummary;
  pickup: Place;
  destination: Place;
  route: RouteEstimate;
  fare: Kobo;
  paymentMethod: PaymentMethodType;
  pickupNote?: string;
  /** Passenger's 4 digit pickup PIN (the driver never sees it; the rider reads it out). */
  pickupPin: string;
  pinAttempts: number;
  stage: DriverTripStage;
  acceptedAt: number;
  arrivedAt?: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
  /** Passenger payment after the trip (D-030): pending until confirmed. */
  paymentStatus: 'not_due' | 'pending' | 'confirmed';
  isSimulated: true;
}

export const MAX_PIN_ATTEMPTS = 3;

export type TripError = 'invalid_transition' | 'pin_required' | 'pin_wrong' | 'pin_locked' | 'too_early_no_show';

export function tripErrorMessage(error: TripError, attemptsLeft = 0): string {
  switch (error) {
    case 'invalid_transition':
      return 'That step isn’t available right now.';
    case 'pin_required':
      return 'Ask the rider for their 4 digit PIN.';
    case 'pin_wrong':
      return attemptsLeft === 1 ? 'That PIN doesn’t match. 1 try left.' : `That PIN doesn’t match. ${attemptsLeft} tries left.`;
    case 'pin_locked':
      return 'Too many wrong PINs. Don’t start the trip. Contact support.';
    case 'too_early_no_show':
      return 'Wait for the full waiting time before you report a no show.';
  }
}

export function startTripFromRequest(req: IncomingRequest, fare: Kobo, now: number, pin: string): DriverTrip {
  return {
    id: `trip-${req.id}`,
    kind: req.kind,
    rider: req.rider,
    pickup: req.pickup,
    destination: req.destination,
    route: req.route,
    fare,
    paymentMethod: req.paymentMethod,
    pickupNote: req.pickupNote,
    pickupPin: pin,
    pinAttempts: 0,
    stage: 'to_pickup',
    acceptedAt: now,
    paymentStatus: 'not_due',
    isSimulated: true,
  };
}

export function markArrived(trip: DriverTrip, now: number): Result<DriverTrip, TripError> {
  if (trip.stage !== 'to_pickup') return { ok: false, error: 'invalid_transition' };
  return { ok: true, value: { ...trip, stage: 'arrived', arrivedAt: now } };
}

/** Start only after the rider's PIN matches (pickup safety). Three wrong tries lock the trip. */
export function confirmPinAndStart(trip: DriverTrip, entered: string, now: number): Result<DriverTrip, { error: TripError; trip: DriverTrip }> {
  if (trip.stage !== 'arrived') return { ok: false, error: { error: 'invalid_transition', trip } };
  if (trip.pinAttempts >= MAX_PIN_ATTEMPTS) return { ok: false, error: { error: 'pin_locked', trip } };
  const digits = entered.replace(/\D/g, '');
  if (digits.length !== trip.pickupPin.length) return { ok: false, error: { error: 'pin_required', trip } };
  if (digits !== trip.pickupPin) {
    const next = { ...trip, pinAttempts: trip.pinAttempts + 1 };
    return { ok: false, error: { error: next.pinAttempts >= MAX_PIN_ATTEMPTS ? 'pin_locked' : 'pin_wrong', trip: next } };
  }
  return { ok: true, value: { ...trip, stage: 'in_progress', startedAt: now } };
}

export function pinAttemptsLeft(trip: DriverTrip): number {
  return Math.max(0, MAX_PIN_ATTEMPTS - trip.pinAttempts);
}

/** Completing moves payment to `pending` (never "paid" before confirmation, D-030). */
export function completeTrip(trip: DriverTrip, now: number): Result<DriverTrip, TripError> {
  if (trip.stage !== 'in_progress') return { ok: false, error: 'invalid_transition' };
  return { ok: true, value: { ...trip, stage: 'completed', completedAt: now, paymentStatus: 'pending' } };
}

/** When the driver may report a no show: after the waiting time from arrival (BR-081). */
export function noShowAvailableAt(trip: DriverTrip, config: PricingConfig = MOCK_PRICING_CONFIG): number | null {
  return trip.stage === 'arrived' && trip.arrivedAt !== undefined ? trip.arrivedAt + config.cancellation.waitSeconds * 1000 : null;
}

export function cancelTrip(trip: DriverTrip, reason: 'rider_no_show' | 'driver_cancelled', now: number, config: PricingConfig = MOCK_PRICING_CONFIG): Result<DriverTrip, TripError> {
  if (trip.stage !== 'to_pickup' && trip.stage !== 'arrived') return { ok: false, error: 'invalid_transition' };
  if (reason === 'rider_no_show') {
    const at = noShowAvailableAt(trip, config);
    if (at === null || now < at) return { ok: false, error: 'too_early_no_show' };
  }
  return { ok: true, value: { ...trip, stage: 'cancelled', cancelledAt: now, cancelReason: reason } };
}

/* ---------- Earnings ---------- */

export interface EarningsSummary {
  total: Kobo;
  trips: number;
  onlineTrips: Kobo;
  /** Paid to the driver directly (bank transfer or cash) vs through the GoBye wallet. */
  byMethod: Record<PaymentMethodType, Kobo>;
  pending: Kobo;
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Monday-start week, local time. */
export function startOfWeek(now: number): number {
  const d = new Date(startOfDay(now));
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

export function summariseEarnings(trips: DriverTrip[], from: number, to = Number.POSITIVE_INFINITY): EarningsSummary {
  const done = trips.filter((t) => t.stage === 'completed' && (t.completedAt ?? 0) >= from && (t.completedAt ?? 0) < to);
  const byMethod: Record<PaymentMethodType, Kobo> = { wallet: kobo(0), bank_transfer: kobo(0), cash: kobo(0) };
  let pending = 0;
  for (const t of done) {
    byMethod[t.paymentMethod] = kobo(byMethod[t.paymentMethod] + t.fare);
    if (t.paymentStatus !== 'confirmed') pending += t.fare;
  }
  const total = kobo(done.reduce((s, t) => s + t.fare, 0));
  return { total, trips: done.length, onlineTrips: total, byMethod, pending: kobo(pending) };
}

export function earningsToday(trips: DriverTrip[], now: number) {
  return summariseEarnings(trips, startOfDay(now));
}

/** Daily totals for the 7 days of the week containing `now` (Mon..Sun). */
export function weeklyBreakdown(trips: DriverTrip[], now: number): { day: string; total: Kobo }[] {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const start = startOfWeek(now);
  return labels.map((day, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const from = d.getTime();
    d.setDate(d.getDate() + 1);
    return { day, total: summariseEarnings(trips, from, d.getTime()).total };
  });
}

/* ---------- Simulated requests (preview only) ---------- */

const RIDER_NAMES = ['Ada', 'Tobi', 'Zainab', 'Femi', 'Chioma', 'Yusuf', 'Bisi', 'Kelechi', 'Amaka', 'Dayo'];
const NOTES = ['By the blue gate', 'Opposite the pharmacy', 'Outside the main entrance', undefined, undefined];

/** Build a reproducible simulated request near the driver. Every value here is mock data. */
export function makeMockRequest(seed: number, near: LatLng, now: number, category: VehicleCategoryId, kind?: RequestKind): IncomingRequest {
  const rand = seededRandom(seed);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const nearby = [...MOCK_PLACES].sort((a, b) => haversineMeters(near, a.coordinate) - haversineMeters(near, b.coordinate));
  const pickupBase = nearby[Math.floor(rand() * 3)];
  const pickup: Place = {
    ...pickupBase,
    id: `${pickupBase.id}-${seed}`,
    coordinate: { latitude: pickupBase.coordinate.latitude + (rand() - 0.5) * 0.004, longitude: pickupBase.coordinate.longitude + (rand() - 0.5) * 0.004 },
  };
  const destination = pick(nearby.slice(3, 12));
  const route = simulateRoute(pickup.coordinate, destination.coordinate);
  const approach = simulateRoute(near, pickup.coordinate);
  const quote = createQuote({ id: `q-${seed}`, route, category, config: MOCK_PRICING_CONFIG, now });
  const k: RequestKind = kind ?? (rand() < 0.5 ? 'quick_match' : 'negotiate');
  const offer = k === 'negotiate' ? roundUpTo(kobo(Math.round(quote.suggested * (0.82 + rand() * 0.12))), MOCK_PRICING_CONFIG.negotiation.stepKobo) : quote.suggested;
  return {
    id: `req-${seed}`,
    kind: k,
    rider: { firstName: pick(RIDER_NAMES), rating: Math.round((4.4 + rand() * 0.59) * 100) / 100, completedTrips: 3 + Math.floor(rand() * 300) },
    pickup,
    destination,
    route,
    pickupDistanceMeters: approach.distanceMeters,
    pickupEtaSeconds: approach.durationSeconds,
    amount: kobo(Math.max(quote.negotiationRange.min, offer)),
    suggested: quote.suggested,
    maxCounter: quote.negotiationRange.max,
    paymentMethod: rand() < 0.6 ? 'bank_transfer' : 'wallet',
    pickupNote: pick(NOTES),
    createdAt: now,
    expiresAt: now + REQUEST_TTL_SECONDS * 1000,
    isSimulated: true,
  };
}

/** A 4 digit PIN for the simulated rider (the real one is generated by the backend per booking). */
export function mockPickupPin(seed: number): string {
  return String(1000 + Math.floor(seededRandom(seed * 7 + 3)() * 9000));
}

/** Simulated trip history so the earnings and trips screens aren't empty in the preview. */
export function mockTripHistory(now: number, category: VehicleCategoryId = 'go'): DriverTrip[] {
  const out: DriverTrip[] = [];
  for (let i = 1; i <= 14; i++) {
    const at = now - i * 9.5 * 60 * 60 * 1000;
    const req = makeMockRequest(500 + i, MOCK_PLACES[i % 10].coordinate, at, category);
    const fare = req.kind === 'negotiate' ? req.amount : req.suggested;
    const t = startTripFromRequest(req, fare, at - 30 * 60 * 1000, mockPickupPin(i));
    const cancelled = i % 7 === 0;
    out.push({
      ...t,
      stage: cancelled ? 'cancelled' : 'completed',
      arrivedAt: at - 22 * 60 * 1000,
      startedAt: cancelled ? undefined : at - 20 * 60 * 1000,
      completedAt: cancelled ? undefined : at,
      cancelledAt: cancelled ? at - 15 * 60 * 1000 : undefined,
      cancelReason: cancelled ? 'rider_no_show' : undefined,
      paymentStatus: cancelled ? 'not_due' : 'confirmed',
    });
  }
  return out;
}
