import type { ApiClient } from '../infra/http';
import type { ApiResult } from '../infra/errors';
import { MOCK_PRICING_CONFIG } from '../pricing/config';
import { poll } from '../relay/rides';
import type { MapService, MatchingService, NegotiationEvent, PricingService, QuickMatchEvent, TripEvent, TripService } from '../services/types';
import type { Booking, DriverResponse, DriverSummary, FareBreakdown, FareQuote, Kobo, LatLng, PassengerOffer, Place, RouteEstimate, VehicleCategoryId } from '../types';

/**
 * Rides through the GoBye API (D-100, D-104): the typed calls both apps make, and the rider's booking
 * services (prices, matching, the live trip) built on them behind the same interfaces the simulated and
 * demo-relay versions use. The app asks for news every couple of seconds; the server decides everything
 * that matters (the fare, who gets the ride, the PIN).
 */

export interface ServerPlace extends LatLng {
  label: string;
}
export interface ServerQuote {
  id: string;
  category: VehicleCategoryId;
  suggestedKobo: number;
  minOfferKobo: number;
  maxOfferKobo: number;
  breakdown: FareBreakdown;
  expiresAt: string;
}
export interface ServerQuotes {
  city: 'lagos' | 'abuja';
  route: { distanceMeters: number; durationSeconds: number; polyline: string | null; estimated: boolean };
  quotes: ServerQuote[];
}
export interface ServerDriver {
  id: string;
  firstName: string;
  rating: number | null;
  completedTrips: number;
  photoUrl: string | null;
  vehicle: { category: VehicleCategoryId; make: string; model: string; colour: string; plate: string } | null;
  location?: { latitude: number; longitude: number; heading: number | null; at: string; stale: boolean } | null;
  etaSeconds?: number | null;
}
export interface ServerRide {
  id: string;
  version: number;
  status: 'searching' | 'negotiating' | 'matched' | 'driver_en_route' | 'driver_arrived' | 'in_progress' | 'payment_pending' | 'completed' | 'cancelled' | 'no_drivers' | 'failed';
  mode: 'quick_match' | 'negotiate';
  category: VehicleCategoryId;
  pickup: ServerPlace;
  destination: ServerPlace;
  quotedFareKobo: number | null;
  agreedFareKobo: number | null;
  offer: { id: string; amountKobo: number; round: number; expiresAt: string; minKobo: number; maxKobo: number } | null;
  responses: { id: string; offerId: string; kind: 'accept' | 'counter'; amountKobo: number; etaSeconds: number; createdAt: string; expiresAt: string; driver: ServerDriver | null }[];
  driver: ServerDriver | null;
  pickupPin: string | null;
  payTo: { bankName: string; accountNumber: string; accountName: string } | null;
  payment: { method: 'transfer' | 'cash' | 'wallet' | null; claimedAt: string | null; paidAt: string | null };
  cancelledBy: 'rider' | 'driver' | 'system' | null;
  cancelFeeKobo: number;
  createdAt: string;
  matchedAt: string | null;
  completedAt: string | null;
}

export type RidePaymentMethod = 'transfer' | 'cash' | 'wallet';

export function createRidesApi(api: ApiClient) {
  return {
    quotes: (pickup: ServerPlace, destination: ServerPlace, idempotencyKey: string) => api.post<ServerQuotes>('/quotes', { pickup, destination }, { idempotencyKey }),
    book: (b: { quoteId: string; mode: 'quick_match' | 'negotiate'; offerKobo?: number; pickupLabel?: string; destinationLabel?: string }, idempotencyKey: string) => api.post<ServerRide>('/rides', b, { idempotencyKey }),
    get: (id: string) => api.get<ServerRide>(`/rides/${id}`),
    current: () => api.get<{ ride: ServerRide | null }>('/rides/current'),
    list: (before?: string) => api.get<{ rides: ServerRide[]; nextBefore: string | null }>('/rides', before ? { query: { before } } : {}),
    raise: (id: string, amountKobo: number, idempotencyKey: string) => api.post<ServerRide>(`/rides/${id}/offers`, { amountKobo }, { idempotencyKey }),
    select: (id: string, responseId: string, idempotencyKey: string) => api.post<ServerRide>(`/rides/${id}/select`, { responseId }, { idempotencyKey }),
    cancel: (id: string, reason: string | undefined, idempotencyKey: string) => api.post<ServerRide>(`/rides/${id}/cancel`, reason ? { reason } : {}, { idempotencyKey }),
    pay: (id: string, method: RidePaymentMethod, idempotencyKey: string) => api.post<ServerRide>(`/rides/${id}/payment`, { method }, { idempotencyKey }),
    rate: (id: string, stars: number, idempotencyKey: string) => api.post<ServerRide>(`/rides/${id}/rating`, { stars }, { idempotencyKey }),
  };
}
export type RidesApi = ReturnType<typeof createRidesApi>;

