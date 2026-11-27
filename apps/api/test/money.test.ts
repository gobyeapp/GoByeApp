import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { CURRENT_CONSENTS, PASS_PRICE, createSimulatedGateway, type Kobo, type PaymentGatewayAdapter, type TransferStatus } from '@gobye/core';
import { addStaff, bearer, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';
import { testConfig } from '../src/config/config';
import { providersFromConfig } from '../src/providers/providers';
import { paystackGateway } from '../src/providers/paystack';
import { integrity, postJournal } from '../src/money/ledger';
import { checkPayout, settleCollection, submitPayout } from '../src/money/money.service';

const consents = [
  { document: 'terms', version: CURRENT_CONSENTS.terms },
  { document: 'privacy', version: CURRENT_CONSENTS.privacy },
];
const IKEJA = { latitude: 6.6018, longitude: 3.3515, label: 'Ikeja City Mall' };
const VI = { latitude: 6.4281, longitude: 3.4219, label: 'Victoria Island' };

/** Money (D-101): the ledger, wallet top-ups, paying a trip from the wallet, withdrawals, refunds. */
describe('money API', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let keys: Keys;
  let t: TestApp;
  let off: TestApp;
  const sim = createSimulatedGateway({ chargeBps: 150 });
  /** What the "provider" says about each payout, set by the tests. */
  const transfers = new Map<string, TransferStatus['status']>();
  const gateway: PaymentGatewayAdapter = {
    ...sim,
    async getTransfer(reference) {
      const r = await sim.getTransfer(reference);
      const forced = transfers.get(reference);
      return r.ok && forced ? { ok: true, value: { ...r.value, status: forced, providerCharge: 5000 as Kobo } } : r;
    },
  };
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    keys = await makeKeys();
    const cfg = { MAPS_PROVIDER: 'fake', PAYMENTS_PROVIDER: 'simulated', WALLET_ENABLED: 'true' } as const;
    t = await makeApp({ db: tdb.db, keys, config: cfg, providers: { ...providersFromConfig(testConfig(cfg)), payments: gateway } });
    off = await makeApp({ db: tdb.db, keys, config: { MAPS_PROVIDER: 'fake' } });
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await off.app.close();
    await tdb.drop();
  });

  const phone = () => `234803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const call = async (method: 'GET' | 'PUT' | 'POST', url: string, sub: string, payload?: object, o: { key?: string; aal?: string; app?: TestApp } = {}) =>
    (o.app ?? t).inject({ method, url, headers: { ...bearer(await keys.token({ sub, aal: o.aal ?? 'aal1', phone: '2348031234567' })), ...(method === 'GET' ? {} : { 'idempotency-key': o.key ?? randomUUID() }) }, ...(payload ? { payload } : {}) });
  const staffCall = (method: 'GET' | 'POST', url: string, who: { authUserId: string }, payload?: object) => call(method, url, who.authUserId, payload, { aal: 'aal2' });
  const data = (r: { statusCode: number; body: string; json(): { data: never } }, code = 200) => {
    assert.equal(r.statusCode, code, r.body);
    return r.json().data as Record<string, never>;
  };

  async function person(role: 'rider' | 'driver') {
    const sub = randomUUID();
    const r = await t.inject({ method: 'POST', url: '/v1/me/profile', headers: { ...bearer(await keys.token({ sub, phone: phone() })), 'idempotency-key': randomUUID() }, payload: { role, fullName: 'Ada Obi', ...(role === 'driver' ? { city: 'lagos' } : {}), consents } });
    assert.equal(r.statusCode, 201, r.body);
    await tdb.db.query(`update app.users set email = $2 where id = $1`, [sub, `${sub.slice(0, 8)}@example.com`]);
    return sub;
  }
  async function driver() {
    const sub = await person('driver');
    await tdb.db.query(`update app.drivers set verification_status = 'approved', approved_at = now() where user_id = $1`, [sub]);
    await tdb.db.query(`insert into app.vehicles (driver_id, category, make, model, colour, year, plate, status) values ($1, 'go', 'Toyota', 'Corolla', 'Silver', 2016, $2, 'active')`, [sub, `KJA${String(Math.floor(Math.random() * 900) + 100)}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}C`]);
    return sub;
  }
  const hook = (e: { eventId: string; type: string; reference: string }, sign = true) => {
    const w = sim.signedWebhook(e as never);
    return t.inject({ method: 'POST', url: '/v1/webhooks/payments/simulated', headers: { 'content-type': 'application/json', ...(sign ? w.headers : { 'x-simulated-signature': 'nope' }) } as never, payload: w.rawBody });
  };
  /** A rider with money in the wallet (top-up paid and verified). */
  async function fund(rider: string, amountKobo: number) {
    const d = data(await call('POST', '/v1/wallet/deposits', rider, { amountKobo, method: 'transfer' }), 201) as unknown as { reference: string };
    sim.simulatePayment(d.reference, amountKobo as Kobo);
    assert.equal((await hook({ eventId: `evt-${d.reference}`, type: 'collection.successful', reference: d.reference })).statusCode, 200);
    assert.equal(await settleCollection(tdb.db, gateway, d.reference, Date.now()), 'credited');
    return d.reference;
  }
  /** A finished trip waiting for payment. */
  async function finishedRide(rider: string, d: string) {
    await tdb.db.query(`update app.driver_presence set online = false`);
    data(await call('PUT', '/v1/drivers/me/presence', d, { online: true, location: { latitude: IKEJA.latitude, longitude: IKEJA.longitude } }));
    const q = (data(await call('POST', '/v1/quotes', rider, { pickup: IKEJA, destination: VI }), 201) as unknown as { quotes: { id: string; category: string; suggestedKobo: number }[] }).quotes.find((x) => x.category === 'go')!;
    const ride = data(await call('POST', '/v1/rides', rider, { quoteId: q.id, mode: 'quick_match' }), 201) as unknown as { id: string };
    data(await call('POST', `/v1/drivers/me/requests/${ride.id}/accept`, d, {}));
    data(await call('POST', `/v1/drivers/me/rides/${ride.id}/arrived`, d, {}));
    const pin = (data(await call('GET', `/v1/rides/${ride.id}`, rider)) as unknown as { pickupPin: string }).pickupPin;
    data(await call('POST', `/v1/drivers/me/rides/${ride.id}/start`, d, { pin }));
    data(await call('POST', `/v1/drivers/me/rides/${ride.id}/complete`, d, {}));
    return { id: ride.id, fare: q.suggestedKobo };
  }

  test('switched off by default: nothing that moves money answers', { skip }, async () => {
    const rider = await person('rider');
    assert.equal((await call('POST', '/v1/wallet/deposits', rider, { amountKobo: 500_000, method: 'card' }, { app: off })).json().error.code, 'NOT_CONFIGURED');
    assert.equal((await off.inject({ method: 'POST', url: '/v1/webhooks/payments/simulated', payload: {} })).statusCode, 404);
    const w = data(await call('GET', '/v1/wallet', rider, undefined, { app: off })) as unknown as { enabled: boolean; balanceKobo: number };
    assert.equal(w.enabled, false);
    assert.equal(w.balanceKobo, 0);
    assert.throws(() => testConfig({ WALLET_ENABLED: 'true' }), /WALLET_ENABLED/);
    assert.throws(() => testConfig({ PAYMENTS_PROVIDER: 'paystack' }), /PAYSTACK_SECRET_KEY/);
    assert.throws(() => testConfig({ PAYMENTS_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: `sk_live_${'a'.repeat(30)}` }), /live keys are refused/);
  });

  test('a top-up is credited once, only after our own lookup, only for the exact amount', { skip }, async () => {
    const rider = await person('rider');
    assert.equal((await call('POST', '/v1/wallet/deposits', rider, { amountKobo: 5000, method: 'transfer' })).statusCode, 422, 'below the minimum');
    assert.equal((await call('POST', '/v1/wallet/deposits', rider, { amountKobo: 500_000, method: 'card' })).statusCode, 409, 'the simulated provider has no cards');
    const key = randomUUID();
    const first = data(await call('POST', '/v1/wallet/deposits', rider, { amountKobo: 500_000, method: 'transfer' }, { key }), 201) as unknown as { reference: string; status: string; account: { accountNumber: string }; simulated: boolean };
    assert.equal(first.status, 'pending');
    assert.equal(first.simulated, true);
    assert.ok(first.account.accountNumber);
    assert.equal((data(await call('POST', '/v1/wallet/deposits', rider, { amountKobo: 500_000, method: 'transfer' }, { key }), 201) as unknown as { reference: string }).reference, first.reference, 'same key, same payment');
    assert.equal((await call('GET', `/v1/payments/${first.reference}`, await person('rider'))).statusCode, 404, 'someone else’s payment');

    // A webhook with a bad signature is refused; a good one for an unpaid payment credits nothing.
    assert.equal((await hook({ eventId: 'e1', type: 'collection.successful', reference: first.reference }, false)).statusCode, 401);
    assert.equal((await hook({ eventId: 'e1', type: 'collection.successful', reference: first.reference })).statusCode, 200);
    assert.equal((data(await call('GET', '/v1/wallet', rider)) as unknown as { balanceKobo: number }).balanceKobo, 0, 'a webhook alone is never proof');

    // Paid, but the wrong amount: not credited, flagged for a person.
    sim.simulatePayment(first.reference, 400_000 as Kobo);
    assert.equal(await settleCollection(tdb.db, gateway, first.reference, Date.now()), 'investigate');
    assert.equal((data(await call('GET', '/v1/wallet', rider)) as unknown as { balanceKobo: number }).balanceKobo, 0);

    const second = data(await call('POST', '/v1/wallet/deposits', rider, { amountKobo: 500_000, method: 'transfer' }), 201) as unknown as { reference: string };
    sim.simulatePayment(second.reference, 500_000 as Kobo);
    // The webhook, the app and the job all look at once: exactly one credit.
    const outcomes = await Promise.all([hook({ eventId: 'e2', type: 'collection.successful', reference: second.reference }), ...[1, 2, 3, 4].map(() => settleCollection(tdb.db, gateway, second.reference, Date.now()))]);
    assert.equal((outcomes[0] as { statusCode: number }).statusCode, 200);
    assert.equal((await hook({ eventId: 'e2', type: 'collection.successful', reference: second.reference })).json().data.duplicate, true);
    const w = data(await call('GET', '/v1/wallet', rider)) as unknown as { balanceKobo: number; transactions: { amountKobo: number; kind: string }[] };
    assert.equal(w.balanceKobo, 500_000);
    assert.equal(w.transactions.length, 1);
    assert.equal((data(await call('GET', `/v1/payments/${second.reference}`, rider)) as unknown as { status: string }).status, 'credited');
    const lines = (await tdb.db.query<{ account_kind: string; amount_kobo: string }>(`select e.account_kind, e.amount_kobo from app.ledger_entries e join app.ledger_journals j on j.id = e.journal_id where j.reference = $1 order by e.account_kind`, [second.reference])).rows;
    assert.deepEqual(lines.map((l) => [l.account_kind, Number(l.amount_kobo)]), [['passenger_wallet', 500_000], ['processing_costs', -7500], ['provider_clearing', -492_500]], 'the provider’s charge is recorded separately');
    const review = data(await staffCall('GET', '/v1/ops/finance/collections/review', await addStaff(tdb.db, { roles: ['finance'] }))) as unknown as { collections: { reference: string }[] };
    assert.ok(review.collections.some((c) => c.reference === first.reference));
  });

  test('paying a trip from the wallet moves the fare to the driver, once', { skip }, async () => {
    const rider = await person('rider');
    const d = await driver();
    const ride = await finishedRide(rider, d);
    const poor = await call('POST', `/v1/rides/${ride.id}/payment`, rider, { method: 'wallet' });
    assert.equal(poor.json().error.code, 'INSUFFICIENT_FUNDS');
    assert.equal((data(await call('GET', `/v1/rides/${ride.id}`, rider)) as unknown as { status: string }).status, 'payment_pending', 'nothing changed');
    await fund(rider, ride.fare + 100_000);
    const key = randomUUID();
    const paid = data(await call('POST', `/v1/rides/${ride.id}/payment`, rider, { method: 'wallet' }, { key })) as unknown as { status: string; payment: { paidAt: string } };
    assert.equal(paid.status, 'completed');
    assert.ok(paid.payment.paidAt);
    data(await call('POST', `/v1/rides/${ride.id}/payment`, rider, { method: 'wallet' }, { key }));
    data(await call('POST', `/v1/rides/${ride.id}/payment`, rider, { method: 'wallet' }));
    assert.equal((data(await call('GET', '/v1/wallet', rider)) as unknown as { balanceKobo: number }).balanceKobo, 100_000);
    assert.equal((data(await call('GET', '/v1/drivers/me/earnings', d)) as unknown as { balanceKobo: number }).balanceKobo, ride.fare, '0% commission: the driver gets the whole fare');
  });

  test('withdrawals: set aside, approved by staff, sent once, followed to the end', { skip }, async () => {
    const rider = await person('rider');
    const d = await driver();
    const ride = await finishedRide(rider, d);
    await fund(rider, ride.fare);
    data(await call('POST', `/v1/rides/${ride.id}/payment`, rider, { method: 'wallet' }));
    const finance = await addStaff(tdb.db, { roles: ['finance'] });
    const ops = await addStaff(tdb.db, { roles: ['operations'] });

    data(await call('PUT', '/v1/drivers/me/payout-account', d, { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi' }));
    assert.match((await call('POST', '/v1/drivers/me/withdrawals', d, { amountKobo: 100_000 })).json().error.message, /bank account/);
    data(await call('PUT', '/v1/drivers/me/payout-account', d, { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi', bankCode: '058' }));
    assert.equal((await call('POST', '/v1/drivers/me/withdrawals', d, { amountKobo: 100_000 })).json().error.code, 'PAYOUT_ACCOUNT_CHANGED', 'no withdrawal for 24 hours after the bank account changes');
    await tdb.db.query(`update app.driver_payout_accounts set updated_at = now() - interval '25 hours' where driver_id = $1`, [d]);
    assert.equal((await call('POST', '/v1/drivers/me/withdrawals', d, { amountKobo: ride.fare + 100_000 })).json().error.code, 'INSUFFICIENT_FUNDS');
    const w1 = data(await call('POST', '/v1/drivers/me/withdrawals', d, { amountKobo: 100_000 }), 201) as unknown as { id: string; status: string };
    assert.equal((await call('POST', '/v1/drivers/me/withdrawals', d, { amountKobo: 100_000 })).statusCode, 409, 'one at a time');
    let e = data(await call('GET', '/v1/drivers/me/earnings', d)) as unknown as { balanceKobo: number; setAsideKobo: number };
    assert.deepEqual([e.balanceKobo, e.setAsideKobo], [ride.fare - 100_000, 100_000]);

    assert.equal((await staffCall('POST', `/v1/ops/finance/withdrawals/${w1.id}/approve`, ops, {})).statusCode, 403, 'not a finance reviewer');
    assert.equal((await call('POST', `/v1/ops/finance/withdrawals/${w1.id}/approve`, finance.authUserId, {})).statusCode, 403, 'second factor needed');
    data(await staffCall('POST', `/v1/ops/finance/withdrawals/${w1.id}/reject`, finance, { reason: 'Account name does not match' }));
    e = data(await call('GET', '/v1/drivers/me/earnings', d)) as never;
    assert.deepEqual([e.balanceKobo, e.setAsideKobo], [ride.fare, 0], 'rejected: the money is back');

    const w2 = data(await call('POST', '/v1/drivers/me/withdrawals', d, { amountKobo: 200_000 }), 201) as unknown as { id: string };
    assert.equal(await submitPayout(tdb.db, gateway, w2.id), 'skipped', 'never sent before approval');
    data(await staffCall('POST', `/v1/ops/finance/withdrawals/${w2.id}/approve`, finance, {}));
    assert.equal((await staffCall('POST', `/v1/ops/finance/withdrawals/${w2.id}/approve`, finance, {})).statusCode, 409);
    const before = sim.calls.createTransfer;
    assert.equal(await submitPayout(tdb.db, gateway, w2.id), 'submitted');
    assert.equal(await submitPayout(tdb.db, gateway, w2.id), 'skipped', 'a second run sends nothing');
    assert.equal(sim.calls.createTransfer, before + 1);
    assert.equal(await checkPayout(tdb.db, gateway, w2.id), 'submitted');
    const ref = (await tdb.db.query<{ reference: string }>(`select reference from app.withdrawals where id = $1`, [w2.id])).rows[0]!.reference;
    transfers.set(ref, 'successful');
    assert.equal(await checkPayout(tdb.db, gateway, w2.id), 'paid');
    assert.equal(await checkPayout(tdb.db, gateway, w2.id), 'skipped');
    e = data(await call('GET', '/v1/drivers/me/earnings', d)) as never;
    assert.deepEqual([e.balanceKobo, e.setAsideKobo], [ride.fare - 200_000, 0]);

    // A transfer the provider fails: the money returns to earnings.
    const w3 = data(await call('POST', '/v1/drivers/me/withdrawals', d, { amountKobo: 100_000 }), 201) as unknown as { id: string };
    data(await staffCall('POST', `/v1/ops/finance/withdrawals/${w3.id}/approve`, finance, {}));
    assert.equal(await submitPayout(tdb.db, gateway, w3.id), 'submitted');
    transfers.set((await tdb.db.query<{ reference: string }>(`select reference from app.withdrawals where id = $1`, [w3.id])).rows[0]!.reference, 'failed');
    assert.equal(await checkPayout(tdb.db, gateway, w3.id), 'failed');
    e = data(await call('GET', '/v1/drivers/me/earnings', d)) as never;
    assert.deepEqual([e.balanceKobo, e.setAsideKobo], [ride.fare - 200_000, 0]);

    // The provider times out after we sent it: marked unknown, and never sent again.
    const failing = createSimulatedGateway({ failNext: ['unknown_outcome'] });
    const w4 = data(await call('POST', '/v1/drivers/me/withdrawals', d, { amountKobo: 100_000 }), 201) as unknown as { id: string };
    data(await staffCall('POST', `/v1/ops/finance/withdrawals/${w4.id}/approve`, finance, {}));
    assert.equal(await submitPayout(tdb.db, failing, w4.id), 'unknown');
    assert.equal(await submitPayout(tdb.db, failing, w4.id), 'skipped');
    assert.equal(failing.calls.createTransfer, 1);
    assert.equal(await checkPayout(tdb.db, failing, w4.id), 'submitted', 'the lookup finds it');
  });

  test('refunds need two people; a driver pass starts only when the payment is verified', { skip }, async () => {
    const rider = await person('rider');
    const d = await driver();
    const ride = await finishedRide(rider, d);
    await fund(rider, ride.fare);
    const care = await addStaff(tdb.db, { roles: ['care'] });
    const fin = await addStaff(tdb.db, { roles: ['finance'] });
    const fin2 = await addStaff(tdb.db, { roles: ['finance'] });
    assert.equal((await staffCall('POST', '/v1/ops/finance/refunds', care, { rideId: ride.id, amountKobo: 50_000, reason: 'Driver took a longer route' })).statusCode, 409, 'not paid yet');
    data(await call('POST', `/v1/rides/${ride.id}/payment`, rider, { method: 'wallet' }));
    assert.equal((await staffCall('POST', '/v1/ops/finance/refunds', care, { rideId: ride.id, amountKobo: ride.fare + 100, reason: 'Driver took a longer route' })).json().error.code, 'REFUND_TOO_LARGE');
    const r = data(await staffCall('POST', '/v1/ops/finance/refunds', fin, { rideId: ride.id, amountKobo: 50_000, reason: 'Driver took a longer route' }), 201) as unknown as { id: string };
    assert.equal((await staffCall('POST', `/v1/ops/finance/refunds/${r.id}/approve`, care, {})).statusCode, 403, 'care can ask, not approve');
    assert.equal((await staffCall('POST', `/v1/ops/finance/refunds/${r.id}/approve`, fin, {})).json().error.code, 'SECOND_PERSON_REQUIRED');
    data(await staffCall('POST', `/v1/ops/finance/refunds/${r.id}/approve`, fin2, {}));
    assert.equal((await staffCall('POST', `/v1/ops/finance/refunds/${r.id}/approve`, fin2, {})).statusCode, 409);
    assert.equal((data(await call('GET', '/v1/wallet', rider)) as unknown as { balanceKobo: number }).balanceKobo, 50_000);

    const pass = data(await call('POST', '/v1/drivers/me/pass', d, { plan: 'daily', method: 'transfer' }), 201) as unknown as { reference: string; amountKobo: number };
    assert.equal(pass.amountKobo, PASS_PRICE.daily);
    const sub = async () => (data(await call('GET', `/v1/drivers/${d}/subscription`, d)) as unknown as { passes: unknown[] }).passes.length;
    assert.equal(await sub(), 0, 'not before payment');
    sim.simulatePayment(pass.reference, PASS_PRICE.daily);
    assert.equal(await settleCollection(tdb.db, gateway, pass.reference, Date.now()), 'credited');
    assert.equal(await settleCollection(tdb.db, gateway, pass.reference, Date.now()), 'credited');
    assert.equal(await sub(), 1);
  });

  test('the database itself refuses bad money: unbalanced, edited, duplicated or overdrawn', { skip }, async () => {
    const who = await person('rider');
    await assert.rejects(tdb.db.tx(async (tx) => {
      const j = (await tx.query<{ id: string }>(`insert into app.ledger_journals (kind, reference, description, actor_kind) values ('wallet_funding', 'raw-unbalanced', 'test', 'system') returning id`)).rows[0]!;
      await tx.query(`insert into app.ledger_entries (journal_id, account_kind, owner_id, amount_kobo) values ($1, 'passenger_wallet', $2, 1000)`, [j.id, who]);
    }), /does not balance/);
    await assert.rejects(tdb.db.query(`update app.ledger_entries set amount_kobo = amount_kobo + 1`), /append-only|cannot|forbid|not allowed/i);
    await assert.rejects(tdb.db.query(`delete from app.ledger_journals`), /append-only|cannot|forbid|not allowed/i);
    await assert.rejects(tdb.db.tx((tx) => postJournal(tx, { kind: 'trip_charge', reference: 'overdraw-1', description: 'test overdraw', actor: { kind: 'system', id: null }, lines: [{ account: 'passenger_wallet', ownerId: who, amount: -1 }, { account: 'company_revenue', amount: 1 }] })), /enough money/);
    await assert.rejects(tdb.db.tx((tx) => postJournal(tx, { kind: 'trip_charge', reference: 'lopsided', description: 'test lopsided', actor: { kind: 'system', id: null }, lines: [{ account: 'company_revenue', amount: 5 }] })), /balance/);
    const twice = await tdb.db.tx(async (tx) => {
      const a = await postJournal(tx, { kind: 'referral_reward', reference: 'once-only', description: 'test reward', actor: { kind: 'system', id: null }, lines: [{ account: 'passenger_wallet', ownerId: who, amount: 700 }, { account: 'promotions_expense', amount: -700 }] });
      const b = await postJournal(tx, { kind: 'referral_reward', reference: 'once-only', description: 'test reward', actor: { kind: 'system', id: null }, lines: [{ account: 'passenger_wallet', ownerId: who, amount: 700 }, { account: 'promotions_expense', amount: -700 }] });
      return [a.duplicate, b.duplicate, a.journalId === b.journalId];
    });
    assert.deepEqual(twice, [false, true, true]);
    const report = await integrity(tdb.db);
    assert.deepEqual(report, { ok: true, total: 0, unbalancedJournals: 0, balanceMismatches: 0, suspenseKobo: 0 }, 'after every test above, the books still add up');
    const s = data(await staffCall('GET', '/v1/ops/finance/summary', await addStaff(tdb.db, { roles: ['finance'] }))) as unknown as { integrity: { ok: boolean }; accounts: Record<string, number> };
    assert.equal(s.integrity.ok, true);
    assert.equal(Object.values(s.accounts).reduce((a, b) => a + b, 0), 0);
  });
});

describe('Paystack adapter (against a stand-in server, never the real one)', () => {
  const secret = `sk_test_${'k'.repeat(32)}`;
  const calls: { url: string; method: string; body: Record<string, unknown> | null; auth: string }[] = [];
  const replies: { status: number; json: unknown }[] = [];
  const g = paystackGateway({
    secretKey: secret,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization! });
      const r = replies.shift();
      if (!r) throw new Error('timeout');
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
    },
  });
  const customer = { id: 'u1', name: 'Ada Obi', email: 'ada@example.com' };

  test('starts a payment on Paystack’s own page, in kobo, with our reference', async () => {
    replies.push({ status: 200, json: { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'gbw-1' } } });
    const r = await g.initializeCollection({ reference: 'gbw-1', purpose: 'wallet_funding', amount: 500_000 as Kobo, customer, quoteId: 'q', channel: 'card' });
    assert.ok(r.ok && r.value.checkoutUrl === 'https://checkout.paystack.com/abc' && r.value.method === 'card');
    const c = calls.at(-1)!;
    assert.equal(c.url, 'https://api.paystack.co/transaction/initialize');
    assert.equal(c.auth, `Bearer ${secret}`);
    assert.deepEqual([c.body!.amount, c.body!.reference, c.body!.channels, c.body!.currency], [500_000, 'gbw-1', ['card'], 'NGN']);
    assert.equal((await g.initializeCollection({ reference: 'x', purpose: 'wallet_funding', amount: 1 as Kobo, customer: { id: 'u', name: 'N' }, quoteId: 'q' })).ok, false, 'an email is required');
    replies.push({ status: 200, json: { status: true, data: { authorization_url: 'https://evil.example/pay', reference: 'gbw-2' } } });
    const bad = await g.initializeCollection({ reference: 'gbw-2', purpose: 'wallet_funding', amount: 1 as Kobo, customer, quoteId: 'q' });
    assert.ok(!bad.ok && bad.error.code === 'bad_checkout_url', 'only Paystack’s own pages are accepted');
  });

  test('reads a payment’s real status; success with the amount and Paystack’s fee', async () => {
    replies.push({ status: 200, json: { status: true, data: { status: 'success', amount: 500_000, currency: 'NGN', fees: 7500, paid_at: '2026-11-27T10:00:00.000Z', id: 42, reference: 'gbw-1' } } });
    const ok = await g.verifyCollection('gbw-1');
    assert.ok(ok.ok);
    assert.deepEqual([ok.value.status, ok.value.amountReceived, ok.value.providerCharge, ok.value.providerTransactionId], ['successful', 500_000, 7500, '42']);
    assert.equal(calls.at(-1)!.url, 'https://api.paystack.co/transaction/verify/gbw-1');
    for (const [theirs, ours] of [['abandoned', 'abandoned'], ['failed', 'failed'], ['ongoing', 'pending'], ['reversed', 'reversed']] as const) {
      replies.push({ status: 200, json: { status: true, data: { status: theirs, amount: 500_000, currency: 'NGN', reference: 'gbw-1' } } });
      const r = await g.verifyCollection('gbw-1');
      assert.ok(r.ok && r.value.status === ours && r.value.amountReceived === 0, theirs);
    }
    replies.push({ status: 404, json: { status: false, message: 'Transaction reference not found' } });
    const nf = await g.verifyCollection('nope');
    assert.ok(!nf.ok && nf.error.code === 'not_found');
  });

  test('payouts: a timeout after sending is "unknown", never "try again"; OTP mode is refused', async () => {
    replies.push({ status: 200, json: { status: true, data: { recipient_code: 'RCP_1' } } });
    const lost = await g.createTransfer({ reference: 'gbx-0000000000000001', amount: 100_000 as Kobo, bankAccount: { bankCode: '058', accountNumber: '0123456789', accountName: 'Ada Obi' }, narration: 'GoBye driver earnings' });
    assert.ok(!lost.ok && lost.error.class === 'unknown_outcome');
    replies.push({ status: 200, json: { status: true, data: { recipient_code: 'RCP_1' } } }, { status: 200, json: { status: true, data: { status: 'otp', amount: 100_000 } } });
    const otp = await g.createTransfer({ reference: 'gbx-0000000000000002', amount: 100_000 as Kobo, bankAccount: { bankCode: '058', accountNumber: '0123456789', accountName: 'Ada Obi' }, narration: 'n' });
    assert.ok(!otp.ok && otp.error.code === 'otp_required');
    replies.push({ status: 200, json: { status: true, data: { recipient_code: 'RCP_1' } } }, { status: 200, json: { status: true, data: { status: 'pending', amount: 100_000 } } });
    const sent = await g.createTransfer({ reference: 'gbx-0000000000000003', amount: 100_000 as Kobo, bankAccount: { bankCode: '058', accountNumber: '0123456789', accountName: 'Ada Obi' }, narration: 'n' });
    assert.ok(sent.ok && sent.value.status === 'processing');
    assert.deepEqual([calls.at(-1)!.body!.reference, calls.at(-1)!.body!.recipient, calls.at(-1)!.body!.source], ['gbx-0000000000000003', 'RCP_1', 'balance']);
    replies.push({ status: 200, json: { status: true, data: { status: 'success', amount: 100_000, fee_charged: 1000 } } });
    const done = await g.getTransfer('gbx-0000000000000003');
    assert.ok(done.ok && done.value.status === 'successful' && done.value.providerCharge === 1000);
  });

  test('webhooks: only a correct HMAC-SHA512 signature over the exact bytes is accepted', () => {
    const rawBody = JSON.stringify({ event: 'charge.success', data: { id: 42, reference: 'gbw-1', amount: 500_000 } });
    const sig = createHmac('sha512', secret).update(rawBody).digest('hex');
    const ok = g.parseWebhook({ rawBody, headers: { 'x-paystack-signature': sig } });
    assert.ok(ok.ok && ok.value.type === 'collection.successful' && ok.value.reference === 'gbw-1' && ok.value.eventId === 'charge.success:42');
    assert.equal(g.parseWebhook({ rawBody: rawBody.replace('500000', '900000'), headers: { 'x-paystack-signature': sig } }).ok, false, 'a changed body');
    assert.equal(g.parseWebhook({ rawBody, headers: {} }).ok, false, 'no signature');
    assert.equal(g.parseWebhook({ rawBody, headers: { 'x-paystack-signature': createHmac('sha512', 'other').update(rawBody).digest('hex') } }).ok, false, 'another key');
    assert.equal(g.parseWebhook({ rawBody, headers: { 'x-paystack-signature': 'zz' } }).ok, false);
  });
});
