import { randomUUID } from 'node:crypto';
import { PASS_PRICE, type Kobo, type PassPlan, type PaymentGatewayAdapter } from '@gobye/core';
import type { Database, Querier } from '../database/database';
import { enqueue } from '../jobs/queue';
import { recordVerifiedPayment } from '../subscriptions/subscriptions.repository';
import { AppError, Errors } from '../common/errors';
import { postJournal, type Line } from './ledger';

/**
 * Money in and out (D-101). The rules that matter:
 * - a payment is credited only after OUR lookup with the provider says "successful" for the exact amount
 *   and currency we asked for. A webhook, a return page or the customer saying so is only a reason to look;
 * - one reference, one journal: crediting twice is impossible (unique in the database);
 * - a payout is marked "submitted" BEFORE the provider is called, and the same reference is never sent
 *   as a new transfer. When the outcome is unknown the only next step is a lookup.
 */

export const LIMITS = {
  depositMinKobo: 10_000, // ₦100
  depositMaxKobo: 50_000_000, // ₦500,000
  withdrawalMinKobo: 100_000, // ₦1,000
  collectionTtlMs: 60 * 60 * 1000,
  /** A pending payment is looked up at most this often when the app asks. */
  recheckMs: 8000,
} as const;

export interface CollectionRow {
  reference: string;
  user_id: string;
  purpose: 'wallet_funding' | 'package_purchase';
  method: 'transfer' | 'card';
  provider: string;
  amount_kobo: string;
  plan: PassPlan | null;
  status: 'pending' | 'credited' | 'failed' | 'investigate' | 'expired';
  instructions: { checkoutUrl?: string; account?: { bankName: string; accountNumber: string; accountName: string } };
  checks: number;
  last_checked_at: Date | null;
  created_at: Date;
  settled_at: Date | null;
  expires_at: Date;
  detail: string | null;
}

export const collectionView = (c: CollectionRow, simulated: boolean) => ({
  reference: c.reference,
  purpose: c.purpose,
  method: c.method,
  amountKobo: Number(c.amount_kobo),
  plan: c.plan,
  status: c.status,
  checkoutUrl: c.instructions.checkoutUrl ?? null,
  account: c.instructions.account ?? null,
  createdAt: c.created_at.toISOString(),
  expiresAt: c.expires_at.toISOString(),
  settledAt: c.settled_at?.toISOString() ?? null,
  simulated,
});

export const NO_PROVIDER = () => Errors.notConfigured('Payments');

