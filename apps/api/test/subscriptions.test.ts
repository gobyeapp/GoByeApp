import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PASS_DURATION_MS, PASS_PRICE, subscriptionTimelineResponse, type PassPayment } from '@gobye/core';
import { loadState, recordVerifiedPayment, recordVoid } from '../src/subscriptions/subscriptions.repository';
import { addStaff, addUser, bearer, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 20, 9); // 20 Oct 2026, 10:00 Lagos
const pay = (driverId: string, ref: string, plan: 'daily' | 'monthly', at: number): PassPayment => ({ paymentRef: ref, driverId, plan, amount: PASS_PRICE[plan], confirmedAt: at });

/** D-058 pass timeline stored in PostgreSQL and served by GET /v1/drivers/{id}/subscription. */
describe('driver pass timeline', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let keys: Keys;
  let t: TestApp;
  const now = () => T0 + 2 * H;
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    keys = await makeKeys();
    t = await makeApp({ db: tdb.db, keys, now });
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await tdb.drop();
  });

  test('a pass bought while one is active queues after it (no overlap, no lost time)', { skip }, async () => {
    const d = await addUser(tdb.db, { driver: { city: 'lagos' } });
    await recordVerifiedPayment(tdb.db, pay(d, 'PSK-daily-0001', 'daily', T0));
    const r = await recordVerifiedPayment(tdb.db, pay(d, 'PSK-month-0002', 'monthly', T0 + H));
    assert.ok(r.ok);
    const s = (await loadState(tdb.db, d))!;
    assert.equal(s.version, 2);
    assert.equal(s.passes[1]!.startsAt, T0 + PASS_DURATION_MS.daily, 'monthly starts when the daily ends');
    assert.equal(s.passes[1]!.endsAt, T0 + PASS_DURATION_MS.daily + PASS_DURATION_MS.monthly);
    assert.equal(s.passes[1]!.confirmedAt, T0 + H, 'confirmation stored separately from start');
  });

  test('a duplicate webhook for the same payment adds no time', { skip }, async () => {
    const d = await addUser(tdb.db, { driver: { city: 'lagos' } });
    await recordVerifiedPayment(tdb.db, pay(d, 'PSK-dup-0001', 'daily', T0));
    const again = await recordVerifiedPayment(tdb.db, pay(d, 'PSK-dup-0001', 'daily', T0));
    assert.ok(again.ok && again.duplicate);
    const s = (await loadState(tdb.db, d))!;
    assert.equal(s.payments.length, 1);
    assert.equal(s.version, 1);
  });

  test('simultaneous payments for one driver are serialised by the row lock and never overlap', { skip }, async () => {
    const d = await addUser(tdb.db, { driver: { city: 'abuja' } });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => recordVerifiedPayment(tdb.db, pay(d, `PSK-sim-${String(i).padStart(4, '0')}`, 'daily', T0 + i * 1000))));
    assert.ok(results.every((r) => r.ok));
    const s = (await loadState(tdb.db, d))!;
    assert.equal(s.version, 6);
    const passes = [...s.passes].sort((a, b) => a.startsAt - b.startsAt);
    for (let i = 1; i < passes.length; i++) assert.equal(passes[i]!.startsAt, passes[i - 1]!.endsAt);
    assert.equal(passes.at(-1)!.endsAt - passes[0]!.startsAt, 6 * PASS_DURATION_MS.daily, 'six days of access, nothing lost');
  });

  test('a payment reference already used by another driver is refused, not a server error', { skip }, async () => {
    const a = await addUser(tdb.db, { driver: { city: 'lagos' } });
    const b = await addUser(tdb.db, { driver: { city: 'lagos' } });
    await recordVerifiedPayment(tdb.db, pay(a, 'PSK-shared-0001', 'daily', T0));
    const r = await recordVerifiedPayment(tdb.db, pay(b, 'PSK-shared-0001', 'daily', T0));
    assert.deepEqual(r.ok ? null : r.error, 'wrong_driver');
    assert.equal((await loadState(tdb.db, b))!.payments.length, 0);
  });

  test('the wrong amount for a plan is refused', { skip }, async () => {
    const d = await addUser(tdb.db, { driver: { city: 'lagos' } });
    const r = await recordVerifiedPayment(tdb.db, { ...pay(d, 'PSK-bad-0001', 'monthly', T0), amount: PASS_PRICE.daily });
    assert.equal(r.ok, false);
    assert.equal((await loadState(tdb.db, d))!.payments.length, 0);
  });

  test('a refund keeps history, never extends access, and later passes move up', { skip }, async () => {
    const d = await addUser(tdb.db, { driver: { city: 'lagos' } });
    await recordVerifiedPayment(tdb.db, pay(d, 'PSK-ref-0001', 'daily', T0));
    await recordVerifiedPayment(tdb.db, pay(d, 'PSK-ref-0002', 'daily', T0 + 60_000));
    const v = await recordVoid(tdb.db, d, { paymentRef: 'PSK-ref-0001', kind: 'refunded', at: T0 + 2 * H, reason: 'Bought by mistake', by: 'finance:test' });
    assert.ok(v.ok);
    const s = (await loadState(tdb.db, d))!;
    assert.equal(s.payments.length, 2, 'nothing deleted');
    const refunded = s.passes.find((p) => p.paymentRef === 'PSK-ref-0001')!;
    assert.equal(refunded.accessEndsAt, T0 + 2 * H);
    assert.equal(s.passes.find((p) => p.paymentRef === 'PSK-ref-0002')!.startsAt, T0 + 2 * H, 'queued pass moves up');
    await assert.rejects(tdb.db.query(`delete from app.driver_pass_payments where payment_ref = 'PSK-ref-0001'`), /append-only/);
    const twice = await recordVoid(tdb.db, d, { paymentRef: 'PSK-ref-0001', kind: 'refunded', at: T0 + 3 * H, reason: 'again', by: 'finance:test' });
    assert.ok(twice.ok && twice.duplicate);
  });

  test('the driver and the admin get the same response, equal to the core calculation', { skip }, async () => {
    const d = await addUser(tdb.db, { driver: { city: 'lagos' } });
    await recordVerifiedPayment(tdb.db, pay(d, 'PSK-api-0001', 'daily', T0));
    await recordVerifiedPayment(tdb.db, pay(d, 'PSK-api-0002', 'monthly', T0 + H));
    const expected = subscriptionTimelineResponse((await loadState(tdb.db, d))!, now());
    const mine = await t.inject({ method: 'GET', url: `/v1/drivers/${d}/subscription`, headers: bearer(await keys.token({ sub: d })) });
    assert.equal(mine.statusCode, 200);
    assert.deepEqual(mine.json().data, JSON.parse(JSON.stringify(expected)));
    assert.equal(mine.json().data.access.canAcceptRides, true);
    assert.equal(mine.json().data.summary.scheduled, 1);

    const ops = await addStaff(tdb.db, { roles: ['operations'], cities: ['lagos'] });
    const staff = await t.inject({ method: 'GET', url: `/v1/drivers/${d}/subscription`, headers: bearer(await keys.token({ sub: ops.authUserId, aal: 'aal2' })) });
    assert.equal(staff.statusCode, 200);
    assert.deepEqual(staff.json().data, mine.json().data);
  });

  test('other people cannot read a driver timeline; staff only within their cities', { skip }, async () => {
    const d = await addUser(tdb.db, { driver: { city: 'lagos' } });
    const other = await addUser(tdb.db, { driver: { city: 'lagos' } });
    const r = await t.inject({ method: 'GET', url: `/v1/drivers/${d}/subscription`, headers: bearer(await keys.token({ sub: other })) });
    assert.equal(r.statusCode, 404, 'no hint that the driver exists');
    const abujaOps = await addStaff(tdb.db, { roles: ['operations'], cities: ['abuja'] });
    const s = await t.inject({ method: 'GET', url: `/v1/drivers/${d}/subscription`, headers: bearer(await keys.token({ sub: abujaOps.authUserId, aal: 'aal2' })) });
    assert.equal(s.statusCode, 403);
    const bad = await t.inject({ method: 'GET', url: `/v1/drivers/not-a-uuid/subscription`, headers: bearer(await keys.token({ sub: d })) });
    assert.equal(bad.statusCode, 422);
    assert.ok(bad.json().error.details.driverId);
  });
});
