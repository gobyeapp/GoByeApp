import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffSeconds, claim, enqueue, tickSchedules } from '../src/jobs/queue';
import { defaultHandlers, runOnce, type JobHandler } from '../src/jobs/worker';
import { createTestDb, NO_DB_REASON, postgresAvailable, type TestDb } from './helpers';

/** Postgres job queue (BACKEND_ARCHITECTURE.md §10): no duplicates, no double claims, retries, recovery. */
describe('durable jobs', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    await tdb.db.query(`update ops.job_schedules set enabled = false`); // isolate from the built-in schedule
  });
  after(async () => {
    if (!skip) await tdb.drop();
  });
  const status = async (key: string) => (await tdb.db.query<{ status: string; attempts: number; last_error: string | null }>(`select status, attempts, last_error from ops.jobs where idempotency_key = $1`, [key])).rows[0]!;

  test('the same business event is enqueued once', { skip }, async () => {
    const a = await enqueue(tdb.db, { kind: 'ops.noop', idempotencyKey: 'noop:event-1' });
    const b = await enqueue(tdb.db, { kind: 'ops.noop', idempotencyKey: 'noop:event-1', payload: { different: true } });
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.id, b.id);
  });

  test('concurrent workers never claim the same job', { skip }, async () => {
    for (let i = 0; i < 20; i++) await enqueue(tdb.db, { kind: 'ops.noop', idempotencyKey: `noop:claim-${i}` });
    const batches = await Promise.all(['w1', 'w2', 'w3', 'w4'].map((w) => claim(tdb.db, w, 10, 60)));
    const ids = batches.flat().map((j) => j.id);
    assert.equal(ids.length, new Set(ids).size, 'no job claimed twice');
    assert.ok(ids.length >= 20);
    await tdb.db.query(`update ops.jobs set status = 'succeeded', locked_by = null, locked_until = null where status = 'running'`);
  });

  test('a successful handler completes the job and stores its result', { skip }, async () => {
    await enqueue(tdb.db, { kind: 'ops.noop', idempotencyKey: 'noop:ok', payload: { hello: 'world' } });
    assert.equal(await runOnce(tdb.db, defaultHandlers(), 'w-ok', { concurrency: 5 }), 1);
    const r = await tdb.db.query<{ status: string; result: unknown }>(`select status, result from ops.jobs where idempotency_key = 'noop:ok'`);
    assert.deepEqual(r.rows[0], { status: 'succeeded', result: { echoed: { hello: 'world' } } });
  });

  test('transient failures retry with backoff, then stop as failed after max_attempts', { skip }, async () => {
    let calls = 0;
    const flaky: Record<string, JobHandler> = { 'test.flaky': async () => { calls++; throw new Error('provider timeout'); } };
    await enqueue(tdb.db, { kind: 'test.flaky', idempotencyKey: 'flaky:1', maxAttempts: 3 });
    for (let i = 0; i < 3; i++) {
      await runOnce(tdb.db, flaky, 'w-flaky', { concurrency: 1 });
      await tdb.db.query(`update ops.jobs set run_at = now() where idempotency_key = 'flaky:1' and status = 'queued'`); // skip the wait
    }
    assert.equal(calls, 3);
    const s = await status('flaky:1');
    assert.deepEqual([s.status, s.attempts, s.last_error], ['failed', 3, 'provider timeout']);
    assert.ok(backoffSeconds(1, () => 0) >= 2 && backoffSeconds(1, () => 1) <= 5);
    assert.equal(backoffSeconds(20, () => 1), 900, 'capped at 15 minutes');
  });

  test('permanent failures stop at once; unknown kinds wait for a worker that knows them', { skip }, async () => {
    const bad: Record<string, JobHandler> = { 'test.bad_input': async () => ({ ok: false, error: 'Invalid payload', permanent: true }) };
    await enqueue(tdb.db, { kind: 'test.bad_input', idempotencyKey: 'bad:1' });
    await enqueue(tdb.db, { kind: 'test.unregistered', idempotencyKey: 'unknown:1' });
    await runOnce(tdb.db, bad, 'w-bad', { concurrency: 5 });
    assert.equal((await status('bad:1')).status, 'failed');
    const u = await status('unknown:1');
    assert.equal(u.status, 'queued', 'a rolling deploy must not fail a newer version\'s job for good');
    assert.match(u.last_error ?? '', /No handler registered/);
    // The new version's worker runs it.
    await tdb.db.query(`update ops.jobs set run_at = now() where idempotency_key = 'unknown:1'`);
    await runOnce(tdb.db, { 'test.unregistered': async () => ({ ok: true }) }, 'w-new', { concurrency: 5 });
    assert.equal((await status('unknown:1')).status, 'succeeded');
  });

  test('a job that keeps killing its worker stops after its allowed attempts', { skip }, async () => {
    await enqueue(tdb.db, { kind: 'ops.noop', idempotencyKey: 'noop:poison', maxAttempts: 2 });
    for (let i = 0; i < 2; i++) {
      const [j] = await claim(tdb.db, `w-dies-${i}`, 1, 60);
      assert.ok(j, `attempt ${i + 1} claimed`);
      await tdb.db.query(`update ops.jobs set locked_until = now() - interval '1 second' where id = $1`, [j.id]); // worker died
    }
    assert.equal((await claim(tdb.db, 'w-next', 5, 60)).length, 0);
    const s = await status('noop:poison');
    assert.deepEqual([s.status, s.attempts], ['failed', 2]);
    assert.match(s.last_error ?? '', /stopped responding/);
  });

  test("a crashed worker's job is picked up again when its lease expires", { skip }, async () => {
    await enqueue(tdb.db, { kind: 'ops.noop', idempotencyKey: 'noop:crash' });
    const [job] = await claim(tdb.db, 'w-crashed', 1, 60);
    assert.ok(job);
    assert.equal((await claim(tdb.db, 'w-other', 5, 60)).length, 0, 'still leased');
    await tdb.db.query(`update ops.jobs set locked_until = now() - interval '1 second' where id = $1`, [job.id]);
    await runOnce(tdb.db, defaultHandlers(), 'w-rescuer', { concurrency: 5 });
    const s = await status('noop:crash');
    assert.deepEqual([s.status, s.attempts], ['succeeded', 2]);
  });

  test('a slow handler is told to stop, and its retry waits until the first run\'s lease would end', { skip }, async () => {
    let aborted = false;
    const slow: Record<string, JobHandler> = { 'test.slow': (_j, _db, signal) => new Promise((r) => { signal.addEventListener('abort', () => (aborted = true)); setTimeout(() => r({ ok: true }), 500); }) };
    await enqueue(tdb.db, { kind: 'test.slow', idempotencyKey: 'slow:1' });
    await runOnce(tdb.db, slow, 'w-slow', { concurrency: 1, handlerTimeoutMs: 50, leaseSeconds: 120 });
    const s = await status('slow:1');
    assert.deepEqual([s.status, s.last_error], ['queued', 'Handler timed out']);
    assert.equal(aborted, true);
    const wait = await tdb.db.query<{ secs: number }>(`select extract(epoch from run_at - now())::int as secs from ops.jobs where idempotency_key = 'slow:1'`);
    assert.ok(wait.rows[0]!.secs >= 110, `retry not before the lease end (${wait.rows[0]!.secs}s)`);
  });

  test('schedules produce exactly one job per slot, even when many instances tick at once', { skip }, async () => {
    await tdb.db.query(`insert into ops.job_schedules (name, kind, every_seconds, next_run_at) values ('test.hourly', 'ops.noop', 3600, now() - interval '10 minutes')`);
    const created = await Promise.all(Array.from({ length: 8 }, () => tickSchedules(tdb.db)));
    assert.equal(created.reduce((a, b) => a + b, 0), 1);
    const next = await tdb.db.query<{ ahead: boolean }>(`select next_run_at > now() as ahead from ops.job_schedules where name = 'test.hourly'`);
    assert.equal(next.rows[0]!.ahead, true);
    assert.equal(await tickSchedules(tdb.db), 0, 'nothing more until the next slot');
  });

  test('housekeeping removes only expired idempotency records', { skip }, async () => {
    const hash = 'a'.repeat(64);
    await tdb.db.query(`insert into ops.idempotency_keys (scope, key, method, path, request_hash, expires_at) values ('system', 'expired-key-1', 'POST', '/x', $1, now() - interval '1 hour'), ('system', 'fresh-key-01', 'POST', '/x', $1, now() + interval '1 hour')`, [hash]);
    await enqueue(tdb.db, { kind: 'ops.idempotency_cleanup', idempotencyKey: 'cleanup:test' });
    await runOnce(tdb.db, defaultHandlers(), 'w-clean', { concurrency: 5 });
    const left = await tdb.db.query<{ key: string }>(`select key from ops.idempotency_keys where scope = 'system' order by key`);
    assert.deepEqual(left.rows.map((r) => r.key), ['fresh-key-01']);
  });
});
