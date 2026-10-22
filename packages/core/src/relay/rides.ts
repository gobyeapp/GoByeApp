import { haversineMeters } from '../geo';
import { MOCK_PRICING_CONFIG } from '../pricing/config';
import type { MatchingService, NegotiationEvent, QuickMatchEvent, TripEvent, TripService, Unsubscribe } from '../services/types';
import type { Booking, DriverResponse, DriverSummary, LatLng, PassengerOffer } from '../types';
import { REQUEST_TTL_SECONDS, type IncomingRequest } from '../driver/trips';
import { VEHICLE_DOCUMENTS, type DriverApplication } from '../driver/onboarding';
import type { Relay } from './client';
import type { RelayApplication, RelayEvent, RelayPerson, RelayResponse, RelayRide, SharedApplication } from './types';

/* ---------- Small helpers ---------- */

/** Keep at most `max` points (first and last kept), so a ride row stays small. */
export function downsample(points: LatLng[], max = 40): LatLng[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

/** "AB12345678" → "••••5678". */
export const maskNumber = (s: string) => (s.length <= 4 ? s : `••••${s.slice(-4)}`);

/** Runs `tick` now and every `ms`, never overlapping; returns a stop function. */
export function poll(tick: () => Promise<void> | void, ms: number): Unsubscribe {
  let stopped = false;
  let busy = false;
  const run = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      await tick();
    } catch {
      // A missed poll is retried on the next tick; the UI shows the connection state separately.
    } finally {
      busy = false;
    }
  };
  void run();
  const id = setInterval(run, ms);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

