import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CURRENT_CONSENTS } from '@gobye/core';
import { addStaff, bearer, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';

const consents = [
  { document: 'terms', version: CURRENT_CONSENTS.terms },
  { document: 'privacy', version: CURRENT_CONSENTS.privacy },
];
const IKEJA = { latitude: 6.6018, longitude: 3.3515, label: 'Ikeja City Mall' };
const VI = { latitude: 6.4281, longitude: 3.4219, label: 'Victoria Island' };
const NEAR_IKEJA = { latitude: 6.605, longitude: 3.35 };

/** Rides on the server (D-100): quotes, Quick Match, Negotiate, the trip, payment to the driver, ratings. */
describe('rides API', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let keys: Keys;
  let t: TestApp;
  let clock = Date.now();
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    keys = await makeKeys();
    t = await makeApp({ db: tdb.db, keys, now: () => clock, config: { MAPS_PROVIDER: 'fake' } });
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await tdb.drop();
  });

  const phone = () => `234803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const call = async (method: 'GET' | 'PUT' | 'POST', url: string, sub: string, payload?: object, o: { key?: string; aal?: string } = {}) =>
    t.inject({
      method,
      url,
      headers: { ...bearer(await keys.token({ sub, aal: o.aal ?? 'aal1', phone: '2348031234567' })), ...(method === 'GET' ? {} : { 'idempotency-key': o.key ?? randomUUID() }) },
      ...(payload ? { payload } : {}),
    });

  async function person(role: 'rider' | 'driver', name = 'Ada Obi') {
    const sub = randomUUID();
    const r = await t.inject({ method: 'POST', url: '/v1/me/profile', headers: { ...bearer(await keys.token({ sub, phone: phone() })), 'idempotency-key': randomUUID() }, payload: { role, fullName: name, ...(role === 'driver' ? { city: 'lagos' } : {}), consents } });
    assert.equal(r.statusCode, 201, r.body);
    return sub;
  }
  /** An approved driver with an active vehicle, online near Ikeja. */
  async function driver(o: { category?: string; online?: boolean; at?: { latitude: number; longitude: number } } = {}) {
    const sub = await person('driver', 'Tunde Bakare');
    await tdb.db.query(`update app.drivers set verification_status = 'approved', approved_at = now() where user_id = $1`, [sub]);
    await tdb.db.query(`insert into app.vehicles (driver_id, category, make, model, colour, year, plate, status) values ($1, $2, 'Toyota', 'Corolla', 'Silver', 2016, $3, 'active')`, [sub, o.category ?? 'go', `KJA${String(Math.floor(Math.random() * 900) + 100)}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}B`]);
    if (o.online !== false) {
      const r = await call('PUT', '/v1/drivers/me/presence', sub, { online: true, location: o.at ?? NEAR_IKEJA });
      assert.equal(r.statusCode, 200, r.body);
    }
    return sub;
  }
  async function quote(rider: string, category = 'go') {
    const r = await call('POST', '/v1/quotes', rider, { pickup: IKEJA, destination: VI });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().data.quotes.find((q: { category: string }) => q.category === category);
  }
  const offline = () => tdb.db.query(`update app.driver_presence set online = false`);
  const ok = (r: { statusCode: number; body: string; json(): { data: never } }, code = 200) => {
    assert.equal(r.statusCode, code, r.body);
    return r.json().data as Record<string, never>;
  };

  test('quotes come from the server; a trip outside the cities is refused', { skip }, async () => {
    const rider = await person('rider');
    const r = await call('POST', '/v1/quotes', rider, { pickup: IKEJA, destination: VI });
    const d = ok(r, 201) as unknown as { city: string; route: { estimated: boolean; distanceMeters: number }; quotes: { category: string; suggestedKobo: number; minOfferKobo: number; maxOfferKobo: number }[] };
    assert.equal(d.city, 'lagos');
    assert.equal(d.route.estimated, true, 'the stand-in maps provider is labelled');
    assert.equal(d.quotes.length, 4);
    const go = d.quotes.find((q) => q.category === 'go')!;
    assert.ok(go.suggestedKobo >= 120_000 && go.suggestedKobo % 5000 === 0);
    assert.ok(go.minOfferKobo < go.suggestedKobo && go.maxOfferKobo > go.suggestedKobo);
    assert.equal((await call('POST', '/v1/quotes', rider, { pickup: IKEJA, destination: { latitude: 9.05, longitude: 7.49, label: 'Abuja' } })).json().error.code, 'OUT_OF_AREA');
    assert.equal((await call('POST', '/v1/quotes', rider, { pickup: IKEJA, destination: VI, fare: 1 })).statusCode, 422, 'unknown fields are refused');
    const d2 = await person('driver');
    assert.equal((await call('POST', '/v1/quotes', d2, { pickup: IKEJA, destination: VI })).statusCode, 403, 'only riders book');
  });

  test('Quick Match: book, first driver to accept wins, PIN, trip, pay the driver, rate', { skip }, async () => {
    await offline();
    const rider = await person('rider');
    const d1 = await driver();
    const d2 = await driver();
    const far = await driver({ at: { latitude: 6.45, longitude: 3.6 } });
    const keke = await driver({ category: 'keke' });
    const q = await quote(rider);

    // A fare in the request is ignored by design: there is no field for it.
    assert.equal((await call('POST', '/v1/rides', rider, { quoteId: q.id, mode: 'quick_match', fareKobo: 100 })).statusCode, 422);
    assert.equal((await call('POST', '/v1/rides', await person('rider'), { quoteId: q.id, mode: 'quick_match' })).statusCode, 404, 'someone else’s quote');
    const key = randomUUID();
    const booked = await call('POST', '/v1/rides', rider, { quoteId: q.id, mode: 'quick_match' }, { key });
    const ride = ok(booked, 201) as unknown as { id: string; status: string; agreedFareKobo: number; pickupPin: null };
    assert.equal(ride.status, 'searching');
    assert.equal(ride.agreedFareKobo, q.suggestedKobo);
    const again = await call('POST', '/v1/rides', rider, { quoteId: q.id, mode: 'quick_match' }, { key });
    assert.equal(again.headers['idempotent-replayed'], 'true');
    assert.equal(again.json().data.id, ride.id);
    assert.equal((await call('POST', '/v1/rides', rider, { quoteId: q.id, mode: 'quick_match' })).json().error.code, 'OPEN_RIDE');

    const reqs = async (d: string) => (ok(await call('GET', '/v1/drivers/me/requests', d)) as unknown as { requests: { rideId: string; fareKobo: number; rider: object }[] }).requests;
    assert.equal((await reqs(d1)).length, 1);
    assert.deepEqual(Object.keys((await reqs(d1))[0]!.rider).sort(), ['firstName', 'rating'], 'drivers see a first name and rating only');
    assert.equal((await reqs(far)).length, 0, 'too far away');
    assert.equal((await reqs(keke)).length, 0, 'wrong vehicle type');
    assert.equal((await call('POST', `/v1/drivers/me/requests/${ride.id}/accept`, far, {})).statusCode, 404, 'a driver who was not offered the ride cannot take it');

    // Both accept at once: exactly one gets it.
    const [a, b] = await Promise.all([call('POST', `/v1/drivers/me/requests/${ride.id}/accept`, d1, {}), call('POST', `/v1/drivers/me/requests/${ride.id}/accept`, d2, {})]);
    const codes = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(codes, [200, 409], `${a.body} ${b.body}`);
    const winner = a.statusCode === 200 ? d1 : d2;
    const loser = winner === d1 ? d2 : d1;
    assert.equal((await reqs(loser)).length, 0);

    const seen = ok(await call('GET', `/v1/rides/${ride.id}`, rider)) as unknown as { status: string; pickupPin: string; driver: { id: string; firstName: string; vehicle: { plate: string }; location: object; etaSeconds: number; phone?: string } };
    assert.equal(seen.status, 'driver_en_route');
    assert.match(seen.pickupPin, /^\d{4}$/);
    assert.equal(seen.driver.id, winner);
    assert.equal(seen.driver.firstName, 'Tunde');
    assert.ok(seen.driver.location && seen.driver.etaSeconds >= 0);
    assert.equal(JSON.stringify(seen).includes('Bakare'), false, 'no surname');
    assert.equal(JSON.stringify(seen).includes('+234'), false, 'no phone number');
    assert.equal((await call('GET', `/v1/rides/${ride.id}`, await person('rider'))).statusCode, 404, 'another rider');
    assert.equal((await call('GET', `/v1/drivers/me/rides/${ride.id}`, loser)).statusCode, 404, 'another driver');
    const dv = ok(await call('GET', `/v1/drivers/me/rides/current`, winner)) as unknown as { ride: Record<string, unknown> };
    assert.equal('pickupPin' in dv.ride, false, 'the driver never receives the PIN');

    assert.equal((await call('POST', `/v1/drivers/me/rides/${ride.id}/start`, winner, { pin: seen.pickupPin })).statusCode, 409, 'must arrive first');
    await call('PUT', '/v1/drivers/me/location', winner, { latitude: 6.45, longitude: 3.6 });
    assert.equal((await call('POST', `/v1/drivers/me/rides/${ride.id}/arrived`, winner, {})).json().error.code, 'TOO_FAR');
    assert.equal((await call('PUT', '/v1/drivers/me/location', winner, { latitude: IKEJA.latitude, longitude: IKEJA.longitude, heading: 90 })).statusCode, 204);
    ok(await call('POST', `/v1/drivers/me/rides/${ride.id}/arrived`, winner, {}));
    const wrong = seen.pickupPin === '0000' ? '1111' : '0000';
    for (let i = 0; i < 4; i++) assert.equal((await call('POST', `/v1/drivers/me/rides/${ride.id}/start`, winner, { pin: wrong })).json().error.code, 'WRONG_PIN');
    assert.match((await call('POST', `/v1/drivers/me/rides/${ride.id}/start`, winner, { pin: wrong })).json().error.message, /new PIN/);
    assert.equal((await call('POST', `/v1/drivers/me/rides/${ride.id}/start`, winner, { pin: seen.pickupPin })).statusCode, 422, 'the old PIN no longer works after too many tries');
    const fresh = (ok(await call('GET', `/v1/rides/${ride.id}`, rider)) as unknown as { pickupPin: string }).pickupPin;
    assert.notEqual(fresh, seen.pickupPin);
    assert.equal((ok(await call('POST', `/v1/drivers/me/rides/${ride.id}/start`, winner, { pin: fresh })) as unknown as { status: string }).status, 'in_progress');
    assert.equal((await call('POST', `/v1/rides/${ride.id}/cancel`, rider, {})).statusCode, 409, 'not once the trip has started');
    assert.equal((await call('PUT', '/v1/drivers/me/presence', winner, { online: false })).statusCode, 409, 'not while on a trip');

    assert.equal((ok(await call('POST', `/v1/drivers/me/rides/${ride.id}/complete`, winner, {})) as unknown as { status: string }).status, 'payment_pending');
    const q2 = await quote(rider);
    assert.equal((await call('POST', '/v1/rides', rider, { quoteId: q2.id, mode: 'quick_match' })).json().error.code, 'UNPAID_RIDE');

    assert.equal((ok(await call('GET', `/v1/rides/${ride.id}`, rider)) as unknown as { payTo: null }).payTo, null);
    ok(await call('PUT', '/v1/drivers/me/payout-account', winner, { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Tunde Bakare' }));
    assert.equal((ok(await call('GET', `/v1/rides/${ride.id}`, rider)) as unknown as { payTo: { accountNumber: string } }).payTo.accountNumber, '0123456789');
    assert.equal((await call('POST', `/v1/rides/${ride.id}/payment`, rider, { method: 'cash' })).statusCode, 409, 'cash is off');
    assert.equal((await call('POST', `/v1/rides/${ride.id}/payment`, rider, { method: 'wallet' })).json().error.code, 'NOT_CONFIGURED');
    const claimed = ok(await call('POST', `/v1/rides/${ride.id}/payment`, rider, { method: 'transfer' })) as unknown as { status: string; payment: { paidAt: null; claimedAt: string } };
    assert.equal(claimed.status, 'payment_pending', 'a transfer is pending until the driver has it');
    assert.equal(claimed.payment.paidAt, null);
    assert.equal((await call('POST', `/v1/drivers/me/rides/${ride.id}/payment/confirm`, loser, {})).statusCode, 404);
    assert.equal((ok(await call('POST', `/v1/drivers/me/rides/${ride.id}/payment/confirm`, winner, {})) as unknown as { status: string }).status, 'completed');

    ok(await call('POST', `/v1/rides/${ride.id}/rating`, rider, { stars: 4 }));
    assert.equal((await call('POST', `/v1/rides/${ride.id}/rating`, rider, { stars: 5 })).statusCode, 409, 'once only');
    ok(await call('POST', `/v1/drivers/me/rides/${ride.id}/rating`, winner, { stars: 5 }));
    const row = (await tdb.db.query<{ rating: string; completed_trips: number }>(`select rating, completed_trips from app.drivers where user_id = $1`, [winner])).rows[0]!;
    assert.equal(Number(row.rating), 4);
    assert.equal(row.completed_trips, 1);

    const hist = ok(await call('GET', '/v1/rides', rider)) as unknown as { rides: { id: string; status: string }[] };
    assert.equal(hist.rides[0]!.status, 'completed');
    const types = (await tdb.db.query<{ type: string }>(`select type from app.ride_events where ride_id = $1 order by id`, [ride.id])).rows.map((r) => r.type);
    for (const e of ['ride.requested', 'ride.matched', 'ride.driver_arrived', 'ride.pin_wrong', 'ride.started', 'ride.trip_ended', 'ride.payment_claimed', 'ride.paid']) assert.ok(types.includes(e), e);
    const audits = (await tdb.db.query<{ action: string }>(`select action from ops.audit_events where target_type = 'ride' and target_id = $1`, [ride.id])).rows.map((r) => r.action);
    for (const a of ['ride.requested', 'ride.accepted', 'ride.trip_ended', 'ride.payment_claimed', 'ride.payment_confirmed']) assert.ok(audits.includes(a), a);
    const payoutAudit = (await tdb.db.query<{ data: { accountEnding: string } }>(`select data from ops.audit_events where action = 'driver.payout_account_changed' and target_id = $1`, [winner])).rows[0]!;
    assert.deepEqual(Object.keys(payoutAudit.data).sort(), ['accountEnding', 'bankName'], 'the audit never holds the full account number');
  });

  test('Negotiate: offer, counter, raise, choose; the fare locks at the chosen price', { skip }, async () => {
    await offline();
    const rider = await person('rider');
    const d1 = await driver();
    const d2 = await driver();
    const q = await quote(rider);
    assert.equal((await call('POST', '/v1/rides', rider, { quoteId: q.id, mode: 'negotiate' })).statusCode, 422, 'an offer is needed');
    assert.match((await call('POST', '/v1/rides', rider, { quoteId: q.id, mode: 'negotiate', offerKobo: q.minOfferKobo - 5000 })).json().error.details.offerKobo, /at least/);
    const ride = ok(await call('POST', '/v1/rides', rider, { quoteId: q.id, mode: 'negotiate', offerKobo: q.minOfferKobo }), 201) as unknown as { id: string; status: string; offer: { id: string; round: number }; agreedFareKobo: null };
    assert.equal(ride.status, 'negotiating');
    assert.equal(ride.agreedFareKobo, null);

    assert.equal((await call('POST', `/v1/drivers/me/requests/${ride.id}/counter`, d1, { amountKobo: q.minOfferKobo - 5000 })).statusCode, 422, 'below the offer');
    assert.equal((await call('POST', `/v1/drivers/me/requests/${ride.id}/counter`, d1, { amountKobo: q.maxOfferKobo + 5000 })).statusCode, 422, 'above the range');
    ok(await call('POST', `/v1/drivers/me/requests/${ride.id}/counter`, d1, { amountKobo: q.minOfferKobo + 10_000 }));
    const acc = ok(await call('POST', `/v1/drivers/me/requests/${ride.id}/accept`, d2, {})) as unknown as { matched: boolean };
    assert.equal(acc.matched, false, 'accepting an offer is an answer; the rider chooses');
    let v = ok(await call('GET', `/v1/rides/${ride.id}`, rider)) as unknown as { status: string; responses: { id: string; kind: string; amountKobo: number; driver: { id: string } }[] };
    assert.equal(v.status, 'negotiating');
    assert.deepEqual(v.responses.map((r) => r.kind), ['accept', 'counter'], 'cheapest first');

    // Raising the offer makes the earlier answers void.
    assert.match((await call('POST', `/v1/rides/${ride.id}/offers`, rider, { amountKobo: q.minOfferKobo })).json().error.details.amountKobo, /higher/);
    const raised = ok(await call('POST', `/v1/rides/${ride.id}/offers`, rider, { amountKobo: q.minOfferKobo + 5000 })) as unknown as { offer: { round: number }; responses: unknown[] };
    assert.equal(raised.offer.round, 2);
    assert.equal(raised.responses.length, 0);
    assert.equal((await call('POST', `/v1/rides/${ride.id}/select`, rider, { responseId: v.responses[0]!.id })).json().error.code, 'RESPONSE_GONE');

    ok(await call('POST', `/v1/drivers/me/requests/${ride.id}/counter`, d1, { amountKobo: q.minOfferKobo + 15_000 }));
    v = ok(await call('GET', `/v1/rides/${ride.id}`, rider)) as never;
    const pick = v.responses[0]!;
    assert.equal(pick.driver.id, d1);
    const locked = ok(await call('POST', `/v1/rides/${ride.id}/select`, rider, { responseId: pick.id })) as unknown as { status: string; agreedFareKobo: number; driver: { id: string } };
    assert.equal(locked.status, 'driver_en_route');
    assert.equal(locked.agreedFareKobo, q.minOfferKobo + 15_000);
    assert.equal((await call('POST', `/v1/rides/${ride.id}/select`, rider, { responseId: pick.id })).json().error.code, 'ALREADY_LOCKED');
    assert.equal((await call('POST', `/v1/drivers/me/requests/${ride.id}/accept`, d2, {})).json().error.code, 'REQUEST_GONE');

    // The driver cancels: the ride searches again at the agreed fare, and that driver isn't asked again.
    ok(await call('POST', `/v1/drivers/me/rides/${ride.id}/cancel`, d1, { reason: 'Flat tyre' }));
    const back = ok(await call('GET', `/v1/rides/${ride.id}`, rider)) as unknown as { status: string; driver: null; agreedFareKobo: number; pickupPin: null };
    assert.equal(back.status, 'searching');
    assert.equal(back.driver, null);
    assert.equal(back.agreedFareKobo, q.minOfferKobo + 15_000);
    assert.equal(((ok(await call('GET', '/v1/drivers/me/requests', d1)) as unknown as { requests: unknown[] }).requests).length, 0);
    assert.equal((ok(await call('POST', `/v1/drivers/me/requests/${ride.id}/accept`, d2, {})) as unknown as { matched: boolean }).matched, true);
  });

  test('cancelling: free at first, a fee later; a search that runs out ends as "no drivers"', { skip }, async () => {
    await offline();
    const rider = await person('rider');
    const q = await quote(rider);
    const lonely = ok(await call('POST', '/v1/rides', rider, { quoteId: q.id, mode: 'quick_match' }), 201) as unknown as { id: string };
    clock += 121_000;
    assert.equal((ok(await call('GET', `/v1/rides/${lonely.id}`, rider)) as unknown as { status: string }).status, 'no_drivers');
    assert.equal((ok(await call('GET', '/v1/rides/current', rider)) as unknown as { ride: null }).ride, null);

    const d = await driver();
    const r1 = ok(await call('POST', '/v1/rides', rider, { quoteId: (await quote(rider)).id, mode: 'quick_match' }), 201) as unknown as { id: string };
    ok(await call('POST', `/v1/drivers/me/requests/${r1.id}/accept`, d, {}));
    const free = ok(await call('POST', `/v1/rides/${r1.id}/cancel`, rider, { reason: 'Changed my mind' })) as unknown as { status: string; cancelFeeKobo: number };
    assert.equal(free.status, 'cancelled');
    assert.equal(free.cancelFeeKobo, 0);

    const r2 = ok(await call('POST', '/v1/rides', rider, { quoteId: (await quote(rider)).id, mode: 'quick_match' }), 201) as unknown as { id: string };
    ok(await call('POST', `/v1/drivers/me/requests/${r2.id}/accept`, d, {}));
    clock += 200_000;
    const late = ok(await call('POST', `/v1/rides/${r2.id}/cancel`, rider, {})) as unknown as { cancelFeeKobo: number };
    assert.equal(late.cancelFeeKobo, 50_000);
    assert.equal((ok(await call('GET', '/v1/drivers/me/rides/current', d)) as unknown as { ride: null }).ride, null, 'the driver is free again');
  });

  test('only an approved driver can go online; staff see rides within their cities and can stop one', { skip }, async () => {
    await offline();
    const pending = await person('driver');
    assert.equal((await call('PUT', '/v1/drivers/me/presence', pending, { online: true, location: NEAR_IKEJA })).json().error.code, 'DRIVER_NOT_APPROVED');
    assert.equal((await call('PUT', '/v1/drivers/me/location', pending, NEAR_IKEJA)).statusCode, 409);
    const rider = await person('rider');
    assert.equal((await call('GET', '/v1/drivers/me/requests', rider)).statusCode, 403);

    const d = await driver();
    const ride = ok(await call('POST', '/v1/rides', rider, { quoteId: (await quote(rider)).id, mode: 'quick_match' }), 201) as unknown as { id: string };
    ok(await call('POST', `/v1/drivers/me/requests/${ride.id}/accept`, d, {}));

    const ops = await addStaff(tdb.db, { roles: ['operations'], cities: ['lagos'] });
    const abuja = await addStaff(tdb.db, { roles: ['operations'], cities: ['abuja'] });
    const finance = await addStaff(tdb.db, { roles: ['finance'] });
    assert.equal((await call('GET', '/v1/admin/rides', rider)).statusCode, 403, 'not staff');
    assert.equal((await call('GET', '/v1/admin/rides', ops.authUserId)).statusCode, 403, 'staff need their second factor');
    const list = ok(await call('GET', '/v1/admin/rides?status=active', ops.authUserId, undefined, { aal: 'aal2' })) as unknown as { rides: { id: string; riderFirstName: string }[] };
    assert.ok(list.rides.some((r) => r.id === ride.id));
    assert.equal(((ok(await call('GET', '/v1/admin/rides', abuja.authUserId, undefined, { aal: 'aal2' })) as unknown as { rides: unknown[] }).rides).length, 0, 'another city');
    assert.equal((await call('GET', `/v1/admin/rides/${ride.id}`, abuja.authUserId, undefined, { aal: 'aal2' })).statusCode, 403);
    const one = ok(await call('GET', `/v1/admin/rides/${ride.id}`, ops.authUserId, undefined, { aal: 'aal2' })) as unknown as { pickupPin: null; events: { type: string }[] };
    assert.equal(one.pickupPin, null, 'staff don’t see the PIN');
    assert.ok(one.events.length >= 2);
    assert.equal((await call('POST', `/v1/admin/rides/${ride.id}/cancel`, finance.authUserId, { reason: 'Testing access' }, { aal: 'aal2' })).statusCode, 403, 'viewing is not intervening');
    assert.equal((await call('POST', `/v1/admin/rides/${ride.id}/cancel`, ops.authUserId, { reason: 'x' }, { aal: 'aal2' })).statusCode, 422, 'a real reason');
    assert.equal((ok(await call('POST', `/v1/admin/rides/${ride.id}/cancel`, ops.authUserId, { reason: 'Rider reported the wrong car' }, { aal: 'aal2' })) as unknown as { status: string }).status, 'cancelled');
  });
});
