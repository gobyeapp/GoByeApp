import {
  buildTimeline,
  recordPassPayment,
  voidPass,
  type Kobo,
  type PassPayment,
  type PassVoid,
  type SubscriptionState,
  type SubscriptionWrite,
} from '@gobye/core';
import type { Database, Querier } from '../database/database';

/**
 * Driver pass timeline storage (D-058). The database stores only the inputs (verified payments, voids)
 * and a version; the timeline itself is always `buildTimeline()` from packages/core, the same function the
 * Driver App and the admin use. Writes:
 * - lock the driver's timeline row (SELECT … FOR UPDATE), so simultaneous payments for one driver queue;
 * - apply the core rule with `expectedVersion` (refuses stale writes, ignores duplicate payment refs);
 * - insert the new row and bump the version in the same transaction.
 * There is no HTTP write endpoint in Phase 1: the payment verification job will call `recordVerifiedPayment`
 * once a provider is connected (never a client, never a webhook alone).
 */

const ms = (d: Date | string) => new Date(d).getTime();

export async function loadState(q: Querier, driverId: string, lock = false): Promise<SubscriptionState | null> {
  const head = await q.query<{ version: number }>(`select version from app.driver_pass_timelines where driver_id = $1${lock ? ' for update' : ''}`, [driverId]);
  if (!head.rows[0]) return null;
  const pays = await q.query<{ payment_ref: string; plan: 'daily' | 'monthly'; amount_kobo: string; confirmed_at: Date }>(
    `select payment_ref, plan, amount_kobo, confirmed_at from app.driver_pass_payments where driver_id = $1 order by confirmed_at, payment_ref`,
    [driverId],
  );
  const voids = await q.query<{ payment_ref: string; kind: PassVoid['kind']; at: Date; reason: string; by_actor: string }>(
    `select v.payment_ref, v.kind, v.at, v.reason, v.by_actor from app.driver_pass_voids v join app.driver_pass_payments p using (payment_ref) where p.driver_id = $1`,
    [driverId],
  );
  const payments: PassPayment[] = pays.rows.map((r) => ({ paymentRef: r.payment_ref, driverId, plan: r.plan, amount: Number(r.amount_kobo) as Kobo, confirmedAt: ms(r.confirmed_at) }));
  const v: PassVoid[] = voids.rows.map((r) => ({ paymentRef: r.payment_ref, kind: r.kind, at: ms(r.at), reason: r.reason, by: r.by_actor }));
  return { driverId, version: head.rows[0].version, payments, voids: v, passes: buildTimeline(payments, v) };
}

/** Reads the whole timeline from one snapshot, so version, payments and voids always agree. */
export async function readTimeline(db: Database, driverId: string): Promise<SubscriptionState | null> {
  return db.tx((tx) => loadState(tx, driverId), { isolation: 'repeatable read' });
}

export type WriteOutcome = { ok: true; duplicate: boolean; state: SubscriptionState } | { ok: false; error: string; message: string };

/** Records a provider-verified pass payment. Safe to call twice for the same reference (no extra time). */
export async function recordVerifiedPayment(db: Database, p: PassPayment, source: 'provider_verification' | 'legacy_migration' | 'manual_correction' = 'provider_verification'): Promise<WriteOutcome> {
  return db.tx(async (tx) => {
    await tx.query(`insert into app.driver_pass_timelines (driver_id) values ($1) on conflict (driver_id) do nothing`, [p.driverId]);
    const state = (await loadState(tx, p.driverId, true))!;
    // Provider references are unique across all drivers: one used for someone else is refused, not stored.
    const owner = await tx.query<{ driver_id: string }>(`select driver_id from app.driver_pass_payments where payment_ref = $1`, [p.paymentRef]);
    if (owner.rows[0] && owner.rows[0].driver_id !== p.driverId) return { ok: false, error: 'wrong_driver', message: 'This payment reference belongs to another driver.' };
    const r: SubscriptionWrite = recordPassPayment(state, p, { expectedVersion: state.version });
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    if (!r.duplicate) {
      await tx.query(
        `insert into app.driver_pass_payments (payment_ref, driver_id, plan, amount_kobo, confirmed_at, source) values ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6)`,
        [p.paymentRef, p.driverId, p.plan, p.amount, p.confirmedAt, source],
      );
      await tx.query(`update app.driver_pass_timelines set version = version + 1 where driver_id = $1`, [p.driverId]);
    }
    return { ok: true, duplicate: r.duplicate, state: { ...r.state, version: r.duplicate ? state.version : state.version + 1 } };
  });
}

/** Cancels, refunds or records a reversal. Keeps history; never extends access. Idempotent per payment. */
export async function recordVoid(db: Database, driverId: string, v: PassVoid): Promise<WriteOutcome> {
  return db.tx(async (tx) => {
    const state = await loadState(tx, driverId, true);
    if (!state) return { ok: false, error: 'unknown_payment', message: 'No pass for this payment.' };
    const r = voidPass(state, v, { expectedVersion: state.version });
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    if (!r.duplicate) {
      await tx.query(`insert into app.driver_pass_voids (payment_ref, kind, at, reason, by_actor) values ($1, $2, to_timestamp($3 / 1000.0), $4, $5)`, [v.paymentRef, v.kind, v.at, v.reason, v.by]);
      await tx.query(`update app.driver_pass_timelines set version = version + 1 where driver_id = $1`, [driverId]);
    }
    return { ok: true, duplicate: r.duplicate, state: { ...r.state, version: r.duplicate ? state.version : state.version + 1 } };
  });
}
