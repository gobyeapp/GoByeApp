import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PASS_PRICE } from '@gobye/core';
import { recordVerifiedPayment, recordVoid } from '../src/subscriptions/subscriptions.repository';
import { addStaff, addUser, bearer, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';

/** Operating costs (D-057): validation, idempotency, permissions, audit, break-even without marketing. */
describe('operating costs and break-even', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let keys: Keys;
  let t: TestApp;
  let finance: { authUserId: string; staffId: string };
  let approver: { authUserId: string; staffId: string };
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    keys = await makeKeys();
    t = await makeApp({ db: tdb.db, keys });
    finance = await addStaff(tdb.db, { roles: ['finance'] });
    approver = await addStaff(tdb.db, { roles: ['owner'] });
    await tdb.db.query(`insert into app.vendors (id, name, category, status, currency) values ('ads-co', 'Ads Co', 'marketing', 'active_paid', 'NGN')`);
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await tdb.drop();
  });

  const body = (o: Record<string, unknown> = {}) => ({ vendorId: 'supabase', description: 'Pro plan October', amountKobo: 4_000_000, month: '2026-10', incurredAt: '2026-10-05T09:00:00+01:00', ...o });
  const post = async (payload: object, key: string | null, sub = finance.authUserId, aal = 'aal2') =>
    t.inject({ method: 'POST', url: '/v1/costs/expenses', headers: { ...bearer(await keys.token({ sub, aal })), ...(key ? { 'idempotency-key': key } : {}) }, payload });

  test('needs costs.manage with MFA', { skip }, async () => {
    const care = await addStaff(tdb.db, { roles: ['care'] });
    assert.equal((await post(body(), randomUUID(), care.authUserId)).statusCode, 403);
    assert.equal((await post(body(), randomUUID(), finance.authUserId, 'aal1')).json().error.code, 'MFA_REQUIRED');
    assert.equal((await post(body(), randomUUID(), randomUUID())).statusCode, 403, 'a non-staff user');
  });

  test('every field is validated, with details per field; unknown fields are refused', { skip }, async () => {
    const r = await post({ vendorId: 'NO', description: 'x', amountKobo: 1.5, month: '2026-13', incurredAt: 'yesterday', extra: true }, randomUUID());
    assert.equal(r.statusCode, 422);
    const d = r.json().error.details;
    for (const f of ['vendorId', 'description', 'amountKobo', 'month', 'incurredAt']) assert.ok(d[f], `details for ${f}`);
    assert.ok(d._ ?? Object.keys(d).some((k) => k === '_'), 'unknown key reported');
    const unknownVendor = await post(body({ vendorId: 'no-such-vendor' }), randomUUID());
    assert.equal(unknownVendor.statusCode, 422);
    assert.ok(unknownVendor.json().error.details.vendorId);
  });

  test('Idempotency-Key is required and well formed', { skip }, async () => {
    assert.equal((await post(body(), null)).json().error.details['Idempotency-Key'], 'Required for this request.');
    assert.equal((await post(body(), 'short')).statusCode, 422);
  });

  test('a retry with the same key replays the first result; a different body is a conflict', { skip }, async () => {
    const key = randomUUID();
    const first = await post(body(), key);
    assert.equal(first.statusCode, 201);
    const again = await post(body(), key);
    assert.equal(again.statusCode, 201);
    assert.equal(again.headers['idempotent-replayed'], 'true');
    assert.deepEqual(again.json().data, first.json().data);
    const clash = await post(body({ amountKobo: 1 }), key);
    assert.equal(clash.statusCode, 409);
    assert.equal(clash.json().error.code, 'idempotency_conflict');
    const rows = await tdb.db.query(`select count(*)::int as n from app.operating_expenses where id = $1`, [first.json().data.id]);
    assert.equal(rows.rows[0]!.n, 1);
    const audit = await tdb.db.query(`select action, actor_kind from ops.audit_events where target_id = $1`, [first.json().data.id]);
    assert.deepEqual(audit.rows, [{ action: 'costs.expense_recorded', actor_kind: 'staff' }], 'one audit entry, written with the change');
  });

  test('ten concurrent retries of one request create one expense', { skip }, async () => {
    const key = randomUUID();
    const rs = await Promise.all(Array.from({ length: 10 }, () => post(body({ description: 'Concurrent retry check' }), key)));
    assert.ok(rs.every((r) => r.statusCode === 201));
    assert.equal(new Set(rs.map((r) => r.json().data.id)).size, 1);
    const n = await tdb.db.query(`select count(*)::int as n from app.operating_expenses where description = 'Concurrent retry check'`);
    assert.equal(n.rows[0]!.n, 1);
  });

  test('break-even counts approved operating costs only, excludes marketing, and nets refunded passes', { skip }, async () => {
    const month = '2026-09';
    const add = async (vendorId: string, amountKobo: number, approve: boolean) => {
      const r = await post(body({ vendorId, amountKobo, month, incurredAt: '2026-09-10T10:00:00+01:00' }), randomUUID());
      if (approve) await tdb.db.query(`update app.operating_expenses set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [r.json().data.id, approver.staffId]);
    };
    await add('supabase', 4_000_000, true); // ₦40,000
    await add('vercel', 3_000_000, true); // ₦30,000
    await add('ads-co', 50_000_000, true); // ₦500,000 marketing: excluded
    await add('stackshift', 1_000_000, false); // pending: not counted

    const d = await addUser(tdb.db, { driver: { city: 'lagos' } });
    const sep = Date.UTC(2026, 8, 15, 9);
    await recordVerifiedPayment(tdb.db, { paymentRef: 'PSK-be-0001', driverId: d, plan: 'monthly', amount: PASS_PRICE.monthly, confirmedAt: sep });
    await recordVerifiedPayment(tdb.db, { paymentRef: 'PSK-be-0002', driverId: d, plan: 'daily', amount: PASS_PRICE.daily, confirmedAt: sep + 1000 });
    await recordVoid(tdb.db, d, { paymentRef: 'PSK-be-0002', kind: 'refunded', at: sep + 2000, reason: 'Duplicate', by: 'finance:test' });
    // 30 Sep 23:30 UTC is 1 Oct 00:30 in Lagos: belongs to October, not September.
    await recordVerifiedPayment(tdb.db, { paymentRef: 'PSK-be-0003', driverId: d, plan: 'daily', amount: PASS_PRICE.daily, confirmedAt: Date.UTC(2026, 8, 30, 23, 30) });

    const r = await t.inject({ method: 'GET', url: `/v1/costs/break-even?month=${month}`, headers: bearer(await keys.token({ sub: finance.authUserId, aal: 'aal2' })) });
    assert.equal(r.statusCode, 200);
    const b = r.json().data;
    assert.equal(b.operatingCost, 7_000_000);
    assert.equal(b.subscriptionRevenue, PASS_PRICE.monthly);
    assert.equal(b.passesSold, 1);
    assert.equal(b.excluded.marketingCostKobo, 50_000_000);
    assert.equal(b.excluded.pendingApprovalKobo, 1_000_000);
    // ₦60,000 revenue against ₦70,000 costs: not yet covered, ₦10,000 short, two monthly passes needed.
    assert.ok(Math.abs(b.coverage - 6 / 7) < 1e-9);
    assert.equal(b.gap, 1_000_000);
    assert.equal(b.monthlyPassesNeeded, 2);
    assert.equal(b.dailyPassesNeeded, 35);
  });
});