export interface ServerRequest {
  rideId: string;
  mode: 'quick_match' | 'negotiate';
  category: VehicleCategoryId;
  pickup: ServerPlace;
  destination: ServerPlace;
  route: { distanceMeters: number; durationSeconds: number; estimated: boolean };
  toPickup: { distanceMeters: number; etaSeconds: number };
  fareKobo: number;
  fixedFare: boolean;
  quotedFareKobo: number;
  offer: { id: string; amountKobo: number; round: number; maxCounterKobo: number } | null;
  myResponse: { kind: 'accept' | 'counter'; amountKobo: number; expiresAt: string } | null;
  expiresAt: string;
  rider: { firstName: string; rating: number | null };
}
export interface ServerDriverRide extends Omit<ServerRide, 'offer' | 'responses' | 'driver' | 'pickupPin' | 'payTo'> {
  rider: { firstName: string; rating: number | null };
  pinRequired: boolean;
}
export type DriverFix = LatLng & { heading?: number; accuracyMeters?: number };

export function createDriverRidesApi(api: ApiClient) {
  const step = (id: string, name: string, body: object, idempotencyKey: string) => api.post<ServerDriverRide>(`/drivers/me/rides/${id}/${name}`, body, { idempotencyKey });
  return {
    presence: () => api.get<{ online: boolean; category: VehicleCategoryId | null }>('/drivers/me/presence'),
    setPresence: (online: boolean, location?: DriverFix) => api.request<{ online: boolean }>('PUT', '/drivers/me/presence', { body: { online, ...(location ? { location } : {}) } }),
    location: (fix: DriverFix) => api.request<void>('PUT', '/drivers/me/location', { body: fix }),
    requests: () => api.get<{ requests: ServerRequest[] }>('/drivers/me/requests'),
    accept: (rideId: string, idempotencyKey: string) => api.post<{ matched: boolean; ride?: ServerDriverRide; response?: ServerRequest['myResponse'] }>(`/drivers/me/requests/${rideId}/accept`, {}, { idempotencyKey }),
    counter: (rideId: string, amountKobo: number, idempotencyKey: string) => api.post<{ matched: false; response: ServerRequest['myResponse'] }>(`/drivers/me/requests/${rideId}/counter`, { amountKobo }, { idempotencyKey }),
    decline: (rideId: string, idempotencyKey: string) => api.post<{ declined: true }>(`/drivers/me/requests/${rideId}/decline`, {}, { idempotencyKey }),
    current: () => api.get<{ ride: ServerDriverRide | null }>('/drivers/me/rides/current'),
    arrived: (id: string, key: string) => step(id, 'arrived', {}, key),
    start: (id: string, pin: string, key: string) => step(id, 'start', { pin }, key),
    complete: (id: string, key: string) => step(id, 'complete', {}, key),
    cancel: (id: string, reason: string | undefined, key: string) => api.post<{ cancelled: true }>(`/drivers/me/rides/${id}/cancel`, reason ? { reason } : {}, { idempotencyKey: key }),
    confirmPayment: (id: string, method: 'transfer' | 'cash' | undefined, key: string) => step(id, 'payment/confirm', method ? { method } : {}, key),
    rate: (id: string, stars: number, key: string) => step(id, 'rating', { stars }, key),
  };
}
export type DriverRidesApi = ReturnType<typeof createDriverRidesApi>;

/* ---------- Rider services on the API ---------- */

const ms = (iso: string) => Date.parse(iso);

export function toDriverSummary(d: ServerDriver): DriverSummary {
  return {
    id: d.id,
    firstName: d.firstName,
    photoUrl: d.photoUrl ?? undefined,
    rating: d.rating ?? 5,
    completedTrips: d.completedTrips,
    vehicle: { category: d.vehicle?.category ?? 'go', make: d.vehicle?.make ?? '', model: d.vehicle?.model ?? '', colour: d.vehicle?.colour ?? '', plate: d.vehicle?.plate ?? '', year: 0 },
    coordinate: d.location ? { latitude: d.location.latitude, longitude: d.location.longitude } : { latitude: 0, longitude: 0 },
  };
}

export function toFareQuote(q: ServerQuote, estimated: boolean, now: number): FareQuote {
  return { id: q.id, category: q.category, breakdown: q.breakdown, suggested: q.suggestedKobo as Kobo, negotiationRange: { min: q.minOfferKobo as Kobo, max: q.maxOfferKobo as Kobo }, createdAt: now, expiresAt: ms(q.expiresAt), isSimulated: estimated };
}

