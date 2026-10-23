import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { addStaff, addUser, bearer, createTestDb, ISSUER, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';

/** Supabase Auth token verification and server-side principals (docs/AUTHENTICATION_PLAN.md). */
describe('authentication and permissions', async () => {
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

  const me = (token: string) => t.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });

  test('a valid session for someone who has not finished sign-up', { skip }, async () => {
    const id = randomUUID();
    const r = await me(await keys.token({ sub: id, email: 'ada@example.test', session_id: 'sess-1' }));
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.data.userId, id);
    assert.equal(body.data.signupComplete, false);
    assert.equal(body.data.staff, null);
    assert.match(body.meta.requestId, /.+/);
  });

  test('riders and drivers come from the database, not from the token', { skip }, async () => {
    const id = await addUser(tdb.db, { rider: true, driver: { city: 'abuja', verification: 'pending_review' } });
    const r = await me(await keys.token({ sub: id, user_metadata: { staff: true, roles: ['owner'] }, app_metadata: { roles: ['owner'] } }));
    const d = r.json().data;
    assert.equal(d.rider, true);
    assert.deepEqual(d.driver, { city: 'abuja', verification: 'pending_review' });
    assert.equal(d.staff, null, 'metadata in the token grants nothing');
  });

  test('expired, wrong issuer, wrong audience, tampered, unsigned and foreign-key tokens are refused', { skip }, async () => {
    const sub = randomUUID();
    const expired = await keys.token({ sub }, { expiresIn: Math.floor(Date.now() / 1000) - 60 });
    assert.deepEqual([(await me(expired)).statusCode, (await me(expired)).json().error.code], [401, 'TOKEN_EXPIRED']);
    assert.equal((await me(await keys.token({ sub }, { issuer: 'https://evil.supabase.co/auth/v1' }))).statusCode, 401);
    assert.equal((await me(await keys.token({ sub }, { audience: 'anon' }))).statusCode, 401);
    const good = await keys.token({ sub });
    const [h, p, s] = good.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), sub: randomUUID() })).toString('base64url');
    assert.equal((await me(`${h}.${forgedPayload}.${s}`)).statusCode, 401, 'payload changed after signing');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
    assert.equal((await me(none)).statusCode, 401, 'alg none');
    const otherKeys = await makeKeys();
    assert.equal((await me(await otherKeys.token({ sub }))).statusCode, 401, 'signed by a key not in our JWKS');
  });

  test('HS256 tokens are refused unless the dev-only shared secret is enabled', { skip }, async () => {
    const secret = 'dev-only-shared-secret-at-least-32-chars!!';
    const hs = await new SignJWT({ role: 'authenticated', sub: randomUUID() }).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    assert.equal((await me(hs)).statusCode, 401);
    const devKeys = await makeKeys({ sharedSecret: secret });
    const dev = await makeApp({ db: tdb.db, keys: devKeys });
    assert.equal((await dev.inject({ method: 'GET', url: '/v1/me', headers: bearer(hs) })).statusCode, 200);
    await dev.app.close();
  });

  test('service-role and anonymous tokens never act as a user', { skip }, async () => {
    assert.equal((await me(await keys.token({ sub: randomUUID(), role: 'service_role' }))).statusCode, 401);
    assert.equal((await me(await keys.token({ sub: randomUUID(), role: 'anon' }))).statusCode, 401);
    assert.equal((await me(await keys.token({ sub: randomUUID(), is_anonymous: true }))).statusCode, 401);
    assert.equal((await me(await keys.token({ sub: 'not-a-uuid' }))).statusCode, 401);
  });

  test('suspended people are stopped at the door', { skip }, async () => {
    const id = await addUser(tdb.db, { rider: true, status: 'suspended' });
    const r = await me(await keys.token({ sub: id }));
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().error.code, 'ACCOUNT_SUSPENDED');
  });

  test('staff permissions need a second factor (aal2) and come from their roles', { skip }, async () => {
    const { authUserId } = await addStaff(tdb.db, { roles: ['finance'] });
    const aal1 = (await me(await keys.token({ sub: authUserId, aal: 'aal1' }))).json().data;
    assert.equal(aal1.staff.mfaRequired, true);
    assert.deepEqual(aal1.staff.permissions, []);
    const aal2 = (await me(await keys.token({ sub: authUserId, aal: 'aal2' }))).json().data;
    assert.equal(aal2.staff.mfaRequired, false);
    assert.ok(aal2.staff.permissions.includes('costs.manage'));
    assert.ok(!aal2.staff.permissions.includes('staff.manage'));

    const detailAal1 = await t.inject({ method: 'GET', url: '/v1/ops/health', headers: bearer(await keys.token({ sub: authUserId, aal: 'aal1' })) });
    assert.equal(detailAal1.json().error.code, 'MFA_REQUIRED');
    const finance = await t.inject({ method: 'GET', url: '/v1/ops/health', headers: bearer(await keys.token({ sub: authUserId, aal: 'aal2' })) });
    assert.equal(finance.statusCode, 403, 'finance does not hold logs.view');
    const dev = await addStaff(tdb.db, { roles: ['developer'] });
    const detail = await t.inject({ method: 'GET', url: '/v1/ops/health', headers: bearer(await keys.token({ sub: dev.authUserId, aal: 'aal2' })) });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(Object.keys(detail.json().data.checks).sort(), ['auth_keys', 'database', 'schema']);
  });

  test('suspended staff lose every permission', { skip }, async () => {
    const { authUserId } = await addStaff(tdb.db, { roles: ['owner'], status: 'suspended' });
    const r = await me(await keys.token({ sub: authUserId, aal: 'aal2' }));
    assert.equal(r.statusCode, 403);
  });
});
