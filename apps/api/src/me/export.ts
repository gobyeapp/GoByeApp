import type { Querier } from '../database/database';

/**
 * A person's own data as one JSON document (NDPA 2023 right of access, Backend Phase 2 WP5, D-083).
 * Everything GoBye holds about them in its own tables, minus internal storage details. File contents are
 * not included (only what each file is and its state); a person asks support for copies.
 */
const SECTIONS: { name: string; sql: string; drop?: string[] }[] = [
  { name: 'profile', sql: `select to_jsonb(t) as r from app.users t where id = $1` },
  { name: 'rider', sql: `select to_jsonb(t) as r from app.riders t where user_id = $1` },
  { name: 'driver', sql: `select to_jsonb(t) as r from app.drivers t where user_id = $1` },
  { name: 'vehicles', sql: `select to_jsonb(t) as r from app.vehicles t where driver_id = $1 order by created_at` },
  { name: 'driverApplication', sql: `select to_jsonb(t) as r from app.driver_applications t where driver_id = $1`, drop: ['decided_by'] },
  { name: 'applicationHistory', sql: `select to_jsonb(t) as r from app.application_events t where driver_id = $1 order by id`, drop: ['actor_id'] },
  { name: 'driverPasses', sql: `select to_jsonb(t) as r from app.driver_pass_timelines t where driver_id = $1` },
  { name: 'driverPassPayments', sql: `select to_jsonb(t) as r from app.driver_pass_payments t where driver_id = $1 order by confirmed_at` },
  { name: 'ridesAsRider', sql: `select to_jsonb(t) as r from app.rides t where rider_id = $1 order by created_at desc limit 1000`, drop: ['driver_id'] },
  { name: 'ridesAsDriver', sql: `select to_jsonb(t) as r from app.rides t where driver_id = $1 order by created_at desc limit 1000`, drop: ['rider_id'] },
  { name: 'consents', sql: `select to_jsonb(t) as r from app.consents t where user_id = $1 order by accepted_at`, drop: ['ip_hash'] },
  { name: 'devices', sql: `select to_jsonb(t) as r from app.devices t where user_id = $1` },
  { name: 'accountDeletion', sql: `select to_jsonb(t) as r from app.account_deletions t where user_id = $1` },
  { name: 'whatsapp', sql: `select to_jsonb(t) as r from app.whatsapp_sessions t where user_id = $1` },
  { name: 'files', sql: `select to_jsonb(t) as r from ops.files t where owner_id = $1 and status <> 'deleted' order by created_at`, drop: ['bucket', 'object_key', 'sha256'] },
];

const SINGLE = new Set(['profile', 'rider', 'driver', 'driverApplication', 'driverPasses', 'accountDeletion']);

export async function exportPersonalData(q: Querier, userId: string, now: Date) {
  const out: Record<string, unknown> = { format: 'gobye-personal-data-v1', userId, generatedAt: now.toISOString() };
  for (const s of SECTIONS) {
    const rows = (await q.query<{ r: Record<string, unknown> }>(s.sql, [userId])).rows.map(({ r }) => {
      for (const k of s.drop ?? []) delete r[k];
      return r;
    });
    out[s.name] = SINGLE.has(s.name) ? (rows[0] ?? null) : rows;
  }
  return out;
}
