import type { JobHandler } from '../jobs/worker';
import type { Providers } from '../providers/ports';
import { integrity } from './ledger';
import { checkPayout, queuePayout, queueVerify, settleCollection, submitPayout } from './money.service';

/**
 * Money jobs (D-101). They only run when a payment provider is configured; without one they do nothing.
 * - payments.verify: look one payment up and credit it if it truly succeeded;
 * - payouts.submit / payouts.check: send an approved withdrawal once, then follow it to the end;
 * - money.sweep (every 5 min): catch anything a webhook missed;
 * - money.integrity (daily): the ledger must add up to zero and every balance must match its entries.
 */
export function moneyHandlers(o: { providers: Providers; walletEnabled: boolean }): Record<string, JobHandler> {
  const gateway = () => (o.walletEnabled ? o.providers.payments : null);
  return {
    'payments.verify': async (job, db) => {
      const reference = String(job.payload.reference ?? '');
      const out = await settleCollection(db, gateway(), reference, Date.now());
      if (out === 'pending' || out === 'provider_unavailable') return { ok: false, error: `still ${out}`, permanent: false };
      return { ok: true, result: { outcome: out } };
    },
    'payouts.submit': async (job, db) => {
      const id = String(job.payload.withdrawalId ?? '');
      const out = await submitPayout(db, gateway(), id);
      if (out === 'retry_later') return { ok: false, error: 'not sent yet', permanent: false };
      if (out === 'submitted' || out === 'unknown') await queuePayout(db, 'payouts.check', id, 60);
      return { ok: true, result: { outcome: out } };
    },
    'payouts.check': async (job, db) => {
      const out = await checkPayout(db, gateway(), String(job.payload.withdrawalId ?? ''));
      if (out === 'retry_later' || out === 'submitted' || out === 'unknown') return { ok: false, error: `still ${out}`, permanent: false };
      return { ok: true, result: { outcome: out } };
    },
    'money.sweep': async (_job, db) => {
      if (!gateway()) return { ok: true, result: { skipped: 'no payment provider' } };
      const pending = await db.query<{ reference: string }>(`select reference from app.collections where status = 'pending' and created_at < now() - interval '2 minutes' order by last_checked_at nulls first limit 100`);
      for (const c of pending.rows) await queueVerify(db, c.reference);
      const approved = await db.query<{ id: string }>(`select id from app.withdrawals where status = 'approved' limit 50`);
      for (const w of approved.rows) await queuePayout(db, 'payouts.submit', w.id);
      const flying = await db.query<{ id: string }>(`select id from app.withdrawals where status in ('submitted', 'unknown') limit 50`);
      for (const w of flying.rows) await queuePayout(db, 'payouts.check', w.id);
      return { ok: true, result: { collections: pending.rows.length, toSubmit: approved.rows.length, toCheck: flying.rows.length } };
    },
    'money.integrity': async (_job, db) => {
      const r = await integrity(db);
      if (r.ok) return { ok: true, result: r };
      await db.query(`insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data) values ('system', null, 'ledger integrity check', 'ledger.integrity_failed', 'ledger', 'all', 'The ledger does not add up: finance must look now', $1::jsonb)`, [JSON.stringify(r)]);
      return { ok: false, error: 'ledger integrity check failed', permanent: true };
    },
  };
}
