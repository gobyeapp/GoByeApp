import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CURRENT_CONSENTS } from '@gobye/core';
import { addStaff, bearer, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';

const consents = [
  { document: 'terms', version: CURRENT_CONSENTS.terms },
  { document: 'privacy', version: CURRENT_CONSENTS.privacy },
];

/** Backend Phase 2, WP3: the driver application and staff review. */
describe('driver applications API', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let keys: Keys;
  let t: TestApp;
  let lagos: { authUserId: string; staffId: string };
  let abuja: { authUserId: string; staffId: string };
  let viewer: { authUserId: string; staffId: string };
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    keys = await makeKeys();
    t = await makeApp({ db: tdb.db, keys });
    lagos = await addStaff(tdb.db, { roles: ['onboarding'], cities: ['lagos'] });
    abuja = await addStaff(tdb.db, { roles: ['onboarding'], cities: ['abuja'] });
    viewer = await addStaff(tdb.db, { roles: ['operations'] });
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await tdb.drop();
  });

  const phone = () => `234803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const req = async (method: 'GET' | 'PUT' | 'POST', url: string, sub: string, o: { payload?: object; version?: number | string; aal?: string; key?: string } = {}) =>
    t.inject({
      method,
      url,
      headers: {
        ...bearer(await keys.token({ sub, aal: o.aal ?? 'aal1', phone: '2348031234567' })),
        ...(method === 'GET' ? {} : { 'idempotency-key': o.key ?? randomUUID() }),
        ...(o.version !== undefined ? { 'if-match': `"${o.version}"` } : {}),
      },
      ...(o.payload ? { payload: o.payload } : {}),
    });
  const staff = (method: 'GET' | 'POST', url: string, who: { authUserId: string }, payload?: object) => req(method, url, who.authUserId, { payload, aal: 'aal2' });

  async function newDriver(city: 'lagos' | 'abuja' = 'lagos') {
    const sub = randomUUID();
    const r = await t.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { ...bearer(await keys.token({ sub, phone: phone() })), 'idempotency-key': randomUUID() },
      payload: { role: 'driver', fullName: 'Tunde Bakare', city, consents },
    });
    assert.equal(r.statusCode, 201, r.body);
    return sub;
  }

  async function file(owner: string, cls: string, status = 'uploaded') {
    const r = await tdb.db.query<{ id: string }>(
      `insert into ops.files (owner_id, file_class, access_class, bucket, object_key, status, scan_status, claimed_mime, declared_size, sha256, retention_policy, upload_expires_at)
       values ($1, $2, 'private', 'documents', $3, $4, $5, 'image/jpeg', 1000, $6, 'driver_documents', now() + interval '1 hour') returning id`,
      [owner, cls, `k/${randomUUID()}`, status, status === 'approved' ? 'clean' : 'pending', 'a'.repeat(64)],
    );
    return r.rows[0]!.id;
  }

  /** Fill every step; returns the version and the file ids. */
  async function fill(sub: string) {
    const files = {
      licence: await file(sub, 'driver_licence'),
      selfie: await file(sub, 'identity_document'),
      registration: await file(sub, 'vehicle_document'),
      insurance: await file(sub, 'vehicle_document'),
      roadworthiness: await file(sub, 'vehicle_document'),
    };
    let v = 0;
    const put = async (step: string, payload: object) => {
      const r = await req('PUT', `/v1/drivers/me/application/steps/${step}`, sub, { payload, version: v });
      assert.equal(r.statusCode, 200, r.body);
      v = r.json().data.version;
      return r;
    };
    await put('personal', { firstName: 'Tunde', lastName: 'Bakare' });
    await put('licence', { number: 'abc 123456789', expiry: '2031-05-01', photoFileId: files.licence });
    await put('identity', { type: 'nin', number: '12345678901', selfieFileId: files.selfie });
    await put('vehicle', { category: 'go', make: 'Toyota', model: 'Corolla', year: 2016, colour: 'Silver', plate: `KJA${String(Math.floor(Math.random() * 900) + 100)}AB` });
    const last = await put('documents', { registration: files.registration, insurance: files.insurance, roadworthiness: files.roadworthiness });
    return { version: v, files, last };
  }

  const approveFiles = (ids: string[]) => tdb.db.query(`update ops.files set status = 'approved', scan_status = 'clean' where id = any($1::uuid[])`, [ids]);

  test('a driver fills the steps with core validation, versions and file checks', { skip }, async () => {
    const sub = await newDriver();
    const first = await req('GET', '/v1/drivers/me/application', sub);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().data.version, 0);
    assert.equal(first.json().data.summary.stage, 'register');

    assert.equal((await req('PUT', '/v1/drivers/me/application/steps/personal', sub, { payload: { firstName: 'T', lastName: 'B' } })).statusCode, 422, 'If-Match is required');
    const badPlate = await req('PUT', '/v1/drivers/me/application/steps/vehicle', sub, { payload: { category: 'go', make: 'Toyota', model: 'Corolla', year: 2001, colour: 'Red', plate: 'KJA123AB' }, version: 0 });
    assert.equal(badPlate.statusCode, 422);
    assert.match(badPlate.json().error.details.year, /2008/);

    const other = await file(randomUUID(), 'driver_licence');
    const stolen = await req('PUT', '/v1/drivers/me/application/steps/licence', sub, { payload: { number: 'ABC123456789', expiry: '2031-01-01', photoFileId: other }, version: 0 });
    assert.equal(stolen.statusCode, 422, 'someone else’s file');

    const { version, last } = await fill(sub);
    assert.equal(version, 5);
    const body = last.json().data;
    assert.equal(body.status, 'in_progress');
    assert.equal(body.application.licence.number, 'ABC123456789');
    assert.equal(body.application.personal.city, 'Lagos');
    assert.ok(body.files.every((f: { state: string }) => f.state === 'checking'));
    assert.equal(last.headers.etag, '"5"');

    const stale = await req('PUT', '/v1/drivers/me/application/steps/personal', sub, { payload: { firstName: 'Tunde', lastName: 'B' }, version: 3 });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, 'VERSION_CONFLICT');

    const audit = await tdb.db.query(`select count(*)::int as n from ops.audit_events where target_type = 'driver_application' and target_id = $1`, [sub]);
    assert.equal(audit.rows[0].n, 5);
  });

  test('submitting waits for the scanner; staff see it only in their cities', { skip }, async () => {
    const sub = await newDriver();
    const { version, files } = await fill(sub);
    const early = await req('POST', '/v1/drivers/me/application/submit', sub, { payload: {}, version });
    assert.equal(early.statusCode, 409);
    assert.equal(early.json().error.code, 'DOCUMENTS_NOT_READY');

    await approveFiles(Object.values(files));
    const sent = await req('POST', '/v1/drivers/me/application/submit', sub, { payload: {}, version });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal(sent.json().data.status, 'pending_review');
    assert.equal(sent.json().data.summary.checks.length, 5);
    const d = await tdb.db.query(`select verification_status from app.drivers where user_id = $1`, [sub]);
    assert.equal(d.rows[0].verification_status, 'pending_review');
    assert.equal((await req('PUT', '/v1/drivers/me/application/steps/personal', sub, { payload: { firstName: 'X', lastName: 'Y' }, version: version + 1 })).statusCode, 409, 'locked while in review');

    const queue = await staff('GET', '/v1/staff/driver-applications', lagos);
    assert.equal(queue.statusCode, 200, queue.body);
    assert.ok(queue.json().data.items.some((i: { driverId: string }) => i.driverId === sub));
    const other = await staff('GET', '/v1/staff/driver-applications', abuja);
    assert.ok(!other.json().data.items.some((i: { driverId: string }) => i.driverId === sub));
    assert.equal((await staff('GET', `/v1/staff/driver-applications/${sub}`, abuja)).statusCode, 403);
    assert.equal((await staff('GET', '/v1/staff/driver-applications?city=lagos', abuja)).statusCode, 403);

    const detail = await staff('GET', `/v1/staff/driver-applications/${sub}`, lagos);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().data.driver.name, 'Tunde Bakare');
    assert.ok(detail.json().data.driver.phone, 'onboarding has contact details');
    assert.equal((await staff('GET', `/v1/staff/driver-applications/${sub}`, viewer)).json().data.driver.phone, undefined);
    assert.equal(detail.json().data.events[0].kind, 'submitted');

    const mfa = await req('GET', '/v1/staff/driver-applications', lagos.authUserId);
    assert.equal(mfa.json().error.code, 'MFA_REQUIRED');
    assert.equal((await staff('POST', `/v1/staff/driver-applications/${sub}/decision`, viewer, { version: version + 1, decision: 'approve' })).statusCode, 403, 'operations cannot verify');
  });

  test('changes requested, fixed and resubmitted, then approved once (two staff at once: one wins)', { skip }, async () => {
    const sub = await newDriver();
    const { version, files } = await fill(sub);
    await approveFiles(Object.values(files));
    const sent = await req('POST', '/v1/drivers/me/application/submit', sub, { payload: {}, version });
    let v: number = sent.json().data.version;

    const back = await staff('POST', `/v1/staff/driver-applications/${sub}/request-changes`, lagos, { version: v, issues: [{ code: 'licence_unreadable', note: 'Glare on the photo' }], note: 'One photo to retake' });
    assert.equal(back.statusCode, 200, back.body);
    assert.equal(back.json().data.status, 'changes_requested');
    assert.equal(back.json().data.summary.issues[0].step, 'licence');
    v = back.json().data.version;

    const early = await req('POST', '/v1/drivers/me/application/submit', sub, { payload: {}, version: v });
    assert.equal(early.statusCode, 409, 'open issue blocks resubmission');

    const photo = await file(sub, 'driver_licence', 'approved');
    const fixed = await req('PUT', '/v1/drivers/me/application/steps/licence', sub, { payload: { number: 'ABC123456789', expiry: '2031-05-01', photoFileId: photo }, version: v });
    assert.equal(fixed.statusCode, 200, fixed.body);
    assert.equal(fixed.json().data.status, 'changes_requested');
    assert.equal(fixed.json().data.summary.issues.length, 0);
    const again = await req('POST', '/v1/drivers/me/application/submit', sub, { payload: {}, version: fixed.json().data.version });
    assert.equal(again.statusCode, 200, again.body);
    v = again.json().data.version;

    assert.equal((await staff('POST', `/v1/staff/driver-applications/${sub}/decision`, lagos, { version: v, decision: 'reject', reason: 'short' })).statusCode, 422);
    const other = await addStaff(tdb.db, { roles: ['onboarding'] });
    const [a, b] = await Promise.all([
      staff('POST', `/v1/staff/driver-applications/${sub}/decision`, lagos, { version: v, decision: 'approve' }),
      staff('POST', `/v1/staff/driver-applications/${sub}/decision`, other, { version: v, decision: 'reject', reason: 'Documents look altered.' }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(codes, [200, 409]);
    const winner = a.statusCode === 200 ? a : b;
    const final = (await tdb.db.query(`select verification_status, approved_at from app.drivers where user_id = $1`, [sub])).rows[0];
    if (winner === a) {
      assert.equal(a.json().data.status, 'approved');
      assert.equal(final.verification_status, 'approved');
      assert.ok(final.approved_at);
      const veh = await tdb.db.query(`select status from app.vehicles where driver_id = $1`, [sub]);
      assert.deepEqual(veh.rows.map((r) => r.status), ['active']);
    } else {
      assert.equal(final.verification_status, 'rejected');
    }
    const decided = await tdb.db.query(`select decided_by from app.driver_applications where driver_id = $1`, [sub]);
    assert.ok(decided.rows[0].decided_by);
    await assert.rejects(tdb.db.query(`delete from app.application_events where driver_id = $1`, [sub]), /append-only/);
  });

  test('staff cannot review their own application', { skip }, async () => {
    const sub = await newDriver();
    await fill(sub);
    const self = await addStaff(tdb.db, { authUserId: sub, roles: ['onboarding'] });
    assert.equal((await staff('GET', `/v1/staff/driver-applications/${sub}`, self)).statusCode, 403);
  });
});
