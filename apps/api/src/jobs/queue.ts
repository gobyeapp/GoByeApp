import type { Querier } from '../database/database';

/**
 * Durable jobs on PostgreSQL (BACKEND_ARCHITECTURE.md §10). No Redis: at GoBye's launch volume (well under
 * 100 jobs/second) a table with FOR UPDATE SKIP LOCKED is enough, survives restarts, and is backed up with
 * everything else. Revisit only with measured queue latency or lock contention.
 *
 * Guarantees:
 * - at-least-once execution; handlers must be idempotent (every job has a business idempotency key, and
 *   the same key is never enqueued twice);
 * - a crashed worker's job is picked up again when its lease expires;
 * - retries back off exponentially with jitter, up to max_attempts, then the job is `failed` and visible
 *   to staff (Automation Centre) for a protected manual retry.
 */

export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
}

export interface EnqueueInput {
  kind: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
}

/** Adds a job. Returns false when a job with the same idempotency key already exists (no duplicate). */
export async function enqueue(q: Querier, j: EnqueueInput): Promise<{ created: boolean; id: string }> {
  const r = await q.query<{ id: string; created: boolean }>(
    `with ins as (
       insert into ops.jobs (kind, payload, idempotency_key, run_at, max_attempts)
       values ($1, $2::jsonb, $3, coalesce($4, now()), coalesce($5, 5))
       on conflict (idempotency_key) do nothing
       returning id)
     select id, true as created from ins
     union all
     select id, false from ops.jobs where idempotency_key = $3 and not exists (select 1 from ins)`,
    [j.kind, JSON.stringify(j.payload ?? {}), j.idempotencyKey, j.runAt ?? null, j.maxAttempts ?? null],
  );
  return r.rows[0]!;
}

/** Claims up to `limit` ready jobs (or jobs whose lease expired) for this worker. */
export async function claim(q: Querier, workerId: string, limit: number, leaseSeconds: number): Promise<Job[]> {
  // A job whose worker died on its last allowed attempt (crash, out of memory) stops here instead of
  // being reclaimed for ever.
  await q.query(
    `update ops.jobs
        set status = 'failed', last_error = 'The worker stopped responding during the last allowed attempt',
            locked_by = null, locked_until = null, finished_at = now()
      where status = 'running' and locked_until < now() and attempts >= max_attempts`,
  );
  const r = await q.query<Job>(
    `update ops.jobs j
        set status = 'running', locked_by = $1, locked_until = now() + make_interval(secs => $3), attempts = j.attempts + 1
      where j.id in (
        select id from ops.jobs
         where (status = 'queued' and run_at <= now())
            or (status = 'running' and locked_until < now() and attempts < max_attempts)
         order by run_at
         for update skip locked
         limit $2)
      returning j.id, j.kind, j.payload, j.idempotency_key, j.attempts, j.max_attempts`,
    [workerId, limit, leaseSeconds],
  );
  return r.rows;
}

export async function complete(q: Querier, id: string, workerId: string, result: unknown): Promise<boolean> {
  const r = await q.query(
    `update ops.jobs set status = 'succeeded', result = $3::jsonb, locked_by = null, locked_until = null, finished_at = now(), last_error = null
      where id = $1 and locked_by = $2 and status = 'running'`,
    [id, workerId, JSON.stringify(result ?? null)],
  );
  return (r.rowCount ?? 0) === 1;
}

/** Exponential backoff with full jitter: base 5 s, cap 15 min. */
export function backoffSeconds(attempt: number, rand: () => number = Math.random): number {
  const cap = Math.min(900, 5 * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.round(cap * (0.5 + rand() / 2)));
}

/**
 * Records a failure. Permanent failures (bad input) stop at once; transient ones retry until max_attempts.
 * The error text is truncated and must not contain personal data (handlers pass a safe summary).
 */
export async function fail(
  q: Querier,
  job: Pick<Job, 'id' | 'attempts' | 'max_attempts'>,
  workerId: string,
  error: string,
  permanent: boolean,
  opts: { notBeforeLeaseEnd?: boolean } = {},
): Promise<'retry' | 'failed'> {
  const final = permanent || job.attempts >= job.max_attempts;
  // After a timeout the first run may still be going: never start the retry before its lease would end.
  await q.query(
    `update ops.jobs
        set status = $3, last_error = left($4, 500), locked_by = null, locked_until = null,
            run_at = case when $3 = 'queued'
                          then greatest(now() + make_interval(secs => $5), case when $6 then coalesce(locked_until, now()) else now() end)
                          else run_at end,
            finished_at = case when $3 = 'failed' then now() else null end
      where id = $1 and locked_by = $2`,
    [job.id, workerId, final ? 'failed' : 'queued', error, backoffSeconds(job.attempts), !!opts.notBeforeLeaseEnd],
  );
  return final ? 'failed' : 'retry';
}

/**
 * Turns due schedules into jobs. Safe to call from every instance at once: each slot has one key
 * (`<schedule>:<slot start epoch>`), so duplicates are dropped by the unique index.
 */
export async function tickSchedules(q: Querier): Promise<number> {
  const r = await q.query<{ n: number }>(
    `with due as (
        select name, kind, payload, every_seconds, next_run_at
          from ops.job_schedules
         where enabled and next_run_at <= now()
         for update skip locked),
      advanced as (
        update ops.job_schedules s
           set next_run_at = due.next_run_at + make_interval(secs => due.every_seconds * (floor(extract(epoch from (now() - due.next_run_at)) / due.every_seconds) + 1))
          from due where s.name = due.name
        returning due.name, due.kind, due.payload, due.next_run_at),
      ins as (
        insert into ops.jobs (kind, payload, idempotency_key, run_at)
        select kind, payload, name || ':' || floor(extract(epoch from next_run_at))::bigint, now() from advanced
        on conflict (idempotency_key) do nothing
        returning 1)
     select count(*)::int as n from ins`,
  );
  return r.rows[0]?.n ?? 0;
}
