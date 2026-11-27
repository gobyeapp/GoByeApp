import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CURRENT_CONSENTS, createApiClient, createDriverRidesApi, createRidesApi, createServerRideServices, type Booking, type DriverResponse, type DriverSummary, type Place, type TripEvent } from '@gobye/core';
import { bearer, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';

const consents = [
  { document: 'terms', version: CURRENT_CONSENTS.terms },
  { document: 'privacy', version: CURRENT_CONSENTS.privacy },
];
const IKEJA: Place = { id: 'p1', title: 'Ikeja City Mall', subtitle: 'Ikeja', coordinate: { latitude: 6.6018, longitude: 3.3515 } };
const VI: Place = { id: 'p2', title: 'Aunty Bisi’s house', subtitle: 'Victoria Island', coordinate: { latitude: 6.4281, longitude: 3.4219 } };
const until = async (ok: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
};

/** The apps' own ride code (packages/core/src/server/rides.ts) driven against the real API (D-104). */
describe('the apps’ ride services against the API', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let keys: Keys;
  let t: TestApp;
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    keys = await makeKeys();
    t = await makeApp({ db: tdb.db, keys, config: { MAPS_PROVIDER: 'fake' } });
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await tdb.drop();
  });

  async function client(role: 'rider' | 'driver') {
    const sub = randomUUID();
    const token = await keys.token({ sub, phone: `234803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}` });
    const made = await t.inject({ method: 'POST', url: '/v1/me/profile', headers: { ...bearer(token), 'idempotency-key': randomUUID() }, payload: { role, fullName: role === 'driver' ? 'Tunde Bakare' : 'Ada Obi', ...(role === 'driver' ? { city: 'lagos' } : {}), consents } });
    assert.equal(made.statusCode, 201, made.body);
    if (role === 'driver') {
      await tdb.db.query(`update app.drivers set verification_status = 'approved', approved_at = now() where user_id = $1`, [sub]);
      await tdb.db.query(`insert into app.vehicles (driver_id, category, make, model, colour, year, plate, status) values ($1, 'go', 'Toyota', 'Corolla', 'Silver', 2016, $2, 'active')`, [sub, `LND${String(Math.floor(Math.random() * 900) + 100)}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}D`]);
    }
    const api = createApiClient({
      baseUrl: 'http://api.test/v1',
      getToken: () => token,
      sleep: async () => undefined,
      fetch: async (url, init) => {
        const r = await t.inject({ method: init.method as 'GET', url: url.replace('http://api.test', ''), headers: init.headers, ...(init.body ? { payload: init.body } : {}) });
        return { ok: r.statusCode < 400, status: r.statusCode, headers: { get: (k: string) => (r.headers[k.toLowerCase()] as string | undefined) ?? null }, text: async () => r.body };
      },
    });
    return { sub, api };
  }
  const booking = (o: Partial<Booking>): Booking => ({ id: `bk-${randomUUID().slice(0, 8)}`, mode: 'quick_match', status: 'searching', pickup: IKEJA, destination: VI, paymentMethod: { id: 'transfer', type: 'bank_transfer', label: 'Bank transfer' } as never, responses: [], createdAt: Date.now(), updatedAt: Date.now(), ...o }) as Booking;

  test('Quick Match end to end with the rider’s services and the driver’s calls', { skip }, async () => {
    const rider = await client('rider');
    const d = await client('driver');
    const driver = createDriverRidesApi(d.api);
    const rides = createRidesApi(rider.api);
    const svc = createServerRideServices(rides, { pollMs: 20, newKey: () => randomUUID() });
    assert.equal((await driver.setPresence(true, { latitude: 6.602, longitude: 3.351 })).ok, true);

    const route = await svc.maps.getRoute(IKEJA.coordinate, VI.coordinate);
    assert.equal(route.isSimulated, true, 'the stand-in route is labelled so the app can say "estimate"');
    assert.equal(await svc.maps.getRoute(IKEJA.coordinate, VI.coordinate), route, 'asked again: the same answer, no second set of prices');
    const quotes = await svc.pricing.quoteAll(route);
    assert.equal(quotes.length, 4);
    const quote = quotes.find((q) => q.category === 'go')!;
    await assert.rejects(svc.pricing.quoteAll({ ...route }), /server/, 'prices only come with a server route');

    const b = booking({ route, quote });
    let matched: DriverSummary | null = null;
    const stop = svc.matching.startQuickMatch(b, (e) => { if (e.type === 'matched') matched = e.driver; });
    await until(() => svc.rideIdFor(b.id) !== null);
    const rideId = svc.rideIdFor(b.id)!;
    let reqs = await driver.requests();
    await until(() => true);
    assert.ok(reqs.ok && reqs.value.requests.length === 1);
    assert.equal(reqs.ok && reqs.value.requests[0]!.destination.label, 'Aunty Bisi’s house', 'the driver sees the rider’s own name for the place');
    assert.equal(reqs.ok && reqs.value.requests[0]!.fareKobo, quote.suggested);
    const acc = await driver.accept(rideId, randomUUID());
    assert.ok(acc.ok && acc.value.matched);
    await until(() => matched !== null);
    assert.equal(matched!.firstName, 'Tunde');
    assert.equal(matched!.vehicle.colour, 'Silver');
    stop();
    assert.equal((await rides.get(rideId)).ok && ((await rides.get(rideId)) as { value: { status: string } }).value.status, 'driver_en_route', 'stopping to listen after a match does not cancel the ride');

    const events: TripEvent['type'][] = [];
    const unfollow = svc.trips.follow({ ...b, status: 'driver_en_route' }, (e) => events.push(e.type));
    await driver.location({ latitude: IKEJA.coordinate.latitude, longitude: IKEJA.coordinate.longitude, heading: 10 });
    await until(() => events.includes('driver_location'));
    assert.ok((await driver.arrived(rideId, randomUUID())).ok);
    await until(() => events.includes('driver_arrived'));
    const view = await rides.get(rideId);
    assert.ok(view.ok && view.value.pickupPin);
    assert.equal((await driver.start(rideId, view.ok ? view.value.pickupPin! : '', randomUUID())).ok, true);
    assert.equal((await driver.complete(rideId, randomUUID())).ok, true);
    await until(() => events.includes('trip_completed'));
    unfollow();
    assert.deepEqual(events.filter((e) => e !== 'driver_location' && e !== 'feed_paused'), ['driver_arrived', 'trip_started', 'trip_completed']);

    const claimed = await svc.pay(b.id, 'transfer');
    assert.ok(claimed?.ok && claimed.value.status === 'payment_pending');
    assert.equal((await driver.confirmPayment(rideId, undefined, randomUUID())).ok, true);
    const rated = await svc.rate(b.id, 5);
    assert.ok(rated?.ok && rated.value.status === 'completed');
    assert.equal((await driver.rate(rideId, 5, randomUUID())).ok, true);
    reqs = await driver.requests();
    assert.ok(reqs.ok && reqs.value.requests.length === 0);
  });

  test('Negotiate with the rider’s services: offer, a counter arrives, raise, choose; leaving a search cancels it', { skip }, async () => {
    await tdb.db.query(`update app.driver_presence set online = false`);
    const rider = await client('rider');
    const d = await client('driver');
    const driver = createDriverRidesApi(d.api);
    const rides = createRidesApi(rider.api);
    const svc = createServerRideServices(rides, { pollMs: 20, newKey: () => randomUUID() });
    await driver.setPresence(true, { latitude: 6.602, longitude: 3.351 });
    const route = await svc.maps.getRoute(IKEJA.coordinate, VI.coordinate);
    const quote = await svc.pricing.quote(route, 'go');
    const b = booking({ mode: 'negotiate', status: 'negotiating', route, quote });
    const offer1 = { id: 'of-1', amount: quote.negotiationRange.min, round: 1, createdAt: Date.now(), expiresAt: Date.now() + 90_000 };
    const got: DriverResponse[] = [];
    let stop = svc.matching.openNegotiation(b, offer1, (e) => { if (e.type === 'response') got.push(e.response); });
    await until(() => svc.rideIdFor(b.id) !== null);
    const rideId = svc.rideIdFor(b.id)!;
    assert.equal((await driver.counter(rideId, quote.negotiationRange.min + 10_000, randomUUID())).ok, true);
    await until(() => got.length === 1);
    assert.deepEqual([got[0]!.kind, got[0]!.amount, got[0]!.offerId], ['counter', quote.negotiationRange.min + 10_000, 'of-1']);
    stop();

    const offer2 = { ...offer1, id: 'of-2', amount: (quote.negotiationRange.min + 5000) as never, round: 2 };
    stop = svc.matching.openNegotiation({ ...b, offer: offer1 }, offer2, (e) => { if (e.type === 'response') got.push(e.response); });
    await until(() => true);
    const raisedTo = async () => { const v = await rides.get(rideId); return v.ok ? v.value.offer?.round : 0; };
    await until(() => true);
    for (let i = 0; i < 100 && (await raisedTo()) !== 2; i++) await new Promise((r) => setTimeout(r, 15));
    assert.equal(await raisedTo(), 2, 'the raised offer went to the same ride');
    assert.equal(svc.rideIdFor(b.id), rideId);
    const acc = await driver.accept(rideId, randomUUID());
    assert.ok(acc.ok && acc.value.matched === false);
    await until(() => got.length === 2);
    const chosen = await svc.select(b.id, got[1]!.id);
    assert.ok(chosen.ok && chosen.value.status === 'driver_en_route' && chosen.value.agreedFareKobo === quote.negotiationRange.min + 5000);
    stop();
    const gone = await svc.select(b.id, randomUUID());
    assert.equal(gone.ok, false, 'a second choice is refused');
    assert.ok((await svc.cancel(b.id, 'Changed plans'))?.ok);

    // A Quick Match search the rider walks away from is cancelled on the server.
    const route2 = await svc.maps.getRoute(VI.coordinate, IKEJA.coordinate);
    const b2 = booking({ route: route2, quote: await svc.pricing.quote(route2, 'comfort') });
    const leave = svc.matching.startQuickMatch(b2, () => undefined);
    await until(() => svc.rideIdFor(b2.id) !== null);
    leave();
    const id2 = svc.rideIdFor(b2.id)!;
    for (let i = 0; i < 100; i++) {
      const v = await rides.get(id2);
      if (v.ok && v.value.status === 'cancelled') break;
      await new Promise((r) => setTimeout(r, 15));
    }
    const end = await rides.get(id2);
    assert.ok(end.ok && end.value.status === 'cancelled');
  });
});