export interface ServerRideServices {
  maps: Pick<MapService, 'getRoute'>;
  pricing: Pick<PricingService, 'quoteAll' | 'quote'>;
  matching: MatchingService;
  trips: TripService;
  /** The server's ride behind a booking made on this phone (null before it is booked). */
  rideIdFor(bookingId: string): string | null;
  /** Accept one driver's answer; the server locks the fare. */
  select(bookingId: string, responseId: string): Promise<ApiResult<ServerRide>>;
  cancel(bookingId: string, reason?: string): Promise<ApiResult<ServerRide> | null>;
  pay(bookingId: string, method: RidePaymentMethod): Promise<ApiResult<ServerRide> | null>;
  rate(bookingId: string, stars: number): Promise<ApiResult<ServerRide> | null>;
  /** After the app restarts: find the ride still in progress and tie it to the stored booking. */
  resume(bookingId: string): Promise<ServerRide | null>;
}

export interface ServerRideOptions {
  pollMs?: number;
  newKey(): string;
  now?: () => number;
  /** Names for the two ends of a route, when the app knows them (the server stores what the rider chose). */
  labels?: (from: LatLng, to: LatLng) => { pickup: string; destination: string } | null;
}

/**
 * The rider's booking services on the API. `maps.getRoute` asks the server for prices (it works out the
 * route itself), so the route and the prices shown always come from the same answer; a ride is then booked
 * from one of those prices by id. Nothing here trusts a fare held on the phone.
 */
