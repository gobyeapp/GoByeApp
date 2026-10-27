import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { testConfig } from '../src/config/config';
import { runOnce } from '../src/jobs/worker';
import type { Providers } from '../src/providers/ports';
import { cloudApiWhatsApp, fakeMaps, logNotifications, simulatedWhatsApp } from '../src/providers/providers';
import { STALE_MESSAGE_MS, verifyMetaSignature, whatsappHandlers } from '../src/whatsapp/whatsapp.service';
import { addUser, createTestDb, makeApp, NO_DB_REASON, postgresAvailable, type TestApp, type TestDb } from './helpers';

/** WhatsApp quick booking (D-064): webhook security, de-duplication, and the booking flow end to end. */

const SECRET = 'meta-app-secret-for-tests-only';
const VERIFY = 'verify-token-for-tests-only-123';
const PNID = '1098765432100';
const RIDER_WA = '2348030000101';
const WA_CONFIG = {
  WHATSAPP_PROVIDER: 'simulated',
  WHATSAPP_APP_SECRET: SECRET,
  WHATSAPP_VERIFY_TOKEN: VERIFY,
  WHATSAPP_PHONE_NUMBER_ID: PNID,
  MAPS_PROVIDER: 'fake',
  NOTIFICATIONS_PROVIDER: 'log',
} as const;

const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
let seq = 0;
function webhook(from: string, message: Record<string, unknown>, ts = Math.floor(Date.now() / 1000)) {
  const id = `wamid.TEST${String(++seq).padStart(6, '0')}`;
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PNID }, messages: [{ from, id, timestamp: String(ts), ...message }] } }] }],
  });
  return { id, body };
}
const pin = (latitude: number, longitude: number, name: string) => ({ type: 'location', location: { latitude, longitude, name } });
const tap = (id: string) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: id } } });
const say = (body: string) => ({ type: 'text', text: { body } });

test('Meta signature: exact body, sha256= prefix, constant-time compare', () => {
  const raw = Buffer.from('{"a":1}');
  assert.equal(verifyMetaSignature(SECRET, raw, sign('{"a":1}')), true);
  assert.equal(verifyMetaSignature(SECRET, Buffer.from('{"a": 1}'), sign('{"a":1}')), false);
  assert.equal(verifyMetaSignature(SECRET, raw, undefined), false);
  assert.equal(verifyMetaSignature(SECRET, raw, 'sha1=abc'), false);
  assert.equal(verifyMetaSignature('other-secret-value', raw, sign('{"a":1}')), false);
});

test('config: WhatsApp needs its secrets and a maps provider; simulated is refused in production', () => {
  assert.throws(() => testConfig({ WHATSAPP_PROVIDER: 'simulated' }), /WHATSAPP_APP_SECRET[\s\S]*WHATSAPP_VERIFY_TOKEN[\s\S]*WHATSAPP_PHONE_NUMBER_ID[\s\S]*MAPS_PROVIDER/);
  assert.throws(() => testConfig({ ...WA_CONFIG, WHATSAPP_PROVIDER: 'cloud_api' }), /WHATSAPP_ACCESS_TOKEN/);
  assert.doesNotThrow(() => testConfig(WA_CONFIG));
  assert.throws(() => testConfig({ ...WA_CONFIG, APP_ENV: 'production' }), /WHATSAPP_PROVIDER: simulated is not allowed in production/);
});

test('Cloud API sender: posts to the phone number id; 4xx is permanent, 429/5xx retry; token never in errors', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let status = 200;
  const sender = cloudApiWhatsApp({
    accessToken: 'EAAG-secret-token',
    phoneNumberId: PNID,
    graphVersion: 'v23.0',
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(status === 200 ? { messages: [{ id: 'wamid.OUT1' }] } : { error: { code: 131026, message: 'x' } }), { status });
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(await sender.send({ type: 'text' }, 'k1'), { providerMessageId: 'wamid.OUT1' });
  assert.equal(calls[0]!.url, `https://graph.facebook.com/v23.0/${PNID}/messages`);
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, 'Bearer EAAG-secret-token');
  status = 400;
  await assert.rejects(sender.send({ type: 'text' }, 'k2'), (e: Error & { permanent?: boolean }) => e.permanent === true && !e.message.includes('EAAG'));
  status = 429;
  await assert.rejects(sender.send({ type: 'text' }, 'k3'), (e: Error & { permanent?: boolean }) => !e.permanent);
});

