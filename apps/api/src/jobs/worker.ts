import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Database, Querier } from '../database/database';
import { claim, complete, fail, tickSchedules, type Job } from './queue';

/** A handler's outcome. Throwing counts as transient; return `{ permanent: true }` for bad input. */
export type JobOutcome = { ok: true; result?: unknown } | { ok: false; error: string; permanent: boolean };
/** `signal` is aborted when the handler times out: long handlers should stop at their next step. */
export type JobHandler = (job: Job, db: Database, signal: AbortSignal) => Promise<JobOutcome>;

/**
 * Registered handlers. Only workflows that move no money and contact nobody are registered in Phase 1.
 * Financial workflows from the Automation Centre registry (packages/core/src/automation) stay
 * `not_connected` until the ledger, reconciliation, provider and security reviews are done.
 */
export function defaultHandlers(): Record<string, JobHandler> {
  return {
    'ops.idempotency_cleanup': async (_job, db) => {
      const r = await db.query(`delete from ops.idempotency_keys where expires_at < now()`);
      return { ok: true, result: { deleted: r.rowCount ?? 0 } };
    },
    'ops.noop': async (job) => ({ ok: true, result: { echoed: job.payload } }),
  };
}

export interface WorkerOptions {
  pollMs: number;
  concurrency: number;
  leaseSeconds?: number;
  handlerTimeoutMs?: number;
  log?: (msg: string, meta: object) => void;
}

/** One pass: run schedules, claim, execute, record. Returns how many jobs ran (tests call this directly). */
export async function runOnce(db: Database, handlers: Record<string, JobHandler>, workerId: string, o: Pick<WorkerOptions, 'concurrency' | 'leaseSeconds' | 'handlerTimeoutMs' | 'log'>): Promise<number> {
  await tickSchedules(db);
  const jobs = await claim(db as Querier, workerId, o.concurrency, o.leaseSeconds ?? 60);
  await Promise.all(
    jobs.map(async (job) => {
      const handler = handlers[job.kind];
      let outcome: JobOutcome;
      let timedOut = false;
      // Unknown kind: probably a newer version's job picked up during a rolling deploy. Retry later
      // (with backoff) rather than failing it for good; it fails only after max_attempts.
      if (!handler) outcome = { ok: false, error: `No handler registered for ${job.kind} on this worker version`, permanent: false };
      else {
        let timer: NodeJS.Timeout | undefined;
        const ctrl = new AbortController();
        try {
          const timeout = new Promise<JobOutcome>((resolve) => (timer = setTimeout(() => { timedOut = true; ctrl.abort(); resolve({ ok: false, error: 'Handler timed out', permanent: false }); }, o.handlerTimeoutMs ?? 30_000)));
          outcome = await Promise.race([handler(job, db, ctrl.signal), timeout]);
        } catch (e) {
          outcome = { ok: false, error: (e as Error).message ?? 'Handler error', permanent: false };
        } finally {
          clearTimeout(timer);
        }
      }
      if (outcome.ok) {
        await complete(db, job.id, workerId, outcome.result);
        o.log?.('job.succeeded', { jobId: job.id, kind: job.kind, attempt: job.attempts });
      } else {
        const r = await fail(db, job, workerId, outcome.error, outcome.permanent, { notBeforeLeaseEnd: timedOut });
        o.log?.(r === 'failed' ? 'job.failed' : 'job.retry', { jobId: job.id, kind: job.kind, attempt: job.attempts });
      }
    }),
  );
  return jobs.length;
}

/** Long-running loop with graceful stop (SIGTERM from the host during deploys). */
export function startWorker(db: Database, handlers: Record<string, JobHandler>, o: WorkerOptions) {
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  const loop = async () => {
    if (stopping) return;
    running = (async () => {
      try {
        const n = await runOnce(db, handlers, workerId, o);
        timer = setTimeout(loop, n ? 0 : o.pollMs);
      } catch (e) {
        o.log?.('worker.error', { message: (e as Error).message });
        timer = setTimeout(loop, o.pollMs * 2);
      }
    })();
  };
  timer = setTimeout(loop, 0);
  return {
    workerId,
    async stop() {
      stopping = true;
      clearTimeout(timer);
      await running;
    },
  };
}
