import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { MIGRATIONS_DIR } from '../src/app.factory';
import { loadMigrations, migrate, MIGRATION_LOCK_KEY, plan, readApplied, schemaIsCurrent } from '../src/database/migrations';
import { addStaff, addUser, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type TestDb } from './helpers';

/** Migration runner safety and the constraints the schema enforces on its own. */
describe('migrations and schema', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  const client = () => new Client({ connectionString: tdb.url });
  before(async () => {
    if (!skip) tdb = await createTestDb({ migrate: false });
  });
  after(async () => {
    if (!skip) await tdb.drop();
  });

  test('migration files are well named, ordered and fingerprinted', () => {
    const files = loadMigrations(MIGRATIONS_DIR);
    assert.ok(files.length >= 5);
    assert.deepEqual(files.map((f) => f.version), [...files.map((f) => f.version)].sort());
    for (const f of files) assert.match(f.checksum, /^[0-9a-f]{64}$/);
  });

  test('a no-transaction migration must hold exactly one statement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gobye-notx-'));
    writeFileSync(join(dir, '0001_two_indexes.sql'), '-- gobye:no-transaction\ncreate index concurrently a on t (x);\ncreate index concurrently b on t (y);\n');
    assert.throws(() => loadMigrations(dir), /exactly one statement/);
    writeFileSync(join(dir, '0001_two_indexes.sql'), "-- gobye:no-transaction\n-- comment; with a semicolon\ncreate index concurrently a on t (x) where note <> 'a;b';\n");
    assert.equal(loadMigrations(dir)[0]!.transactional, false);
  });

  test('a fresh database migrates; running again changes nothing', { skip }, async () => {
    const c = client();
    await c.connect();
    const files = loadMigrations(MIGRATIONS_DIR);
    assert.equal(await schemaIsCurrent(c, files), false);
    const first = await migrate(c, files);
    assert.equal(first.applied.length, files.length);
    const again = await migrate(c, files);
    assert.deepEqual(again, { applied: [], skipped: files.length });
    assert.equal(await schemaIsCurrent(c, files), true);
    await c.end();
  });

  test('an edited applied migration is refused', { skip }, async () => {
    const c = client();
    await c.connect();
    const files = loadMigrations(MIGRATIONS_DIR).map((f, i) => (i === 1 ? { ...f, checksum: 'f'.repeat(64) } : f));
    await assert.rejects(migrate(c, files), /was edited after it was applied/);
    const p = plan(files, await readApplied(c));
    assert.equal(p.problems.length, 1);
    await c.end();
  });

  test('a failing migration is rolled back completely and not recorded', { skip }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gobye-mig-'));
    for (const f of loadMigrations(MIGRATIONS_DIR)) writeFileSync(join(dir, `${f.version}_${f.name}.sql`), readFileSync(join(MIGRATIONS_DIR, `${f.version}_${f.name}.sql`)));
    writeFileSync(join(dir, '9001_half_done.sql'), 'create table app.half_done (id int);\nselect 1/0;');
    const c = client();
    await c.connect();
    await assert.rejects(migrate(c, loadMigrations(dir)), /9001_half_done failed and was rolled back/);
    assert.equal((await c.query(`select to_regclass('app.half_done') as t`)).rows[0].t, null);
    assert.equal((await c.query(`select count(*)::int as n from ops.schema_migrations where version = '9001'`)).rows[0].n, 0);
    await c.end();
  });

  test('two deploys cannot migrate at once (advisory lock)', { skip }, async () => {
    const holder = client();
    await holder.connect();
    await holder.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    const other = client();
    await other.connect();
    await assert.rejects(migrate(other, loadMigrations(MIGRATIONS_DIR)), /Another migration is running/);
    await holder.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    await holder.end();
    await other.end();
  });

  test('history tables are append-only', { skip }, async () => {
    await tdb.db.query(`insert into ops.audit_events (actor_kind, actor_name, action, target_type, target_id, summary) values ('system', 'test', 'test.recorded', 'x', '1', 'hello')`);
    await assert.rejects(tdb.db.query(`update ops.audit_events set summary = 'changed'`), /append-only/);
    await assert.rejects(tdb.db.query(`delete from ops.audit_events`), /append-only/);
  });

  test('one active ride per driver and one open ride per rider, whatever the application does', { skip }, async () => {
    const rider1 = await addUser(tdb.db, { rider: true });
    const rider2 = await addUser(tdb.db, { rider: true });
    const driver = await addUser(tdb.db, { driver: { city: 'lagos' } });
    const ride = (rider: string, status: string, drv: string | null) =>
      tdb.db.query(
        `insert into app.rides (rider_id, driver_id, mode, category, status, city, pickup_lat, pickup_lng, pickup_label, destination_lat, destination_lng, destination_label, matched_at)
         values ($1, $2, 'quick_match', 'go', $3, 'lagos', 6.45, 3.39, 'A', 6.6, 3.35, 'B', case when $2::uuid is not null then now() end)`,
        [rider, drv, status],
      );
    await ride(rider1, 'matched', driver);
    await assert.rejects(ride(rider2, 'in_progress', driver), /rides_one_active_per_driver/);
    await assert.rejects(ride(rider1, 'searching', null), /rides_one_open_per_rider/);
    await assert.rejects(ride(rider2, 'matched', null), /check constraint/, 'a matched ride needs a driver');
  });

  test('money is whole kobo in NGN; staff roles and no self-approval are enforced', { skip }, async () => {
    const s = await addStaff(tdb.db, { roles: ['finance'] });
    await assert.rejects(addStaff(tdb.db, { roles: ['superuser'] }), /check constraint/);
    const ins = (amount: number, approvedBy: string | null) =>
      tdb.db.query(
        `insert into app.operating_expenses (vendor_id, category, description, amount_kobo, month, incurred_at, created_by, approved_by, approved_at, status)
         values ('vercel', 'frontend_hosting', 'Pro plan', $1, '2026-10', now(), $2, $3, case when $3::uuid is not null then now() end, 'approved')`,
        [amount, s.staffId, approvedBy],
      );
    await assert.rejects(ins(0, null), /check constraint/);
    await assert.rejects(ins(100, s.staffId), /check constraint/, 'cannot approve your own expense');
    await assert.rejects(tdb.db.query(`insert into app.rides (rider_id, mode, category, status, city, pickup_lat, pickup_lng, pickup_label, destination_lat, destination_lng, destination_label, currency) values ($1, 'negotiate', 'go', 'searching', 'lagos', 1, 1, 'a', 2, 2, 'b', 'USD')`, [await addUser(tdb.db, { rider: true })]), /check constraint/);
  });

  test('client roles get no access to app and ops (Supabase roles, when present)', { skip }, async () => {
    const r = await tdb.db.query<{ n: number }>(`select count(*)::int as n from information_schema.role_table_grants where table_schema in ('app', 'ops') and grantee in ('anon', 'authenticated', 'PUBLIC')`);
    assert.equal(r.rows[0]!.n, 0);
    const rls = await tdb.db.query<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname in ('app', 'ops') and not rowsecurity and tablename <> 'schema_migrations'`);
    assert.equal(rls.rows[0]!.n, 0, 'row level security on every table');
  });

  test('/health/ready is ok with a current schema and 503 when the schema is behind', { skip }, async () => {
    const keys = await makeKeys();
    const t = await makeApp({ db: tdb.db, keys });
    const ok = await t.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().status, 'ok');
    await t.app.close();

    const fresh = await createTestDb({ migrate: false });
    const behind = await makeApp({ db: fresh.db, keys });
    const r = await behind.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(r.statusCode, 503);
    await behind.app.close();
    await fresh.drop();
  });
});
