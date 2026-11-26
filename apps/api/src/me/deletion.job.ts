import { DELETED_USER_NAME } from '@gobye/core';
import type { AppConfig } from '../config/config';
import type { JobHandler } from '../jobs/worker';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/**
 * Account deletion job `account.delete` (WP1). Runs when the grace period ends:
 * 1. stops if the person cancelled, or it already ran (idempotent);
 * 2. anonymises the person: name, email and phone removed, status `deleted`; devices removed.
 *    Trips, payments, consents and audit keep the id only, as the law requires (SECURITY_PRIVACY §9);
 * 3. removes the sign-in account through the Supabase Auth admin API when the worker has the
 *    service-role key. Without it the job still completes and records that the sign-in account remains.
 */
export function accountHandlers(o: { config: AppConfig; fetch?: FetchLike }): Record<string, JobHandler> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  return {
    'account.delete': async (job, db, signal) => {
      const userId = String(job.payload.userId ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, error: 'Bad user id in payload', permanent: true };

      const step1 = await db.tx(async (tx) => {
        const d = (await tx.query<{ status: string; scheduled_for: Date }>(`select status, scheduled_for from app.account_deletions where user_id = $1 for update`, [userId])).rows[0];
        if (!d || d.status === 'cancelled') return 'skip' as const;
        if (d.status === 'completed') return 'done' as const;
        if (d.scheduled_for.getTime() > Date.now() + 60_000) return 'early' as const;
        await tx.query(`update app.users set full_name = $2, email = null, phone = null, status = 'deleted', deleted_at = now() where id = $1 and status <> 'deleted'`, [userId, DELETED_USER_NAME]);
        await tx.query(`delete from app.devices where user_id = $1`, [userId]);
        await tx.query(
          `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data)
           values ('system', null, 'account deletion job', 'account.anonymised', 'user', $1, 'Anonymised the account after the grace period', '{}'::jsonb)`,
          [userId],
        );
        return 'anonymised' as const;
      });
      if (step1 === 'skip') return { ok: true, result: { skipped: 'cancelled or not requested' } };
      if (step1 === 'done') return { ok: true, result: { skipped: 'already completed' } };
      if (step1 === 'early') return { ok: false, error: 'Grace period not over yet', permanent: false };

      let authDeleted = false;
      const key = o.config.SUPABASE_SERVICE_ROLE_KEY;
      if (key && o.config.SUPABASE_URL) {
        const r = await f(`${o.config.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/admin/users/${userId}`, {
          method: 'DELETE',
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          signal,
        });
        if (!r.ok && r.status !== 404) return { ok: false, error: `Sign-in account removal failed (HTTP ${r.status})`, permanent: false };
        authDeleted = true;
      }
      await db.query(`update app.account_deletions set status = 'completed', completed_at = now(), auth_user_deleted = $2 where user_id = $1 and status = 'scheduled'`, [userId, authDeleted]);
      return { ok: true, result: { anonymised: true, authUserDeleted: authDeleted } };
    },
  };
}