export const eventId = (now: number) => `ev-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Fire-and-forget activity line for the admin feed. */
export function logRelayEvent(relay: Relay | null, e: Omit<RelayEvent, 'id' | 'at' | 'ride_id' | 'person_id'> & { ride_id?: string | null; person_id?: string | null }, now = Date.now()) {
  if (!relay) return;
  void relay.insert<RelayEvent>('demo_events', { id: eventId(now), at: now, ride_id: e.ride_id ?? null, person_id: e.person_id ?? null, actor: e.actor, type: e.type, summary: e.summary }).catch(() => undefined);
}

export function personRow(p: { role: RelayPerson['role']; phone: string; name: string; email?: string | null; city?: string | null }, now: number, createdAt?: number): RelayPerson {
  return { id: p.phone, role: p.role, name: p.name, phone: p.phone, email: p.email ?? null, city: p.city ?? null, created_at: createdAt ?? now, updated_at: now, last_seen_at: now };
}

/* ---------- Driver applications ---------- */

export function shareApplication(app: DriverApplication): SharedApplication {
  return {
    personal: app.personal ? { ...app.personal } : null,
    licence: app.licence ? { number: maskNumber(app.licence.number), expiry: app.licence.expiry, hasPhoto: !!app.licence.photoUri } : null,
    identity: app.identity ? { type: app.identity.type, number: maskNumber(app.identity.number), hasSelfie: !!app.identity.selfieUri } : null,
    vehicle: app.vehicle ? { ...app.vehicle } : null,
    documents: Object.fromEntries(VEHICLE_DOCUMENTS.map((d) => [d.id, !!app.documents[d.id]])) as SharedApplication['documents'],
  };
}

export function applicationRow(app: DriverApplication, driver: { phone: string; name: string }, now: number): RelayApplication {
  return {
    id: driver.phone,
    driver_name: driver.name,
    phone: driver.phone,
    city: app.personal?.city ?? null,
    status: app.status,
    application: shareApplication(app),
    checks: app.checks ?? [],
    issues: app.issues ?? [],
    review_note: app.reviewNote ?? null,
    submitted_at: app.submittedAt ?? null,
    decided_at: null,
    decided_by: null,
    updated_at: now,
  };
}

/** Apply staff decisions from the relay onto the driver's local application (the driver keeps photos and numbers). */
export function mergeReview(local: DriverApplication, remote: RelayApplication): DriverApplication {
  return {
    ...local,
    status: remote.status,
    checks: remote.checks,
    issues: remote.issues,
    reviewNote: remote.review_note ?? undefined,
    rejectionReason: remote.status === 'rejected' ? remote.review_note ?? local.rejectionReason : undefined,
  };
}

/* ---------- Rides ---------- */

export interface RelayRider {
  id: string;
  name: string;
  phone: string;
  rating: number;
}

export function bookingToRide(b: Booking, rider: RelayRider, now: number): RelayRide {
  return {
    id: b.id,
    kind: b.mode,
    status: b.mode === 'negotiate' ? 'negotiating' : 'searching',
    rider_id: rider.id,
    rider: { name: rider.name, phone: rider.phone, rating: rider.rating },
    pickup: b.pickup,
    destination: b.destination,
    route: { distance_meters: b.route.distanceMeters, duration_seconds: b.route.durationSeconds, polyline: downsample(b.route.polyline) },
    category: b.quote.category,
    fare: b.quote.suggested,
    max_counter: b.quote.negotiationRange.max,
    offer: b.offer ? { id: b.offer.id, amount: b.offer.amount, round: b.offer.round, expires_at: b.offer.expiresAt } : null,
    pickup_note: b.pickupNote ?? null,
    payment_method: b.paymentMethod.type,
    driver_id: null,
    driver: null,
    agreed_fare: b.mode === 'quick_match' ? b.quote.suggested : null,
    driver_location: null,
    pickup_pin: null,
    payment_status: 'not_due',
    cancelled_by: null,
    cancel_reason: null,
    created_at: now,
    matched_at: null,
    arrived_at: null,
    started_at: null,
    completed_at: null,
    updated_at: now,
  };
}

/** A ride as an incoming request on the driver's screen (pickup distance from where the driver is). */
export function rideToRequest(ride: RelayRide, driverAt: LatLng | null, now: number): IncomingRequest {
  const d = driverAt ? haversineMeters(driverAt, ride.pickup.coordinate) * 1.3 : 2_000;
  const firstName = ride.rider.name.split(/\s+/)[0] || 'Rider';
  return {
    id: ride.id,
    kind: ride.kind,
    rider: { firstName, rating: ride.rider.rating, completedTrips: 0 },
    pickup: ride.pickup,
    destination: ride.destination,
    route: { distanceMeters: ride.route.distance_meters, durationSeconds: ride.route.duration_seconds, polyline: ride.route.polyline, isSimulated: true },
    pickupDistanceMeters: Math.round(d),
    pickupEtaSeconds: Math.max(60, Math.round(d / 7)),
    amount: ride.kind === 'negotiate' && ride.offer ? ride.offer.amount : ride.fare,
    suggested: ride.fare,
    maxCounter: ride.max_counter,
    paymentMethod: ride.payment_method,
    pickupNote: ride.pickup_note ?? undefined,
    createdAt: now,
    expiresAt: Math.min(now + REQUEST_TTL_SECONDS * 1000, ride.offer?.expires_at ?? Infinity),
    isSimulated: true,
  };
}

/** Rides a driver can be offered: open, and (for an offer) not yet answered by this driver. */
export async function openRidesForDriver(relay: Relay, driverId: string): Promise<RelayRide[]> {
  const rides = await relay.select<RelayRide>('demo_rides', { where: { status: { in: ['searching', 'negotiating'] } }, order: ['created_at', 'desc'], limit: 10 });
  const now = Date.now();
  const offers = rides.filter((r) => r.kind === 'negotiate' && r.offer && r.offer.expires_at > now);
  const answered = offers.length
    ? await relay.select<RelayResponse>('demo_ride_responses', { where: { driver_id: driverId, offer_id: { in: offers.map((r) => r.offer!.id) } } })
    : [];
  const done = new Set(answered.map((a) => a.offer_id));
  return rides.filter((r) => (r.kind === 'quick_match' ? r.status === 'searching' : !!r.offer && r.offer.expires_at > now && !done.has(r.offer.id)));
}

/** Claim a Quick Match ride; false when another driver got there first. */
export async function claimRide(relay: Relay, rideId: string, driver: DriverSummary, now: number): Promise<boolean> {
  const rows = await relay.update<RelayRide>('demo_rides', { id: rideId, status: 'searching' }, { status: 'accepted', driver_id: driver.id, driver, matched_at: now, updated_at: now });
  return rows.length > 0;
}

export function responseRow(ride: RelayRide, driver: DriverSummary, kind: 'accept' | 'counter', amount: number, etaSeconds: number, now: number): RelayResponse {
  return {
    id: `rs-${ride.id}-${driver.id}-${now.toString(36)}`,
    ride_id: ride.id,
    offer_id: ride.offer!.id,
    driver_id: driver.id,
    driver,
    kind,
    amount: amount as RelayResponse['amount'],
    eta_seconds: etaSeconds,
    created_at: now,
    expires_at: now + MOCK_PRICING_CONFIG.negotiation.responseTtlSeconds * 1000,
  };
}

const toDriverResponse = (r: RelayResponse): DriverResponse => ({
  id: r.id,
  offerId: r.offer_id,
  driver: r.driver,
  kind: r.kind,
  amount: r.amount,
  etaSeconds: r.eta_seconds,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

/* ---------- Rider-side services backed by the relay ---------- */

export interface RelayServiceOptions {
  /** Who is booking; null when signed out (then rides aren't published). */
  rider: () => RelayRider | null;
  pollMs?: number;
  /** How long Quick Match waits for a real driver before "no drivers". */
  searchMs?: number;
}

/**
 * Matching through the relay: a booking becomes a ride row; drivers online in the driver app claim it
 * (Quick Match) or answer the offer (Negotiate). Only real drivers respond: with nobody online the
 * search ends in "no drivers", like production.
 */
export function createRelayMatching(relay: Relay, opts: RelayServiceOptions): MatchingService {
  const pollMs = opts.pollMs ?? 2_000;
  return {
    startQuickMatch(booking, listener: (e: QuickMatchEvent) => void) {
      const rider = opts.rider();
      if (!rider) {
        setTimeout(() => listener({ type: 'no_drivers' }), 0);
        return () => undefined;
      }
      let settled = false;
      const started = Date.now();
      const published = relay.upsert<RelayRide>('demo_rides', bookingToRide(booking, rider, started)).then(() => {
        logRelayEvent(relay, { actor: 'rider', type: 'ride.requested', summary: `${rider.name} requested a Quick Match ride to ${booking.destination.title}`, ride_id: booking.id, person_id: rider.id });
      });
      const stop = poll(async () => {
        await published;
        if (settled) return;
        const [row] = await relay.select<RelayRide>('demo_rides', { where: { id: booking.id } });
        if (row?.status === 'accepted' && row.driver) {
          settled = true;
          stop();
          listener({ type: 'matched', driver: row.driver });
        } else if (Date.now() - started > (opts.searchMs ?? 90_000)) {
          settled = true;
          stop();
          await relay.update<RelayRide>('demo_rides', { id: booking.id, status: 'searching' }, { status: 'expired', updated_at: Date.now() });
          listener({ type: 'no_drivers' });
        }
      }, pollMs);
      return () => {
        stop();
        // Leaving the search (cancel) while nobody has claimed the ride takes it off drivers' screens.
        if (!settled) void published.then(() => relay.update<RelayRide>('demo_rides', { id: booking.id, status: 'searching' }, { status: 'cancelled', cancelled_by: 'rider', updated_at: Date.now() })).catch(() => undefined);
      };
    },
    openNegotiation(booking, offer: PassengerOffer, listener: (e: NegotiationEvent) => void) {
      const rider = opts.rider();
      if (!rider) return () => undefined;
      const now = Date.now();
      const row = { ...bookingToRide({ ...booking, offer }, rider, now) };
      const published = relay.upsert<RelayRide>('demo_rides', row).then(() => {
        logRelayEvent(relay, { actor: 'rider', type: 'ride.offer', summary: `${rider.name} offered ${(offer.amount / 100).toLocaleString('en-NG')} naira for a ride to ${booking.destination.title}`, ride_id: booking.id, person_id: rider.id });
      });
      const seen = new Set<string>();
      let closed = false;
      const stop = poll(async () => {
        await published;
        if (closed) return;
        const responses = await relay.select<RelayResponse>('demo_ride_responses', { where: { offer_id: offer.id }, order: ['created_at', 'asc'] });
        for (const r of responses) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          listener({ type: 'response', response: toDriverResponse(r) });
        }
        if (Date.now() > offer.expiresAt) {
          closed = true;
          stop();
          listener({ type: 'closed' });
        }
      }, pollMs);
      return () => {
        closed = true;
        stop();
      };
    },
    // The driver app double-checks on its side (a driver already on a trip ignores the selection).
    isDriverAvailable: () => true,
    releaseDriver: () => undefined,
  };
}

/** Trip progress from the relay: the driver app writes its position and each stage. */
export function createRelayTrips(relay: Relay, opts: { pollMs?: number } = {}): TripService {
  return {
    follow(booking, listener: (e: TripEvent) => void) {
      let lastAt = 0;
      let stage = booking.status;
      const sent = new Set<string>();
      const once = (key: string, e: TripEvent) => {
        if (sent.has(key)) return;
        sent.add(key);
        listener(e);
      };
      if (stage === 'driver_arrived') sent.add('arrived');
      if (stage === 'in_progress') sent.add('arrived').add('started');
      return poll(async () => {
        const [row] = await relay.select<RelayRide>('demo_rides', { where: { id: booking.id } });
        if (!row) return;
        const loc = row.driver_location;
        if (loc && loc.at > lastAt) {
          lastAt = loc.at;
          listener({ type: 'driver_location', coordinate: loc.coordinate, etaSeconds: loc.eta_seconds });
        }
        if (row.status === 'arrived' || row.status === 'in_progress' || row.status === 'completed') once('arrived', { type: 'driver_arrived' });
        if (row.status === 'in_progress' || row.status === 'completed') once('started', { type: 'trip_started' });
        if (row.status === 'completed') once('completed', { type: 'trip_completed' });
        stage = booking.status;
      }, opts.pollMs ?? 2_000);
    },
  };
}
