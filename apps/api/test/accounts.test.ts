import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CURRENT_CONSENTS, consentsNeeded, deletionDueAt, invalidConsents, isNigerianPhone, toE164 } from '@gobye/core';
import { accountHandlers } from '../src/me/deletion.job';
import type { Job } from '../src/jobs/queue';
import { addStaff, bearer, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';

const consents = [
  { document: 'terms', version: CURRENT_CONSENTS.terms },
  { document: 'privacy', version: CURRENT_CONSENTS.privacy },
];

describe('account rules (core)', () => {
  test('Nigerian mobile numbers only, Supabase format accepted', () => {
    assert.equal(toE164('2348031234567'), '+2348031234567');
    assert.ok(isNigerianPhone('+2348031234567'));
    assert.ok(isNigerianPhone('+2349061234567'));
    assert.ok(!isNigerianPhone('+447700900123'));
    assert.ok(!isNigerianPhone('+23480312345'));
    assert.ok(!isNigerianPhone(null));
  });
  test('consent versions', () => {
    assert.deepEqual(consentsNeeded([]).map((c) => c.document), ['terms', 'privacy']);
    assert.deepEqual(consentsNeeded([{ document: 'terms', version: CURRENT_CONSENTS.terms }, { document: 'privacy', version: 'old' }]), [{ document: 'privacy', version: CURRENT_CONSENTS.privacy }]);
    assert.deepEqual(invalidConsents([{ document: 'terms', version: 'old' }]), ['terms@old']);
  });
  test('deletion grace period is 14 days', () => {
    assert.equal(deletionDueAt(0), 14 * 86_400_000);
  });
});

/** Backend Phase 2, WP1: profiles, roles, consents, devices and deletion. */
describe('accounts API', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let keys: Keys;
  let t: TestApp;
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    keys = await makeKeys();
    t = await makeApp({ db: tdb.db, keys });
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await tdb.drop();
  });

  const tok = (sub: string, o: { phone?: string | null; email?: string } = {}) =>
    keys.token({ sub, phone: o.phone === undefined ? '2348031234567' : o.phone ?? '', email: o.email ?? `${sub.slice(0, 8)}@example.com` });
  const call = async (method: 'POST' | 'PATCH' | 'DELETE' | 'GET', url: string, sub: string, payload?: object, o: { key?: string | null; phone?: string | null } = {}) =>
    t.inject({
      method,
      url,
      headers: { ...bearer(await tok(sub, { phone: o.phone })), ...(o.key === null ? {} : { 'idempotency-key': o.key ?? randomUUID() }) },
      ...(payload ? { payload } : {}),
    });
  const phoneFor = () => `234803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

  test('a person downloads their own data (NDPA access, D-083), audited, without internal details', { skip }, async () => {
    const sub = randomUUID();
    const r = await call('POST', '/v1/me/profile', sub, { role: 'driver', fullName: 'Bola Ade', city: 'abuja', consents, device: { installId: 'install_export_01', platform: 'ios' } }, { phone: phoneFor() });
    assert.equal(r.statusCode, 201, r.body);
    const other = randomUUID();
    await call('POST', '/v1/me/profile', other, { role: 'rider', fullName: 'Someone Else', consents }, { phone: phoneFor() });

    const ex = await call('GET', '/v1/me/export', sub, undefined, { key: null });
    assert.equal(ex.statusCode, 200, ex.body);
    assert.match(String(ex.headers['content-disposition']), /attachment; filename="gobye-my-data-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(ex.headers['cache-control'], 'no-store');
    const d = ex.json().data;
    assert.equal(d.format, 'gobye-personal-data-v1');
    assert.equal(d.profile.full_name, 'Bola Ade');
    assert.equal(d.driver.city, 'abuja');
    assert.equal(d.rider, null);
    assert.equal(d.consents.length, 2);
    assert.equal(d.consents[0].ip_hash, undefined, 'internal hash left out');
    assert.equal(d.devices[0].install_id, 'install_export_01');
    assert.ok(!JSON.stringify(d).includes('Someone Else'), 'nobody else’s data');
    const audit = await tdb.db.query(`select action from ops.audit_events where target_id = $1 and action = 'account.export'`, [sub]);
    assert.equal(audit.rowCount, 1);
    assert.equal((await t.inject({ method: 'GET', url: '/v1/me/export' })).statusCode, 401);
  });

  test('signs up a rider, records consent and device, and /v1/me shows it', { skip }, async () => {
    const sub = randomUUID();
    const r = await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Ada Obi', consents, device: { installId: 'install_rider_0001', platform: 'android', appVersion: '0.1.0' } }, { phone: phoneFor() });
    assert.equal(r.statusCode, 201, r.body);
    const me = r.json().data;
    assert.equal(me.signupComplete, true);
    assert.equal(me.fullName, 'Ada Obi');
    assert.equal(me.rider, true);
    assert.deepEqual(me.consentsNeeded, []);
    const dev = await call('POST', '/v1/me/devices', sub, { installId: 'install_rider_0001', platform: 'android' });
    assert.equal(dev.json().data.verificationRequired, false, 'the sign-up device is verified');
    const other = await call('POST', '/v1/me/devices', sub, { installId: 'install_rider_0002', platform: 'ios' });
    assert.equal(other.json().data.verificationRequired, true, 'a new device needs a phone code');
    const audit = await tdb.db.query(`select action from ops.audit_events where target_id = $1 order by id`, [sub]);
    assert.deepEqual(audit.rows.map((x) => x.action), ['account.created']);
  });

  test('a driver needs a city; then gets a driver record awaiting verification', { skip }, async () => {
    const sub = randomUUID();
    const bad = await call('POST', '/v1/me/profile', sub, { role: 'driver', fullName: 'Tunde Ade', consents }, { phone: phoneFor() });
    assert.equal(bad.statusCode, 422);
    const ok = await call('POST', '/v1/me/profile', sub, { role: 'driver', fullName: 'Tunde Ade', city: 'abuja', consents }, { phone: phoneFor() });
    assert.equal(ok.statusCode, 201, ok.body);
    assert.deepEqual(ok.json().data.driver, { city: 'abuja', verification: 'not_started' });
  });

  test('refuses without a confirmed Nigerian phone, with old consents, and twice', { skip }, async () => {
    const sub = randomUUID();
    assert.equal((await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'No Phone', consents }, { phone: null })).statusCode, 422);
    assert.equal((await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Uk Phone', consents }, { phone: '447700900123' })).statusCode, 422);
    assert.equal((await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Old Terms', consents: [{ document: 'terms', version: 'v0' }] }, { phone: phoneFor() })).statusCode, 422);
    const phone = phoneFor();
    assert.equal((await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Ada Obi', consents }, { phone })).statusCode, 201);
    assert.equal((await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Ada Obi', consents }, { phone })).statusCode, 409);
    const another = randomUUID();
    assert.equal((await call('POST', '/v1/me/profile', another, { role: 'rider', fullName: 'Same Phone', consents }, { phone })).statusCode, 409, 'one account per phone');
  });

  test('needs an Idempotency-Key, and replays the same request', { skip }, async () => {
    const sub = randomUUID();
    const phone = phoneFor();
    assert.equal((await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Key Less', consents }, { key: null, phone })).statusCode, 422);
    const key = randomUUID();
    const a = await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Ada Obi', consents }, { key, phone });
    const b = await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Ada Obi', consents }, { key, phone });
    assert.equal(a.statusCode, 201);
    assert.equal(b.statusCode, 201);
    assert.equal(b.headers['idempotent-replayed'], 'true');
    const c = await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Someone Else', consents }, { key, phone });
    assert.equal(c.statusCode, 409, 'same key, different body');
  });

  test('renames, adds the driver role, and rejects unknown fields', { skip }, async () => {
    const sub = randomUUID();
    await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Ada Obi', consents }, { phone: phoneFor() });
    assert.equal((await call('PATCH', '/v1/me/profile', sub, { fullName: 'Ada N. Obi', phone: '+2340000000000' })).statusCode, 422, 'phone changes go through Supabase');
    const ren = await call('PATCH', '/v1/me/profile', sub, { fullName: 'Ada N. Obi' });
    assert.equal(ren.statusCode, 200);
    const role = await call('POST', '/v1/me/roles', sub, { role: 'driver', city: 'lagos' });
    assert.equal(role.statusCode, 201, role.body);
    assert.equal(role.json().data.rider, true);
    assert.equal(role.json().data.driver.city, 'lagos');
    assert.equal((await call('POST', '/v1/me/roles', sub, { role: 'rider' })).statusCode, 409);
    const name = await tdb.db.query(`select full_name from app.users where id = $1`, [sub]);
    assert.equal(name.rows[0].full_name, 'Ada N. Obi');
  });

  test('routes other than sign-up need a finished profile', { skip }, async () => {
    const sub = randomUUID();
    assert.equal((await call('PATCH', '/v1/me/profile', sub, { fullName: 'Ada Obi' })).statusCode, 403);
    assert.equal((await call('DELETE', '/v1/me', sub)).statusCode, 403);
    const me = await t.inject({ method: 'GET', url: '/v1/me', headers: bearer(await tok(sub)) });
    assert.equal(me.json().data.signupComplete, false);
    assert.equal(me.json().data.fullName, null);
    assert.equal(me.json().data.phoneConfirmed, true);
  });

  test('deletion: schedule, cancel, schedule again, then the job anonymises the person', { skip }, async () => {
    const sub = randomUUID();
    await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'Leaving Soon', consents, device: { installId: 'install_leave_0001', platform: 'ios' } }, { phone: phoneFor() });
    const del = await call('DELETE', '/v1/me', sub);
    assert.equal(del.statusCode, 202, del.body);
    assert.equal(del.json().data.status, 'scheduled');
    const me = await t.inject({ method: 'GET', url: '/v1/me', headers: bearer(await tok(sub)) });
    assert.equal(me.json().data.deletion.status, 'scheduled');
    assert.equal((await call('POST', '/v1/me/deletion/cancel', sub, {})).statusCode, 200);
    assert.equal((await call('POST', '/v1/me/deletion/cancel', sub, {})).statusCode, 404);
    assert.equal((await call('DELETE', '/v1/me', sub)).statusCode, 202);
    const jobs = await tdb.db.query(`select kind from ops.jobs where payload->>'userId' = $1`, [sub]);
    assert.ok(jobs.rows.every((j) => j.kind === 'account.delete') && jobs.rows.length >= 1);

    // Pretend the grace period is over, then run the job (with a fake Supabase admin API).
    await tdb.db.query(`update app.account_deletions set requested_at = now() - interval '15 days', scheduled_for = now() - interval '1 day' where user_id = $1`, [sub]);
    const calls: string[] = [];
    const handler = accountHandlers({ config: { ...t.config, SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests' }, fetch: async (url, init) => (calls.push(`${init.method} ${url}`), { ok: true, status: 200 }) })['account.delete']!;
    const job = { id: '1', kind: 'account.delete', payload: { userId: sub }, idempotency_key: 'k', attempts: 1, max_attempts: 5 } as Job;
    const out = await handler(job, tdb.db, new AbortController().signal);
    assert.deepEqual(out, { ok: true, result: { anonymised: true, authUserDeleted: true } });
    assert.deepEqual(calls, [`DELETE https://test-project.supabase.co/auth/v1/admin/users/${sub}`]);
    const u = (await tdb.db.query(`select full_name, email, phone, status from app.users where id = $1`, [sub])).rows[0];
    assert.deepEqual(u, { full_name: 'Deleted user', email: null, phone: null, status: 'deleted' });
    assert.equal((await tdb.db.query(`select count(*)::int as n from app.devices where user_id = $1`, [sub])).rows[0].n, 0);
    assert.equal((await tdb.db.query(`select count(*)::int as n from app.consents where user_id = $1`, [sub])).rows[0].n, 2, 'consent records are kept');
    const again = await handler(job, tdb.db, new AbortController().signal);
    assert.deepEqual(again, { ok: true, result: { skipped: 'already completed' } }, 'running twice changes nothing');
    const after = await t.inject({ method: 'GET', url: '/v1/me', headers: bearer(await tok(sub)) });
    assert.equal(after.statusCode, 403, 'a deleted account cannot sign back in to its data');
  });

  test('without the service-role key, our data is still anonymised and the gap is recorded', { skip }, async () => {
    const sub = randomUUID();
    await call('POST', '/v1/me/profile', sub, { role: 'rider', fullName: 'No Key', consents }, { phone: phoneFor() });
    await call('DELETE', '/v1/me', sub);
    await tdb.db.query(`update app.account_deletions set requested_at = now() - interval '15 days', scheduled_for = now() - interval '1 day' where user_id = $1`, [sub]);
    const out = await accountHandlers({ config: t.config })['account.delete']!({ id: '2', kind: 'account.delete', payload: { userId: sub }, idempotency_key: 'k2', attempts: 1, max_attempts: 5 } as Job, tdb.db, new AbortController().signal);
    assert.deepEqual(out, { ok: true, result: { anonymised: true, authUserDeleted: false } });
    const d = (await tdb.db.query(`select status, auth_user_deleted from app.account_deletions where user_id = $1`, [sub])).rows[0];
    assert.deepEqual(d, { status: 'completed', auth_user_deleted: false });
  });

  test('the stakeholder staff role is accepted by the database (D-068)', { skip }, async () => {
    const s = await addStaff(tdb.db, { roles: ['stakeholder'] });
    assert.ok(s.staffId);
  });
});
