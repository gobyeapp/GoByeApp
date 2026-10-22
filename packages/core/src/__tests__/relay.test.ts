import {
  applicationRow,
  claimRide,
  createMemoryRelay,
  createRelay,
  createRelayMatching,
  createRelayTrips,
  downsample,
  encodeQuery,
  mergeReview,
  openRidesForDriver,
  responseRow,
  rideToRequest,
  type RelayRide,
} from '../index';
import { createQuote } from '../pricing/fare';
import { MOCK_PRICING_CONFIG } from '../pricing/config';
import { MOCK_PLACES } from '../mocks/data';
import type { Booking, DriverSummary } from '../types';

const now = Date.UTC(2026, 9, 22, 12);
const route = { distanceMeters: 8_000, durationSeconds: 1_200, polyline: [MOCK_PLACES[0].coordinate, MOCK_PLACES[1].coordinate], isSimulated: true };
const quote = createQuote({ id: 'q1', route, category: 'go', config: MOCK_PRICING_CONFIG, now });
const booking: Booking = {
  id: 'bk-1',
  mode: 'quick_match',
  status: 'searching',
  pickup: MOCK_PLACES[0],
  destination: MOCK_PLACES[1],
  route,
  quote,
  paymentMethod: { id: 'wallet', type: 'wallet', label: 'GoBye Wallet' } as Booking['paymentMethod'],
  responses: [],
  createdAt: now,
  updatedAt: now,
};
const driver: DriverSummary = {
  id: '+2348030000001',
  firstName: 'Tunde',
  rating: 4.9,
  completedTrips: 12,
  vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', plate: 'KJA 123 AB', year: 2016, category: 'go' },
  coordinate: MOCK_PLACES[2].coordinate,
};
const rider = { id: '+2348031234567', name: 'Ada Okafor', phone: '+2348031234567', rating: 5 };

describe('relay client', () => {
  it('encodes PostgREST filters', () => {
    expect(decodeURIComponent(encodeQuery({ where: { status: { in: ['searching', 'negotiating'] }, driver_id: null }, order: ['created_at', 'desc'], limit: 5 }))).toBe(
      'select=*&status=in.("searching","negotiating")&driver_id=is.null&order=created_at.desc&limit=5',
    );
  });

  it('sends the key and Prefer headers, and reports an unreachable relay plainly', async () => {
    const calls: { url: string; init: { method: string; headers: Record<string, string> } }[] = [];
    const relay = createRelay({ url: 'http://relay.test/', key: 'anon', fetch: async (url, init) => (calls.push({ url, init }), { ok: true, status: 200, text: async () => '[]' }) });
    await relay.update('demo_rides', { id: 'x', status: 'searching' }, { status: 'accepted' });
    expect(calls[0].url).toBe('http://relay.test/rest/v1/demo_rides?id=eq.x&status=eq.searching');
    expect(calls[0].init.headers.apikey).toBe('anon');
    expect(calls[0].init.headers.Prefer).toBe('return=representation');
    const down = createRelay({ url: 'http://down.test', fetch: async () => Promise.reject(new Error('ECONNREFUSED')) });
    await expect(down.select('demo_rides')).rejects.toThrow('Can’t reach the demo relay at http://down.test.');
  });

  it('downsamples long routes', () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ latitude: i, longitude: i }));
    const d = downsample(pts, 40);
    expect(d).toHaveLength(40);
    expect(d[0]).toEqual(pts[0]);
    expect(d[39]).toEqual(pts[199]);
  });
});