/** Step 1 of a payment: our record, inside the caller's idempotent transaction. */
export async function createCollection(tx: Querier, p: { userId: string; purpose: CollectionRow['purpose']; method: CollectionRow['method']; amountKobo: number; plan?: PassPlan; provider: string; now: number }): Promise<CollectionRow> {
  const reference = `gb${p.purpose === 'wallet_funding' ? 'w' : 'p'}-${randomUUID()}`;
  const r = await tx.query<CollectionRow>(
    `insert into app.collections (reference, user_id, purpose, method, provider, amount_kobo, plan, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [reference, p.userId, p.purpose, p.method, p.provider, p.amountKobo, p.plan ?? null, new Date(p.now), new Date(p.now + LIMITS.collectionTtlMs)],
  );
  return r.rows[0]!;
}

/**
 * Step 2: ask the provider for payment instructions (its hosted page, or an account to pay into), once.
 * Runs outside any transaction: a slow provider must not hold a database connection.
 */
export async function initCollection(db: Database, gateway: PaymentGatewayAdapter, reference: string, returnUrl: string | undefined): Promise<CollectionRow> {
  const c = (await db.query<CollectionRow>(`select * from app.collections where reference = $1`, [reference])).rows[0];
  if (!c) throw Errors.notFound('Payment not found.');
  if (c.status !== 'pending' || c.instructions.checkoutUrl || c.instructions.account) return c;
  if (c.provider !== gateway.key) throw NO_PROVIDER();
  const u = (await db.query<{ full_name: string; email: string | null; phone: string | null }>(`select full_name, email, phone from app.users where id = $1`, [c.user_id])).rows[0]!;
  const r = await gateway.initializeCollection({
    reference: c.reference,
    purpose: c.purpose,
    amount: Number(c.amount_kobo) as Kobo,
    customer: { id: c.user_id, name: u.full_name, email: u.email ?? undefined, phone: u.phone ?? undefined },
    quoteId: c.reference,
    channel: c.method === 'card' ? 'card' : 'bank_transfer',
    returnUrl,
  });
  if (!r.ok) {
    if (r.error.code === 'email_required') throw Errors.validation({ email: 'Add an email address to your profile to pay this way.' });
    if (r.error.class === 'permanent') {
      await db.query(`update app.collections set status = 'failed', detail = $2, settled_at = now() where reference = $1 and status = 'pending'`, [reference, `init: ${r.error.code}`]);
      throw new AppError(502, 'PAYMENT_PROVIDER_REFUSED', 'We couldn’t start this payment. Try again.');
    }
    throw Errors.unavailable('The payment service is busy. Try again in a moment.');
  }
  const instructions = { ...(r.value.checkoutUrl ? { checkoutUrl: r.value.checkoutUrl } : {}), ...(r.value.account ? { account: r.value.account } : {}) };
  const out = await db.query<CollectionRow>(`update app.collections set instructions = $2::jsonb where reference = $1 and status = 'pending' returning *`, [reference, JSON.stringify(instructions)]);
  return out.rows[0] ?? c;
}

export type SettleOutcome = 'credited' | 'pending' | 'failed' | 'investigate' | 'expired' | 'unknown_reference' | 'provider_unavailable';

/**
 * Looks the payment up with the provider and, only if it truly succeeded for the right amount, credits
 * it. Safe to call any number of times, from the webhook, the app's poll and the background job at once.
 */
export async function settleCollection(db: Database, gateway: PaymentGatewayAdapter | null, reference: string, now: number): Promise<SettleOutcome> {
  const peek = (await db.query<CollectionRow>(`select * from app.collections where reference = $1`, [reference])).rows[0];
  if (!peek) return 'unknown_reference';
  if (peek.status !== 'pending') return peek.status;
  if (!gateway || gateway.key !== peek.provider) return 'provider_unavailable';

  const v = await gateway.verifyCollection(reference);
  const expired = now > peek.expires_at.getTime() + 60 * 60 * 1000;
  if (!v.ok) {
    await db.query(`update app.collections set checks = checks + 1, last_checked_at = $2 where reference = $1`, [reference, new Date(now)]);
    // "Not found" at the provider: the customer never opened the payment. It simply runs out.
    if (v.error.code === 'not_found' && expired) return mark(db, reference, 'expired', 'never paid');
    return v.error.class === 'permanent' && v.error.code !== 'not_found' ? 'provider_unavailable' : 'pending';
  }
  const pv = v.value;
  if (pv.reference !== reference) return mark(db, reference, 'investigate', `provider answered for another reference`);
  if (pv.status === 'pending') {
    await db.query(`update app.collections set checks = checks + 1, last_checked_at = $2 where reference = $1`, [reference, new Date(now)]);
    return expired ? mark(db, reference, 'expired', 'never paid') : 'pending';
  }
  if (pv.status !== 'successful') return mark(db, reference, 'failed', `provider status: ${pv.status}`);
  if (pv.currency !== 'NGN') return mark(db, reference, 'investigate', `received ${pv.currency}`);
  const amount = Number(peek.amount_kobo);
  if (pv.amountReceived !== amount) return mark(db, reference, 'investigate', `asked ${amount} kobo, received ${pv.amountReceived} kobo`);
  const charge = Math.max(0, Math.min(amount, pv.providerCharge ?? 0));

  if (peek.purpose === 'package_purchase') {
    // Recorded first and safe to repeat: if we stop between the two steps, the next run finishes the job.
    const pass = await recordVerifiedPayment(db, { paymentRef: reference, driverId: peek.user_id, plan: peek.plan!, amount: amount as Kobo, confirmedAt: pv.paidAt ?? now });
    if (!pass.ok) return mark(db, reference, 'investigate', `pass: ${pass.error}`);
  }

  return db.tx(async (tx) => {
    const c = (await tx.query<CollectionRow>(`select * from app.collections where reference = $1 for update`, [reference])).rows[0]!;
    if (c.status !== 'pending') return c.status;
    // The provider owes us (amount − its charge); GoBye absorbs the charge as a processing cost.
    const lines: Line[] = [
      c.purpose === 'wallet_funding' ? { account: 'passenger_wallet', ownerId: c.user_id, amount } : { account: 'company_revenue', amount },
      { account: 'provider_clearing', provider: c.provider, amount: -(amount - charge) },
      { account: 'processing_costs', amount: -charge },
    ];
    await postJournal(tx, {
      kind: c.purpose,
      reference,
      description: c.purpose === 'wallet_funding' ? 'Wallet top-up (verified with the provider)' : `Driver pass: ${c.plan} (verified with the provider)`,
      provider: c.provider,
      actor: { kind: 'provider', id: c.provider },
      links: { collection: reference },
      lines,
    });
    await tx.query(`update app.collections set status = 'credited', settled_at = $2, provider_txn_id = $3, provider_charge_kobo = $4, checks = checks + 1, last_checked_at = $2 where reference = $1`, [reference, new Date(now), pv.providerTransactionId ?? null, pv.providerCharge]);
    await tx.query(
      `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data)
       values ('provider', $1, $1, $2, 'collection', $3, $4, $5::jsonb)`,
      [c.provider, c.purpose === 'wallet_funding' ? 'wallet.funded' : 'pass.purchased', reference, c.purpose === 'wallet_funding' ? 'Wallet top-up credited after provider verification' : 'Driver pass paid and verified', JSON.stringify({ userId: c.user_id, amountKobo: amount, providerChargeKobo: charge, method: c.method, plan: c.plan })],
    );
    return 'credited' as const;
  });
}

async function mark(db: Database, reference: string, status: 'failed' | 'investigate' | 'expired', detail: string): Promise<SettleOutcome> {
  const r = await db.query(`update app.collections set status = $2, detail = $3, settled_at = now(), checks = checks + 1, last_checked_at = now() where reference = $1 and status = 'pending'`, [reference, status, detail]);
  if (r.rowCount && status === 'investigate') {
    await db.query(
      `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data)
       values ('system', null, 'payment verification', 'collection.needs_review', 'collection', $1, 'A payment did not match what was asked for and was NOT credited', $2::jsonb)`,
      [reference, JSON.stringify({ detail })],
    );
  }
  return status;
}

export const passPrice = (plan: PassPlan): number => PASS_PRICE[plan];

/* ---------- Withdrawals ---------- */

export interface WithdrawalRow {
  id: string;
  reference: string;
  driver_id: string;
  amount_kobo: string;
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  status: 'requested' | 'approved' | 'submitted' | 'unknown' | 'paid' | 'failed' | 'rejected';
  provider: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_reason: string | null;
  submitted_at: Date | null;
  settled_at: Date | null;
  failure_reason: string | null;
  created_at: Date;
}

export const withdrawalView = (w: WithdrawalRow, full = false) => ({
  id: w.id,
  amountKobo: Number(w.amount_kobo),
  status: w.status,
  bankName: w.bank_name,
  accountEnding: w.account_number.slice(-4),
  ...(full ? { accountNumber: w.account_number, accountName: w.account_name, driverId: w.driver_id, reference: w.reference, reviewedAt: w.reviewed_at?.toISOString() ?? null, reviewReason: w.review_reason } : {}),
  createdAt: w.created_at.toISOString(),
  settledAt: w.settled_at?.toISOString() ?? null,
  failureReason: w.status === 'failed' || w.status === 'rejected' ? (w.failure_reason ?? w.review_reason) : null,
});

/** Money goes back from "set aside" to the driver's earnings (rejected, or the transfer failed). */
export async function releaseWithdrawal(tx: Querier, w: WithdrawalRow, status: 'rejected' | 'failed', why: string, actor: { kind: 'staff' | 'system' | 'provider'; id: string | null }) {
  const amount = Number(w.amount_kobo);
  await postJournal(tx, {
    kind: 'withdrawal_release',
    reference: `wd:${w.id}`,
    description: status === 'rejected' ? 'Withdrawal rejected: money returned to earnings' : 'Withdrawal failed: money returned to earnings',
    actor,
    links: { withdrawalId: w.id },
    lines: [
      { account: 'driver_withdrawal_reserve', ownerId: w.driver_id, amount: -amount },
      { account: 'driver_earnings', ownerId: w.driver_id, amount },
    ],
  });
  await tx.query(`update app.withdrawals set status = $2, failure_reason = $3, settled_at = now() where id = $1`, [w.id, status, why.slice(0, 200)]);
}

export type PayoutOutcome = 'paid' | 'submitted' | 'unknown' | 'failed' | 'retry_later' | 'skipped';

/** Sends an approved withdrawal to the provider. See the rules at the top of this file. */
export async function submitPayout(db: Database, gateway: PaymentGatewayAdapter | null, id: string): Promise<PayoutOutcome> {
  if (!gateway) return 'retry_later';
  const w = await db.tx(async (tx) => {
    const row = (await tx.query<WithdrawalRow>(`select * from app.withdrawals where id = $1 for update`, [id])).rows[0];
    if (!row || row.status !== 'approved') return null;
    await tx.query(`update app.withdrawals set status = 'submitted', submitted_at = now(), provider = $2 where id = $1`, [id, gateway.key]);
    return row;
  });
  if (!w) return 'skipped';
  const r = await gateway.createTransfer({ reference: w.reference, amount: Number(w.amount_kobo) as Kobo, bankAccount: { bankCode: w.bank_code, accountNumber: w.account_number, accountName: w.account_name }, narration: 'GoBye driver earnings' });
  if (r.ok) return applyTransfer(db, { ...w, status: 'submitted', provider: gateway.key }, r.value);
  if (r.error.class === 'unknown_outcome') {
    await db.query(`update app.withdrawals set status = 'unknown' where id = $1 and status = 'submitted'`, [id]);
    return 'unknown';
  }
  if (r.error.class === 'transient') {
    // Definitely not sent: it may be tried again later with the same reference.
    await db.query(`update app.withdrawals set status = 'approved' where id = $1 and status = 'submitted'`, [id]);
    return 'retry_later';
  }
  await db.tx(async (tx) => {
    const row = (await tx.query<WithdrawalRow>(`select * from app.withdrawals where id = $1 for update`, [id])).rows[0]!;
    if (row.status === 'submitted') await releaseWithdrawal(tx, row, 'failed', r.error.code, { kind: 'provider', id: gateway.key });
  });
  return 'failed';
}

/** Asks the provider what happened to a transfer we sent (or may have sent). */
export async function checkPayout(db: Database, gateway: PaymentGatewayAdapter | null, id: string): Promise<PayoutOutcome> {
  const w = (await db.query<WithdrawalRow>(`select * from app.withdrawals where id = $1`, [id])).rows[0];
  if (!w || !['submitted', 'unknown'].includes(w.status)) return 'skipped';
  if (!gateway || gateway.key !== w.provider) return 'retry_later';
  const r = await gateway.getTransfer(w.reference);
  if (r.ok) return applyTransfer(db, w, r.value);
  if (r.error.code === 'not_found' && w.status === 'unknown' && w.submitted_at && Date.now() - w.submitted_at.getTime() > 15 * 60 * 1000) {
    // The provider has no record after 15 minutes: it never arrived. Sending again with the SAME reference is safe.
    await db.query(`update app.withdrawals set status = 'approved' where id = $1 and status = 'unknown'`, [id]);
    return 'retry_later';
  }
  return 'retry_later';
}

async function applyTransfer(db: Database, w: WithdrawalRow, t: { status: 'processing' | 'successful' | 'failed' | 'reversed'; amount: number; providerCharge: number | null; failureReason?: string }): Promise<PayoutOutcome> {
  if (t.status === 'processing') {
    await db.query(`update app.withdrawals set status = 'submitted' where id = $1 and status = 'unknown'`, [w.id]);
    return 'submitted';
  }
  return db.tx(async (tx) => {
    const row = (await tx.query<WithdrawalRow>(`select * from app.withdrawals where id = $1 for update`, [w.id])).rows[0]!;
    if (!['submitted', 'unknown'].includes(row.status)) return 'skipped' as const;
    const amount = Number(row.amount_kobo);
    if (t.status === 'successful') {
      if (t.amount !== amount) {
        await tx.query(`update app.withdrawals set failure_reason = $2 where id = $1`, [w.id, `provider paid ${t.amount} kobo, expected ${amount}`]);
        await tx.query(`insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data) values ('system', null, 'payout check', 'withdrawal.needs_review', 'withdrawal', $1, 'The provider paid a different amount; left for finance', $2::jsonb)`, [w.id, JSON.stringify({ expected: amount, paid: t.amount })]);
        return 'unknown' as const;
      }
      const charge = Math.max(0, t.providerCharge ?? 0);
      await postJournal(tx, {
        kind: 'withdrawal_payout',
        reference: `wd:${row.id}`,
        description: 'Driver earnings paid out',
        provider: row.provider!,
        actor: { kind: 'provider', id: row.provider },
        links: { withdrawalId: row.id },
        lines: [
          { account: 'driver_withdrawal_reserve', ownerId: row.driver_id, amount: -amount },
          { account: 'provider_clearing', provider: row.provider!, amount: amount + charge },
          { account: 'processing_costs', amount: -charge },
        ],
      });
      await tx.query(`update app.withdrawals set status = 'paid', settled_at = now() where id = $1`, [row.id]);
      await tx.query(`insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data) values ('provider', $1, $1, 'withdrawal.paid', 'withdrawal', $2, 'Driver withdrawal paid', $3::jsonb)`, [row.provider, row.id, JSON.stringify({ driverId: row.driver_id, amountKobo: amount, providerChargeKobo: charge })]);
      return 'paid' as const;
    }
    await releaseWithdrawal(tx, row, 'failed', t.failureReason ?? `provider status: ${t.status}`, { kind: 'provider', id: row.provider });
    return 'failed' as const;
  });
}

export const queueVerify = (q: Querier, reference: string, delaySeconds = 0) =>
  enqueue(q, { kind: 'payments.verify', payload: { reference }, idempotencyKey: `payments.verify:${reference}:${Math.floor(Date.now() / 60_000)}`, runAt: new Date(Date.now() + delaySeconds * 1000), maxAttempts: 8 });
export const queuePayout = (q: Querier, kind: 'payouts.submit' | 'payouts.check', id: string, delaySeconds = 0) =>
  enqueue(q, { kind, payload: { withdrawalId: id }, idempotencyKey: `${kind}:${id}:${Math.floor(Date.now() / 60_000)}`, runAt: new Date(Date.now() + delaySeconds * 1000), maxAttempts: 8 });
