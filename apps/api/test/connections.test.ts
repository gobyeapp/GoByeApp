import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { CURRENT_CONSENTS, createMockObjectStore } from '@gobye/core';
import { bearer, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';
import { testConfig } from '../src/config/config';
import { providersFromConfig } from '../src/providers/providers';
import { expoPush, resendEmail, termiiSms, verifyStandardWebhook, NotifyPermanentError } from '../src/providers/notify';
import { googleMaps } from '../src/providers/google-maps';
import { qoreId, simulatedIdentity } from '../src/providers/qoreid';
import { notifyHandlers, notify } from '../src/notify/notify';
import { identityHandlers } from '../src/drivers/identity.job';
import type { NotificationMessage } from '../src/providers/ports';

const consents = [
  { document: 'terms', version: CURRENT_CONSENTS.terms },
  { document: 'privacy', version: CURRENT_CONSENTS.privacy },
];
const HOOK_SECRET = `v1,whsec_${Buffer.from('a-hook-secret-of-32-bytes-or-more!').toString('base64')}`;
const job = (kind: string, payload: Record<string, unknown>) => ({ id: randomUUID(), kind, payload, idempotency_key: randomUUID(), attempts: 1, max_attempts: 5 });

function fakeFetch(replies: { status: number; json: unknown }[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  const f = async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const r = replies.shift();
    if (!r) throw new Error('no reply');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  };
  return { f, calls, replies };
}

/** Connections to outside services (D-103): codes by SMS, notifications, place search, identity checks. */
describe('connections API', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let keys: Keys;
  let t: TestApp;
  const sent: NotificationMessage[] = [];
  const codes: { to: string; text: string }[] = [];
  let failPush: Error | null = null;
  const cfg = { MAPS_PROVIDER: 'fake', NOTIFICATIONS_PROVIDER: 'log', SMS_PROVIDER: 'termii', TERMII_API_KEY: 'tk-1234567890', TERMII_SENDER_ID: 'GoBye', TERMII_BASE_URL: 'https://termii.example', SUPABASE_SMS_HOOK_SECRET: HOOK_SECRET, STORAGE_PROVIDER: 'memory', IDENTITY_PROVIDER: 'simulated' } as const;
  const providers = {
    ...providersFromConfig(testConfig(cfg)),
    notifications: {
      name: 'test',
      async send(m: NotificationMessage) {
        if (m.channel === 'push' && failPush) throw failPush;
        sent.push(m);
        return { accepted: true, providerMessageId: 'x' };
      },
    },
    smsCodes: { name: 'test', async sendText(to: string, text: string) { codes.push({ to, text }); } },
    identity: simulatedIdentity,
    storage: createMockObjectStore({ sha256: () => 'a'.repeat(64) }),
  };
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    keys = await makeKeys();
    t = await makeApp({ db: tdb.db, keys, config: cfg, providers });
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await tdb.drop();
  });

  const phone = () => `234803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  async function person(role: 'rider' | 'driver', email?: string) {
    const sub = randomUUID();
    const tok = { sub, phone: phone(), ...(email ? { email } : {}) };
    const r = await t.inject({ method: 'POST', url: '/v1/me/profile', headers: { ...bearer(await keys.token(tok)), 'idempotency-key': randomUUID() }, payload: { role, fullName: 'Ada Obi', ...(role === 'driver' ? { city: 'lagos' } : {}), consents, device: { installId: 'install-0123456789abcdef', platform: 'android' } } });
    assert.equal(r.statusCode, 201, r.body);
    return { sub, tok };
  }
  const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, tok: Record<string, unknown>, payload?: object) => t.inject({ method, url, headers: { ...bearer(await keys.token(tok)), ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }) }, ...(payload ? { payload } : {}) });
  const run = (kind: string, payload: Record<string, unknown>, handlers = { ...notifyHandlers({ providers }), ...identityHandlers({ providers }) }) => handlers[kind]!(job(kind, payload), tdb.db, new AbortController().signal);

  test('the sign-in service can send a code by SMS only with a valid, fresh signature', { skip }, async () => {
    const body = JSON.stringify({ user: { id: randomUUID(), phone: '+2348031234567' }, sms: { otp: '482913' } });
    const sign = (id: string, ts: number, b = body) => `v1,${createHmac('sha256', Buffer.from(HOOK_SECRET.replace('v1,whsec_', ''), 'base64')).update(`${id}.${ts}.${b}`).digest('base64')}`;
    const post = (headers: Record<string, string>, b = body) => t.inject({ method: 'POST', url: '/v1/hooks/auth/send-sms', headers: { 'content-type': 'application/json', ...headers }, payload: b });
    const ts = Math.floor(Date.now() / 1000);
    assert.equal((await post({})).statusCode, 401, 'no signature');
    assert.equal((await post({ 'webhook-id': 'm1', 'webhook-timestamp': String(ts), 'webhook-signature': 'v1,AAAA' })).statusCode, 401, 'wrong signature');
    assert.equal((await post({ 'webhook-id': 'm1', 'webhook-timestamp': String(ts - 900), 'webhook-signature': sign('m1', ts - 900) })).statusCode, 401, 'too old (a replay)');
    assert.equal((await post({ 'webhook-id': 'm1', 'webhook-timestamp': String(ts), 'webhook-signature': sign('m1', ts) }, body.replace('482913', '111111'))).statusCode, 401, 'body changed');
    assert.equal(codes.length, 0);
    const ok = await post({ 'webhook-id': 'm1', 'webhook-timestamp': String(ts), 'webhook-signature': sign('m1', ts) });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(codes.length, 1);
    assert.equal(codes[0]!.to, '+2348031234567');
    assert.match(codes[0]!.text, /482913/);
    assert.equal(ok.body.includes('482913'), false, 'the code is never echoed');
    const abroad = JSON.stringify({ user: { phone: '+15551234567' }, sms: { otp: '482913' } });
    assert.equal((await post({ 'webhook-id': 'm2', 'webhook-timestamp': String(ts), 'webhook-signature': sign('m2', ts, abroad) }, abroad)).statusCode, 422, 'no SMS to other countries (toll fraud)');
    assert.equal(verifyStandardWebhook('v1,whsec_c2hvcnQ=', body, { 'webhook-id': 'm', 'webhook-timestamp': String(ts), 'webhook-signature': 'v1,x' }, Date.now()), false, 'a weak secret is refused');
    const off = await makeApp({ db: tdb.db, keys });
    assert.equal((await off.inject({ method: 'POST', url: '/v1/hooks/auth/send-sms', payload: {} })).statusCode, 404, 'off unless configured');
    await off.app.close();
  });

  test('receipts go only to a confirmed email, and stop when turned off; push tokens are per person', { skip }, async () => {
    const a = await person('rider', 'ada@example.com');
    const b = await person('rider');
    const receipt = async (who: string, id: string) => {
      await tdb.db.tx((tx) => notify(tx, { id, userId: who, channel: 'email', template: 'ride.receipt', data: { rideId: 'r1', fare: '₦2,500' } }));
      return run('notify.send', { id, data: { rideId: 'r1', fare: '₦2,500', date: 'today', pickup: 'A', destination: 'B', method: 'Bank transfer', driver: 'Tunde' } });
    };
    await receipt(a.sub, 'receipt-1');
    assert.equal(sent.length, 0, 'the address is not confirmed until the sign-in service says so');
    assert.equal((await call('GET', '/v1/me', a.tok)).statusCode, 200);
    assert.deepEqual((await call('GET', '/v1/me/notifications', a.tok)).json().data, { emailReceipts: true, emailConfirmed: true });
    await receipt(a.sub, 'receipt-2');
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to.address, 'ada@example.com');
    await receipt(a.sub, 'receipt-2');
    await run('notify.send', { id: 'receipt-2', data: {} });
    assert.equal(sent.length, 1, 'the same message is never sent twice');
    await receipt(b.sub, 'receipt-3');
    assert.equal(sent.length, 1, 'no email on the account: nothing sent');
    assert.equal((await call('PATCH', '/v1/me/notifications', a.tok, { emailReceipts: false })).statusCode, 200);
    await receipt(a.sub, 'receipt-4');
    assert.equal(sent.length, 1, 'turned off');
    assert.equal((await tdb.db.query<{ status: string }>(`select status from ops.notifications where id = 'receipt-4'`)).rows[0]!.status, 'skipped');

    const token = 'ExponentPushToken[abcdefghijklmnop]';
    assert.equal((await call('POST', '/v1/me/push-token', a.tok, { installId: 'install-0123456789abcdef', pushToken: token })).statusCode, 200);
    assert.equal((await call('POST', '/v1/me/push-token', b.tok, { installId: 'install-0123456789abcdef', pushToken: token })).statusCode, 200);
    const owners = (await tdb.db.query<{ user_id: string }>(`select user_id from app.devices where push_token = $1`, [token])).rows.map((r) => r.user_id);
    assert.deepEqual(owners, [b.sub], 'a token moves with the phone: the last person to sign in on it');
    await tdb.db.tx((tx) => notify(tx, { id: 'push-1', userId: b.sub, channel: 'push', template: 'ride.cancelled' }));
    failPush = new NotifyPermanentError('gone', true);
    await run('notify.send', { id: 'push-1', data: {} });
    failPush = null;
    assert.equal((await tdb.db.query(`select 1 from app.devices where push_token = $1`, [token])).rows.length, 0, 'a dead token is forgotten');
  });

  test('place search goes through the server and is capped per person', { skip }, async () => {
    const a = await person('rider');
    const r = await call('GET', '/v1/places/search?q=ikeja&lat=6.6&lng=3.35', a.tok);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().data.estimated, true);
    assert.equal((await call('GET', '/v1/places/search?q=i', a.tok)).statusCode, 422);
    assert.equal((await t.inject({ method: 'GET', url: '/v1/places/search?q=ikeja' })).statusCode, 401, 'signed-in people only');
    let last = 200;
    for (let i = 0; i < 45 && last === 200; i++) last = (await call('GET', '/v1/places/reverse?lat=6.6&lng=3.35', a.tok)).statusCode;
    assert.equal(last, 429);
  });

  test('an identity check records its outcome for staff and never decides for them', { skip }, async () => {
    const d = await person('driver');
    const fileId = (await tdb.db.query<{ id: string }>(`insert into ops.files (owner_id, file_class, access_class, bucket, object_key, status, scan_status, claimed_mime, declared_size, sha256, retention_policy, upload_expires_at) values ($1, 'identity_document', 'private', 'documents', $2, 'uploaded', 'pending', 'image/jpeg', 1000, $3, 'driver_documents', now() + interval '1 hour') returning id`, [d.sub, `k/${randomUUID()}`, 'a'.repeat(64)])).rows[0]!.id;
    const data = { documents: {}, status: 'pending_review', personal: { firstName: 'Ada', lastName: 'Obi', city: 'Lagos', photoUri: fileId }, identity: { type: 'nin', number: '12345678901', selfieUri: fileId }, checks: [{ id: 'identity', state: 'queued', updatedAt: 1 }, { id: 'licence', state: 'queued', updatedAt: 1 }] };
    await tdb.db.query(`insert into app.driver_applications (driver_id, status, data, submitted_at) values ($1, 'pending_review', $2::jsonb, now()) on conflict (driver_id) do update set status = 'pending_review', data = excluded.data, submitted_at = now()`, [d.sub, JSON.stringify(data)]);
    const early = await run('identity.check', { driverId: d.sub });
    assert.equal(early.ok, false, 'waits until our own file check has cleared the selfie');
    assert.equal((await tdb.db.query(`select 1 from app.identity_checks where driver_id = $1`, [d.sub])).rows.length, 0);
    await tdb.db.query(`update ops.files set scan_status = 'clean', status = 'approved' where id = $1`, [fileId]);
    assert.equal((await run('identity.check', { driverId: d.sub })).ok, true);
    const row = (await tdb.db.query<{ status: string; face_match: boolean; provider: string }>(`select status, face_match, provider from app.identity_checks where driver_id = $1`, [d.sub])).rows[0]!;
    assert.deepEqual([row.status, row.face_match, row.provider], ['failed', false, 'simulated'], 'this NIN ends in an odd digit');
    const app = (await tdb.db.query<{ status: string; data: { checks: { id: string; state: string }[] } }>(`select status, data from app.driver_applications where driver_id = $1`, [d.sub])).rows[0]!;
    assert.equal(app.status, 'pending_review', 'the application is still for a person to decide');
    assert.equal(app.data.checks.find((c) => c.id === 'identity')!.state, 'failed');
    assert.equal(app.data.checks.find((c) => c.id === 'licence')!.state, 'queued');
    assert.equal((await tdb.db.query(`select 1 from app.drivers where user_id = $1 and verification_status = 'approved'`, [d.sub])).rows.length, 0);
  });
});

describe('provider adapters (against stand-in servers, never the real ones)', () => {
  const msg = (o: Partial<NotificationMessage>): NotificationMessage => ({ id: 'm-1', channel: 'push', to: { userId: 'u', address: 'ExponentPushToken[abc]' }, template: 'ride.trip_ended', data: { fare: '₦2,500', rideId: 'r1' }, ...o });

  test('Expo push: sends a short message; a dead token is reported as invalid', async () => {
    const { f, calls } = fakeFetch([{ status: 200, json: { data: { status: 'ok', id: 't1' } } }, { status: 200, json: { data: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }]);
    const p = expoPush({ fetch: f as never });
    assert.equal((await p.send(msg({}))).providerMessageId, 't1');
    assert.deepEqual([calls[0]!.url, calls[0]!.body!.to, calls[0]!.body!.title], ['https://exp.host/--/api/v2/push/send', 'ExponentPushToken[abc]', 'Trip complete']);
    await assert.rejects(p.send(msg({})), (e: NotifyPermanentError) => e.invalidAddress === true);
    await assert.rejects(p.send(msg({ to: { userId: 'u', address: 'not-a-token' } })), NotifyPermanentError);
  });

  test('Resend email: escapes what people typed, and repeats safely', async () => {
    const { f, calls } = fakeFetch([{ status: 200, json: { id: 'e1' } }, { status: 500, json: null }]);
    const p = resendEmail({ apiKey: 're_1234567890', from: 'GoBye <receipts@gobye.app>', fetch: f as never });
    await p.send(msg({ channel: 'email', to: { userId: 'u', address: 'ada@example.com' }, template: 'ride.receipt', data: { fare: '₦2,500', rideId: 'r1', pickup: '<script>alert(1)</script>', destination: 'B', method: 'Cash', driver: 'T', date: 'today' } }));
    assert.equal(calls[0]!.headers['idempotency-key'], 'm-1');
    assert.equal(String(calls[0]!.body!.html).includes('<script>'), false);
    assert.ok(String(calls[0]!.body!.html).includes('&lt;script&gt;'));
    await assert.rejects(p.send(msg({ channel: 'email', to: { userId: 'u', address: 'a@b.co' }, template: 'ride.receipt' })), (e: Error) => !(e instanceof NotifyPermanentError), 'a 500 is retried later');
  });

  test('Termii SMS: Nigerian numbers only, on the transactional route', async () => {
    const { f, calls } = fakeFetch([{ status: 200, json: { message_id: '99', code: 'ok' } }]);
    const p = termiiSms({ apiKey: 'tk-1234567890', senderId: 'GoBye', baseUrl: 'https://v3.api.termii.example/', fetch: f as never });
    await p.sendText('+2348031234567', 'Your GoBye code is 123456.');
    assert.deepEqual([calls[0]!.url, calls[0]!.body!.to, calls[0]!.body!.channel, calls[0]!.body!.from], ['https://v3.api.termii.example/api/sms/send', '2348031234567', 'dnd', 'GoBye']);
    await assert.rejects(p.sendText('+15551234567', 'x'), NotifyPermanentError);
  });

  test('Google Maps: route distance and time, place search biased to Nigeria', async () => {
    const { f, calls } = fakeFetch([{ status: 200, json: { routes: [{ distanceMeters: 21000, duration: '2710s', polyline: { encodedPolyline: 'abc' } }] } }, { status: 200, json: { places: [{ id: 'p1', displayName: { text: 'Ikeja City Mall' }, formattedAddress: 'Obafemi Awolowo Way, Ikeja', location: { latitude: 6.6, longitude: 3.35 } }] } }, { status: 200, json: { routes: [] } }]);
    const m = googleMaps({ apiKey: 'k'.repeat(30), fetch: f as never });
    assert.deepEqual(await m.route({ latitude: 6.6, longitude: 3.35 }, { latitude: 6.43, longitude: 3.42 }), { distanceMeters: 21000, durationSeconds: 2710, polyline: 'abc' });
    assert.equal(calls[0]!.headers['x-goog-api-key'], 'k'.repeat(30));
    assert.equal(calls[0]!.url.includes('key='), false, 'the key travels in a header, not the address');
    const places = await m.searchPlaces('ikeja', { latitude: 6.6, longitude: 3.35 }, 's');
    assert.deepEqual([places[0]!.label, calls[1]!.body!.regionCode], ['Ikeja City Mall', 'NG']);
    await assert.rejects(m.route({ latitude: 6.6, longitude: 3.35 }, { latitude: 6.6, longitude: 3.35 }), (e: { extra?: { details?: { destination?: string } } }) => /route/.test(e.extra?.details?.destination ?? ''));
  });

  test('QoreID: a face match passes only when the face AND the name match', async () => {
    const reply = (match: boolean, first = 'ADA') => ({ status: 200, json: { id: 77, summary: { face_verification_check: { match, match_score: match ? 99.2 : 12.5 } }, status: { state: 'complete', status: 'verified' }, face_verification: { firstname: first, lastname: 'Obi', photo: 'BASE64…' } } });
    const { f, calls } = fakeFetch([{ status: 200, json: { accessToken: 'tok', expiresIn: 600 } }, reply(true), reply(false), reply(true, 'Ngozi')]);
    const q = qoreId({ clientId: 'client-1', secret: 'secret-123456', fetch: f as never });
    const p = { nin: '12345678901', firstName: 'Ada', lastName: 'Obi', photoUrl: 'https://files.example/selfie' };
    const ok = await q.ninFaceMatch(p);
    assert.deepEqual([ok.status, ok.faceMatch, ok.nameMatch, ok.providerRef], ['passed', true, true, '77']);
    assert.equal(JSON.stringify(ok).includes('BASE64'), false, 'the provider’s photo is not kept');
    assert.equal(calls.filter((c) => c.url.endsWith('/token')).length, 1);
    assert.equal((await q.ninFaceMatch(p)).status, 'failed');
    const other = await q.ninFaceMatch(p);
    assert.deepEqual([other.status, other.nameMatch], ['failed', false], 'someone else’s NIN');
  });
});