describe('WhatsApp webhook and quick booking (database)', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let t: TestApp;
  let wa: ReturnType<typeof simulatedWhatsApp>;
  let notes: ReturnType<typeof logNotifications>;
  let providers: Providers;
  let clock = Date.now();
  const config = testConfig(WA_CONFIG);
  const handlers = () => whatsappHandlers({ config, providers, now: () => clock });
  const post = (w: { body: string }, signature = sign(w.body)) =>
    t.inject({ method: 'POST', url: '/v1/webhooks/whatsapp', payload: w.body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature } });
  /** Delivers a message and runs the worker until the queue is empty. */
  async function send(from: string, message: Record<string, unknown>) {
    const w = webhook(from, message, Math.floor(clock / 1000));
    const r = await post(w);
    assert.equal(r.statusCode, 200, r.body);
    while ((await runOnce(tdb.db, handlers(), 'test-worker', { concurrency: 4 })) > 0) {
      /* drain */
    }
    return wa.sent[wa.sent.length - 1]!.message as { type: string; text?: { body: string }; interactive?: { type: string; body: { text: string }; action: Record<string, unknown> } };
  }

  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    wa = simulatedWhatsApp();
    notes = logNotifications();
    providers = { payments: null, maps: fakeMaps(), notifications: notes, storage: null as never, whatsapp: wa };
    t = await makeApp({ db: tdb.db, config: WA_CONFIG, providers });
    const id = await addUser(tdb.db, { name: 'Ada Obi', rider: true });
    await tdb.db.query(`update app.users set phone = $2 where id = $1`, [id, `+${RIDER_WA}`]);
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await tdb.drop();
  });

  test('GET verification echoes the challenge only for our verify token', { skip }, async () => {
    const ok = await t.inject({ method: 'GET', url: `/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444` });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body, '1158201444');
    assert.match(String(ok.headers['content-type']), /text\/plain/);
    const bad = await t.inject({ method: 'GET', url: '/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1' });
    assert.equal(bad.statusCode, 403);
  });

  test('POST without a valid Meta signature is refused and queues nothing', { skip }, async () => {
    const w = webhook(RIDER_WA, say('hi'));
    assert.equal((await post(w, 'sha256=' + '0'.repeat(64))).statusCode, 401);
    assert.equal((await post(w, '')).statusCode, 401);
    const jobs = await tdb.db.query(`select count(*)::int n from ops.jobs where kind = 'whatsapp.inbound'`);
    assert.equal(jobs.rows[0]!.n, 0);
  });

  test('a duplicate delivery of the same message is queued once', { skip }, async () => {
    const w = webhook('2348030000999', say('hi'));
    const a = await post(w);
    const b = await post(w);
    assert.deepEqual([JSON.parse(a.body).data.queued, JSON.parse(b.body).data.queued], [1, 0]);
    while ((await runOnce(tdb.db, handlers(), 'test-worker', { concurrency: 4 })) > 0) {
      /* drain */
    }
  });

  test('an unknown number is sent to sign up; nothing is booked', { skip }, async () => {
    const reply = await send('2348039999999', pin(6.4474, 3.4723, 'Lekki Phase 1'));
    assert.equal(reply.interactive?.type, 'cta_url');
    assert.match(JSON.stringify(reply.interactive?.action), /gobye\.app\/open\/signup/);
    const rides = await tdb.db.query(`select count(*)::int n from app.rides`);
    assert.equal(rides.rows[0]!.n, 0);
  });

  test('pickup pin → destination pin → fare list → tap → a Quick Match ride on WhatsApp, then CANCEL', { skip }, async () => {
    const r1 = await send(RIDER_WA, pin(6.4474, 3.4723, 'Lekki Phase 1'));
    assert.match(r1.text!.body, /Pickup: Lekki Phase 1/);

    const r2 = await send(RIDER_WA, pin(6.6018, 3.3515, 'Ikeja City Mall'));
    assert.equal(r2.interactive?.type, 'list');
    const rows = (r2.interactive!.action as { sections: { rows: { id: string; description: string }[] }[] }).sections[0]!.rows;
    assert.deepEqual(rows.map((r) => r.id), ['ride:keke', 'ride:go', 'ride:comfort', 'ride:xl', 'cancel']);
    assert.match(rows[1]!.description, /^₦[\d,]+ · 4 seats · test fare$/);

    const r3 = await send(RIDER_WA, tap('ride:go'));
    assert.equal(r3.interactive?.type, 'cta_url');
    assert.match(r3.interactive!.body.text, /Booked!/);
    const ride = await tdb.db.query<{ id: string; channel: string; status: string; mode: string; category: string; city: string; quoted_fare_kobo: string; agreed_fare_kobo: string; pickup_label: string }>(`select * from app.rides`);
    assert.equal(ride.rows.length, 1);
    const b = ride.rows[0]!;
    assert.deepEqual([b.channel, b.status, b.mode, b.category, b.city, b.pickup_label], ['whatsapp', 'searching', 'quick_match', 'go', 'lagos', 'Lekki Phase 1']);
    assert.equal(b.quoted_fare_kobo, b.agreed_fare_kobo);
    assert.match(JSON.stringify(r3.interactive!.action), new RegExp(`/open/ride/${b.id}`));
    // Fare shown in the chat is the fare stored.
    assert.ok(rows[1]!.description.startsWith(`₦${(Number(b.quoted_fare_kobo) / 100).toLocaleString('en-NG')}`));
    const ev = await tdb.db.query(`select type, actor_kind, data->>'channel' as channel from app.ride_events where ride_id = $1`, [b.id]);
    assert.deepEqual(ev.rows, [{ type: 'ride.requested', actor_kind: 'rider', channel: 'whatsapp' }]);
    const audit = await tdb.db.query(`select action from ops.audit_events where target_type = 'ride' and target_id = $1`, [b.id]);
    assert.deepEqual(audit.rows.map((x) => x.action), ['ride.requested']);
    assert.ok(notes.sent.includes(`wa-booked:${b.id}`), 'in-app notice of a WhatsApp booking');

    // Second pin while the ride is open: no second booking.
    const r4 = await send(RIDER_WA, pin(6.4474, 3.4723, 'Lekki Phase 1'));
    assert.match(r4.interactive!.body.text, /ride in progress/);

    const r5 = await send(RIDER_WA, say('CANCEL'));
    assert.match(r5.text!.body, /cancelled\. No fee/);
    const after = await tdb.db.query(`select status, cancelled_by from app.rides where id = $1`, [b.id]);
    assert.deepEqual(after.rows[0], { status: 'cancelled', cancelled_by: 'rider' });
  });

  test('a fare can only be booked from this session: a forged list reply books nothing', { skip }, async () => {
    const r = await send(RIDER_WA, tap('ride:xl'));
    assert.match(r.text!.body, /expired/);
    const n = await tdb.db.query(`select count(*)::int n from app.rides where status <> 'cancelled'`);
    assert.equal(n.rows[0]!.n, 0);
  });

  test('a delivery older than 10 minutes is not acted on', { skip }, async () => {
    const before = wa.sent.length;
    const w = webhook(RIDER_WA, pin(6.4474, 3.4723, 'Lekki'), Math.floor((clock - STALE_MESSAGE_MS - 60_000) / 1000));
    assert.equal((await post(w)).statusCode, 200);
    while ((await runOnce(tdb.db, handlers(), 'test-worker', { concurrency: 4 })) > 0) {
      /* drain */
    }
    assert.equal(wa.sent.length, before);
  });

  test('the kill switch keeps answering but books nothing', { skip }, async () => {
    const off = () => whatsappHandlers({ config: { ...config, WHATSAPP_BOOKING_ENABLED: false }, providers, now: () => clock });
    for (const m of [pin(6.4474, 3.4723, 'Lekki'), pin(6.6018, 3.3515, 'Ikeja')]) {
      assert.equal((await post(webhook(RIDER_WA, m, Math.floor(clock / 1000)))).statusCode, 200);
      while ((await runOnce(tdb.db, off(), 'test-worker', { concurrency: 4 })) > 0) {
        /* drain */
      }
    }
    const last = wa.sent[wa.sent.length - 1]!.message as { text: { body: string } };
    assert.match(last.text.body, /paused/);
    clock += 1; // keep the clock moving for later tests
  });

  test('cleanup removes stale sessions', { skip }, async () => {
    // (updates refresh updated_at through the touch trigger, so insert an old row directly)
    await tdb.db.query(`insert into app.whatsapp_sessions (wa_id, state, updated_at) values ('2348030000555', '{}'::jsonb, now() - interval '2 days')`);
    const r = await whatsappHandlers({ config, providers })['whatsapp.cleanup']!({ id: 'j', kind: 'whatsapp.cleanup', payload: {}, idempotency_key: 'c', attempts: 1, max_attempts: 1 }, tdb.db, new AbortController().signal);
    assert.ok(r.ok && (r.result as { sessions: number }).sessions === 1);
    const left = await tdb.db.query(`select count(*)::int n from app.whatsapp_sessions where wa_id = '2348030000555'`);
    assert.equal(left.rows[0]!.n, 0);
  });
});

test('WhatsApp off: the webhook does not exist', async () => {
  const t = await makeApp();
  try {
    const r = await t.inject({ method: 'POST', url: '/v1/webhooks/whatsapp', payload: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(r.statusCode, 404);
  } finally {
    await t.app.close();
  }
});