export function createServerRideServices(api: RidesApi, o: ServerRideOptions): ServerRideServices {
  const pollMs = o.pollMs ?? 2500;
  const now = o.now ?? Date.now;
  const priced = new WeakMap<RouteEstimate, { quotes: FareQuote[] }>();
  const rides = new Map<string, string>();
  const key = (a: LatLng) => `${a.latitude.toFixed(5)},${a.longitude.toFixed(5)}`;
  let last: { k: string; at: number; route: RouteEstimate } | null = null;

  const book = async (booking: Booking, offer?: PassengerOffer): Promise<ApiResult<ServerRide>> => {
    const r = await api.book({ quoteId: booking.quote.id, mode: booking.mode, ...(offer ? { offerKobo: offer.amount } : {}), pickupLabel: label(booking.pickup), destinationLabel: label(booking.destination) }, `book-${booking.id}`);
    if (r.ok) rides.set(booking.id, r.value.id);
    return r;
  };

  const maps: ServerRideServices['maps'] = {
    async getRoute(from, to) {
      const k = `${key(from)}>${key(to)}`;
      // The same trip asked again within a minute reuses the answer (and its prices).
      if (last && last.k === k && now() - last.at < 60_000) return last.route;
      const names = o.labels?.(from, to) ?? { pickup: 'Pickup', destination: 'Destination' };
      const r = await api.quotes({ ...from, label: names.pickup }, { ...to, label: names.destination }, o.newKey());
      if (!r.ok) throw new Error(r.error.message);
      const route: RouteEstimate = { distanceMeters: r.value.route.distanceMeters, durationSeconds: r.value.route.durationSeconds, polyline: [from, to], isSimulated: r.value.route.estimated };
      priced.set(route, { quotes: r.value.quotes.map((q) => toFareQuote(q, r.value.route.estimated, now())) });
      last = { k, at: now(), route };
      return route;
    },
  };

  const pricing: ServerRideServices['pricing'] = {
    async quoteAll(route) {
      const p = priced.get(route);
      if (!p) throw new Error('Get the route from the server before asking for prices.');
      return p.quotes;
    },
    async quote(route, category) {
      const q = (await pricing.quoteAll(route)).find((x) => x.category === category);
      if (!q) throw new Error('That vehicle type isn’t available for this trip.');
      return q;
    },
  };

  const matching: MatchingService = {
    startQuickMatch(booking, listener: (e: QuickMatchEvent) => void) {
      let settled = false;
      const booked = book(booking);
      const stop = poll(async () => {
        const b = await booked;
        if (settled) return;
        if (!b.ok) {
          settled = true;
          stop();
          return listener({ type: 'no_drivers' });
        }
        const r = await api.get(b.value.id);
        if (!r.ok || settled) return;
        if (r.value.driver && ['driver_en_route', 'driver_arrived', 'in_progress', 'matched'].includes(r.value.status)) {
          settled = true;
          stop();
          listener({ type: 'matched', driver: toDriverSummary(r.value.driver) });
        } else if (['no_drivers', 'cancelled', 'failed'].includes(r.value.status)) {
          settled = true;
          stop();
          listener({ type: 'no_drivers' });
        }
      }, pollMs);
      return () => {
        stop();
        // Leaving the search before anyone took the ride cancels it on the server.
        if (!settled) void booked.then((b) => (b.ok ? api.cancel(b.value.id, undefined, `cancel-${booking.id}`) : null)).catch(() => undefined);
        settled = true;
      };
    },
    openNegotiation(booking, offer, listener: (e: NegotiationEvent) => void) {
      let closed = false;
      const existing = rides.get(booking.id);
      // A second (raised) offer on the same booking goes to the ride that already exists.
      const opened: Promise<ApiResult<ServerRide>> = existing && offer.round > 1 ? api.raise(existing, offer.amount, `raise-${booking.id}-${offer.round}`) : book(booking, offer);
      const seen = new Set<string>();
      const stop = poll(async () => {
        const b = await opened;
        if (closed) return;
        if (!b.ok) {
          closed = true;
          stop();
          return listener({ type: 'closed' });
        }
        const r = await api.get(b.value.id);
        if (!r.ok || closed) return;
        for (const x of r.value.responses) {
          // One driver has one answer per ride; a changed answer (a new amount) is news again.
          const k = `${x.id}:${x.kind}:${x.amountKobo}`;
          if (seen.has(k) || !x.driver) continue;
          seen.add(k);
          // The app's offer id is its own; the server's answers are tied to the server's offer.
          const response: DriverResponse = { id: x.id, offerId: offer.id, driver: toDriverSummary(x.driver), kind: x.kind, amount: x.amountKobo as Kobo, etaSeconds: x.etaSeconds, createdAt: ms(x.createdAt), expiresAt: ms(x.expiresAt) };
          listener({ type: 'response', response });
        }
        if (r.value.status !== 'negotiating' || now() > offer.expiresAt + MOCK_PRICING_CONFIG.negotiation.responseTtlSeconds * 1000) {
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
    // The server is the authority: `select` fails with DRIVER_UNAVAILABLE when the driver has gone.
    isDriverAvailable: () => true,
    releaseDriver: () => undefined,
  };

  const trips: TripService = {
    follow(booking, listener: (e: TripEvent) => void) {
      let lastAt = 0;
      const sent = new Set<string>();
      const once = (k: string, e: TripEvent) => {
        if (sent.has(k)) return;
        sent.add(k);
        listener(e);
      };
      if (booking.status === 'driver_arrived') sent.add('arrived');
      if (booking.status === 'in_progress') sent.add('arrived').add('started');
      return poll(async () => {
        const id = rides.get(booking.id) ?? (await resume(booking.id))?.id;
        if (!id) return;
        const r = await api.get(id);
        if (!r.ok) return;
        const loc = r.value.driver?.location;
        if (loc && ms(loc.at) > lastAt) {
          lastAt = ms(loc.at);
          listener({ type: 'driver_location', coordinate: { latitude: loc.latitude, longitude: loc.longitude }, etaSeconds: r.value.driver?.etaSeconds ?? 0 });
        } else if (loc?.stale) listener({ type: 'feed_paused' });
        const s = r.value.status;
        if (['driver_arrived', 'in_progress', 'payment_pending', 'completed'].includes(s)) once('arrived', { type: 'driver_arrived' });
        if (['in_progress', 'payment_pending', 'completed'].includes(s)) once('started', { type: 'trip_started' });
        if (['payment_pending', 'completed'].includes(s)) once('completed', { type: 'trip_completed' });
      }, pollMs);
    },
  };

  async function resume(bookingId: string): Promise<ServerRide | null> {
    const r = await api.current();
    if (!r.ok || !r.value.ride) return null;
    rides.set(bookingId, r.value.ride.id);
    return r.value.ride;
  }
  const withRide = async <T>(bookingId: string, fn: (id: string) => Promise<T>): Promise<T | null> => {
    const id = rides.get(bookingId) ?? (await resume(bookingId))?.id;
    return id ? fn(id) : null;
  };

  return {
    maps,
    pricing,
    matching,
    trips,
    rideIdFor: (bookingId) => rides.get(bookingId) ?? null,
    select: async (bookingId, responseId) => {
      const id = rides.get(bookingId);
      if (!id) return { ok: false, error: { code: 'not_found', message: 'This ride is no longer open.', status: 404, retryable: false } as never };
      return api.select(id, responseId, `select-${bookingId}-${responseId}`);
    },
    cancel: (bookingId, reason) => withRide(bookingId, (id) => api.cancel(id, reason, `cancel-${bookingId}`)),
    pay: (bookingId, method) => withRide(bookingId, (id) => api.pay(id, method, `pay-${bookingId}-${method}`)),
    rate: (bookingId, stars) => withRide(bookingId, (id) => api.rate(id, stars, `rate-${bookingId}`)),
    resume,
  };
}

const label = (p: Place) => (p.title || p.subtitle || 'Place').slice(0, 200);
