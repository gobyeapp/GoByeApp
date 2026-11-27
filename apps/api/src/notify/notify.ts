import { formatNaira, type Kobo } from '@gobye/core';
import type { Querier } from '../database/database';
import { enqueue } from '../jobs/queue';
import type { JobHandler } from '../jobs/worker';
import type { NotificationChannel, Providers } from '../providers/ports';
import { NotifyPermanentError } from '../providers/notify';

/**
 * Product notifications (D-103). A change that people should hear about adds a row and a job in the SAME
 * transaction as the change, so a message is never sent for something that was rolled back, and never
 * lost when the provider is down. The job finds the address at send time (push tokens, a confirmed
 * email) and skips quietly when there is none or the person turned that kind off.
 */
export async function notify(tx: Querier, m: { id: string; userId: string; channel: NotificationChannel; template: string; data?: Record<string, string> }) {
  const ins = await tx.query(`insert into ops.notifications (id, user_id, channel, template) values ($1, $2, $3, $4) on conflict (id) do nothing`, [m.id, m.userId, m.channel, m.template]);
  if (!ins.rowCount) return;
  await enqueue(tx, { kind: 'notify.send', payload: { id: m.id, data: m.data ?? {} }, idempotencyKey: `notify:${m.id}`, maxAttempts: 5 });
}

export const naira = (kobo: number | string | null) => formatNaira(Number(kobo ?? 0) as Kobo);

export function notifyHandlers(o: { providers: Providers }): Record<string, JobHandler> {
  return {
    'notify.send': async (job, db) => {
      const id = String(job.payload.id ?? '');
      const data = (job.payload.data ?? {}) as Record<string, string>;
      const n = (await db.query<{ user_id: string; channel: NotificationChannel; template: string; status: string }>(`select user_id, channel, template, status from ops.notifications where id = $1`, [id])).rows[0];
      if (!n || n.status !== 'queued') return { ok: true, result: { skipped: 'already handled' } };
      const done = (status: 'sent' | 'skipped' | 'failed', detail: string | null, provider: string | null = null) =>
        db.query(`update ops.notifications set status = $2, detail = $3, provider = $4, sent_at = case when $2 = 'sent' then now() end where id = $1`, [id, status, detail, provider]);
      const user = (await db.query<{ status: string; email: string | null; phone: string | null; email_receipts: boolean; email_verified_at: Date | null }>(`select status, email, phone, email_receipts, email_verified_at from app.users where id = $1`, [n.user_id])).rows[0];
      if (!user || user.status !== 'active') {
        await done('skipped', 'account not active');
        return { ok: true, result: { skipped: 'account not active' } };
      }
      let addresses: string[];
      if (n.channel === 'push') addresses = (await db.query<{ push_token: string }>(`select push_token from app.devices where user_id = $1 and push_token is not null order by last_seen desc limit 3`, [n.user_id])).rows.map((r) => r.push_token);
      else if (n.channel === 'email') addresses = user.email && user.email_verified_at && (n.template !== 'ride.receipt' || user.email_receipts) ? [user.email] : [];
      else addresses = user.phone ? [user.phone] : [];
      if (!addresses.length) {
        await done('skipped', n.channel === 'email' ? 'no confirmed email, or receipts are off' : 'no address');
        return { ok: true, result: { skipped: 'no address' } };
      }
      let sent = 0;
      let last = '';
      for (const [i, address] of addresses.entries()) {
        try {
          await o.providers.notifications.send({ id: addresses.length > 1 ? `${id}#${i}` : id, channel: n.channel, to: { userId: n.user_id, address }, template: n.template, data });
          sent += 1;
        } catch (e) {
          last = (e as Error).message.slice(0, 120);
          if (e instanceof NotifyPermanentError) {
            // A push token the provider no longer knows is forgotten, so we stop sending to it.
            if (e.invalidAddress && n.channel === 'push') await db.query(`update app.devices set push_token = null where user_id = $1 and push_token = $2`, [n.user_id, address]);
            continue;
          }
          if ((e as { code?: string }).code === 'NOT_CONFIGURED') {
            await done('skipped', 'channel not connected');
            return { ok: true, result: { skipped: 'channel not connected' } };
          }
          if (!sent) return { ok: false, error: last, permanent: false };
        }
      }
      await done(sent ? 'sent' : 'failed', sent ? null : last, o.providers.notifications.name.slice(0, 80));
      return { ok: true, result: { sent } };
    },
  };
}