describe('rides through the relay', () => {
  beforeEach(() => jest.useFakeTimers({ now }));
  afterEach(() => jest.useRealTimers());

  it('Quick Match: the rider publishes, one driver claims it, the rider is matched and follows the trip', async () => {
    const relay = createMemoryRelay();
    const matching = createRelayMatching(relay, { rider: () => rider, pollMs: 1_000 });
    const events: string[] = [];
    const stop = matching.startQuickMatch(booking, (e) => events.push(e.type));
    await jest.advanceTimersByTimeAsync(10);
    const open = await openRidesForDriver(relay, driver.id);
    expect(open.map((r) => r.id)).toEqual(['bk-1']);
    const req = rideToRequest(open[0], MOCK_PLACES[2].coordinate, now);
    expect(req.amount).toBe(quote.suggested);
    expect(await claimRide(relay, 'bk-1', driver, now)).toBe(true);
    expect(await claimRide(relay, 'bk-1', { ...driver, id: 'other' }, now)).toBe(false);
    await jest.advanceTimersByTimeAsync(1_100);
    expect(events).toEqual(['matched']);
    stop();
    expect((await relay.select<RelayRide>('demo_rides'))[0].status).toBe('accepted');

    const trip: string[] = [];
    const unfollow = createRelayTrips(relay, { pollMs: 1_000 }).follow({ ...booking, status: 'driver_en_route' }, (e) => trip.push(e.type));
    await relay.update<RelayRide>('demo_rides', { id: 'bk-1' }, { driver_location: { coordinate: driver.coordinate, eta_seconds: 120, at: now + 1 }, status: 'arrived' });
    await jest.advanceTimersByTimeAsync(1_100);
    await relay.update<RelayRide>('demo_rides', { id: 'bk-1' }, { status: 'completed' });
    await jest.advanceTimersByTimeAsync(1_100);
    unfollow();
    expect(trip).toEqual(['driver_location', 'driver_arrived', 'trip_started', 'trip_completed']);
  });

  it('Quick Match with nobody online ends in no drivers; leaving the search cancels the ride', async () => {
    const relay = createMemoryRelay();
    const matching = createRelayMatching(relay, { rider: () => rider, pollMs: 1_000, searchMs: 5_000 });
    const events: string[] = [];
    matching.startQuickMatch(booking, (e) => events.push(e.type));
    await jest.advanceTimersByTimeAsync(6_500);
    expect(events).toEqual(['no_drivers']);
    expect((await relay.select<RelayRide>('demo_rides'))[0].status).toBe('expired');

    const stop = matching.startQuickMatch({ ...booking, id: 'bk-2' }, () => undefined);
    await jest.advanceTimersByTimeAsync(10);
    stop();
    await jest.advanceTimersByTimeAsync(10);
    expect((await relay.select<RelayRide>('demo_rides', { where: { id: 'bk-2' } }))[0].status).toBe('cancelled');
  });

  it('Negotiate: drivers answer the offer once each and the rider receives every answer', async () => {
    const relay = createMemoryRelay();
    const offer = { id: 'of-1', amount: quote.suggested, round: 1, createdAt: now, expiresAt: now + 90_000 };
    const got: number[] = [];
    const stop = createRelayMatching(relay, { rider: () => rider, pollMs: 1_000 }).openNegotiation({ ...booking, mode: 'negotiate', status: 'negotiating' }, offer, (e) => {
      if (e.type === 'response') got.push(e.response.amount);
    });
    await jest.advanceTimersByTimeAsync(10);
    const [ride] = await openRidesForDriver(relay, driver.id);
    await relay.insert('demo_ride_responses', responseRow(ride, driver, 'counter', ride.offer!.amount + 50_00, 300, now));
    expect(await openRidesForDriver(relay, driver.id)).toEqual([]);
    expect(await openRidesForDriver(relay, 'someone-else')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1_100);
    expect(got).toEqual([ride.offer!.amount + 50_00]);
    stop();
  });
});

describe('driver applications through the relay', () => {
  it('shares masked numbers and only whether photos exist, and merges staff decisions back', () => {
    const app = {
      status: 'pending_review' as const,
      licence: { number: 'ABC123456789', expiry: '2029-01-01', photoUri: 'file://licence.jpg' },
      identity: { type: 'nin' as const, number: '12345678901', selfieUri: 'file://me.jpg' },
      documents: { insurance: 'file://ins.jpg' },
    };
    const row = applicationRow(app, { phone: '+2348030000001', name: 'Tunde Bakare' }, now);
    expect(row.application.licence).toEqual({ number: '••••6789', expiry: '2029-01-01', hasPhoto: true });
    expect(row.application.identity?.number).toBe('••••8901');
    expect(row.application.documents).toEqual({ registration: false, insurance: true, roadworthiness: false });
    expect(JSON.stringify(row)).not.toContain('file://');
    const merged = mergeReview(app, { ...row, status: 'changes_requested', issues: [{ id: 'i1', code: 'insurance_expired', raisedAt: now }], review_note: 'Insurance ran out in June.' });
    expect(merged.status).toBe('changes_requested');
    expect(merged.licence?.photoUri).toBe('file://licence.jpg');
    expect(merged.reviewNote).toBe('Insurance ran out in June.');
  });
});
