import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { MIGRATIONS_DIR } from '../src/app.factory';
import { loadConfig, testConfig } from '../src/config/config';
import { Database, poolConfig, STARTUP_PARAMETERS_ALLOWED } from '../src/database/database';
import { loadMigrations, migrate } from '../src/database/migrations';
import { createTestDb, NO_DB_REASON, postgresAvailable, type TestDb } from './helpers';

/**
 * C-1 (Phase 1.5): the API must work through a TRANSACTION-MODE connection pooler (Supabase Supavisor on
 * port 6543). That means no session state set at connection start: timeouts come from the role
 * (apps/api/db/roles.sql), SET LOCAL inside transactions, and the client-side query_timeout.
 *
 * The pooler tests run against PgBouncer in transaction mode (test/pooler/start.sh). PgBouncer is not
 * Supavisor, so a pass here is necessary, not sufficient: the staging project is the real check.
 */

const DB_DIR = join(__dirname, '..', '..', '..', '..', 'db');
const API_PASSWORD = 'gobye_api_local_only'; // test-only; matches test/pooler/userlist.txt
const MIGRATOR_PASSWORD = 'gobye_migrator_local_only'; // test-only

/** Keys pg turns into connection start-up parameters (pg/lib/connection-parameters.js). */
const SESSION_KEYS = ['statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout', 'query_timeout_startup', 'options', 'search_path', 'client_encoding', 'replication', 'fallback_application_name'];

test('poolConfig sends no session settings at connection start (C-1 regression)', () => {
  const cfg = loadConfig({ APP_ENV: 'test', DATABASE_SSL: 'disable', ORIGIN_AUTH_REQUIRED: 'false', DATABASE_STATEMENT_TIMEOUT_MS: '4000' });
  const pc = poolConfig('postgresql://u:p@db.example.supabase.co:6543/postgres?options=-c%20statement_timeout%3D1', cfg) as Record<string, unknown>;
  for (const k of SESSION_KEYS) assert.equal(pc[k], undefined, `poolConfig must not set ${k}`);
  // Only the allow-listed start-up parameter is sent.
  const startup = Object.keys(pc).filter((k) => !['connectionString', 'ssl', 'max', 'idleTimeoutMillis', 'connectionTimeoutMillis'].includes(k));
  assert.deepEqual(startup, [...STARTUP_PARAMETERS_ALLOWED]);
});

function psql(url: string, file: string, vars: Record<string, string> = {}) {
  const args = [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), '-f', join(DB_DIR, file)];
  return execFileSync('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function withUser(url: string, user: string, password: string, host?: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  if (host) {
    const h = new URL(host);
    u.hostname = h.hostname;
    u.port = h.port;
  }
  return u.toString();
}

describe('database roles (apps/api/db/roles.sql, grants.sql)', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let apiUrl = '';
  before(async () => {
    if (skip) return;
    tdb = await createTestDb({ migrate: false });
    // As the admin (local: a non-superuser with CREATEROLE + BYPASSRLS, like Supabase's `postgres`).
    psql(tdb.url, 'roles.sql', { migrator_password: MIGRATOR_PASSWORD, api_password: API_PASSWORD });
    const m = new Client({ connectionString: withUser(tdb.url, 'gobye_migrator', MIGRATOR_PASSWORD) });
    await m.connect();
    await migrate(m, loadMigrations(MIGRATIONS_DIR));
    await m.end();
    psql(withUser(tdb.url, 'gobye_migrator', MIGRATOR_PASSWORD), 'grants.sql');
    apiUrl = withUser(tdb.url, 'gobye_api', API_PASSWORD);
  });
  after(async () => {
    if (!skip) await tdb.drop();
  });

  test('roles.sql refuses to run without passwords and is safe to re-run', { skip }, () => {
    assert.throws(() => psql(tdb.url, 'roles.sql'), /migrator_password/);
    psql(tdb.url, 'roles.sql', { migrator_password: MIGRATOR_PASSWORD, api_password: API_PASSWORD });
  });

  test('the runtime role gets its timeouts from the server, with nothing sent at start-up', { skip }, async () => {
    const db = Database.fromConfig(testConfig({ DATABASE_URL: apiUrl }));
    try {
      const r = await db.query<{ s: string; l: string; i: string }>(`select current_setting('statement_timeout') s, current_setting('lock_timeout') l, current_setting('idle_in_transaction_session_timeout') i`);
      assert.deepEqual(r.rows[0], { s: '5s', l: '3s', i: '30s' });
      // bypassrls: reads work through RLS-with-no-policies; DDL is refused.
      await db.query(`select count(*) from app.users`);
      await assert.rejects(db.query(`create table app.nope (x int)`), /permission denied/);
    } finally {
      await db.close();
    }
  });
});

describe('through a transaction-mode pooler (PgBouncer)', async () => {
  const POOLER = process.env.TEST_POOLER_URL;
  const dbOk = await postgresAvailable();
  if (!POOLER && process.env.REQUIRE_POOLER_TESTS === '1') throw new Error('REQUIRE_POOLER_TESTS=1 but TEST_POOLER_URL is not set (run test/pooler/start.sh)');
  const skip = !dbOk ? NO_DB_REASON : !POOLER ? 'TEST_POOLER_URL not set (start test/pooler/start.sh); pooler tests skipped' : false;
  let tdb: TestDb;
  let pooled = '';
  before(async () => {
    if (skip) return;
    tdb = await createTestDb({ migrate: false });
    psql(tdb.url, 'roles.sql', { migrator_password: MIGRATOR_PASSWORD, api_password: API_PASSWORD });
    const m = new Client({ connectionString: withUser(tdb.url, 'gobye_migrator', MIGRATOR_PASSWORD) });
    await m.connect();
    await migrate(m, loadMigrations(MIGRATIONS_DIR));
    await m.end();
    psql(withUser(tdb.url, 'gobye_migrator', MIGRATOR_PASSWORD), 'grants.sql');
    pooled = withUser(tdb.url, 'gobye_api', API_PASSWORD, POOLER);
  });
  after(async () => {
    if (!skip) await tdb.drop();
  });

  test('the pooler refuses a statement_timeout start-up parameter (why C-1 mattered)', { skip }, async () => {
    const c = new Client({ connectionString: pooled, statement_timeout: 5000 } as never);
    await assert.rejects(c.connect(), /unsupported startup parameter/i);
    await c.end().catch(() => undefined);
  });

  test('the API pool connects, queries and runs transactions through the pooler', { skip }, async () => {
    const db = Database.fromConfig(testConfig({ DATABASE_URL: pooled, DATABASE_POOL_MAX: '8' }));
    try {
      assert.equal(await db.ping(), true);
      const r = await db.query<{ s: string }>(`select current_setting('statement_timeout') s`);
      assert.equal(r.rows[0]!.s, '5s', 'role timeout applies to pooled server connections');
      // More concurrent transactions than server connections (default_pool_size = 4).
      const ids = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          db.tx(async (q) => {
            const t = await q.query<{ s: string; l: string }>(`select current_setting('statement_timeout') s, current_setting('lock_timeout') l`);
            assert.deepEqual(t.rows[0], { s: '5s', l: '3s' });
            const u = await q.query<{ id: string }>(`insert into app.users (id, full_name) values (gen_random_uuid(), $1) returning id`, [`Pooled ${i}`]);
            return u.rows[0]!.id;
          }),
        ),
      );
      assert.equal(new Set(ids).size, 12);
      const n = await db.query<{ n: number }>(`select count(*)::int n from app.users where full_name like 'Pooled %'`);
      assert.equal(n.rows[0]!.n, 12);
    } finally {
      await db.close();
    }
  });

  test('SET LOCAL timeouts apply inside a transaction and never leak to the next one', { skip }, async () => {
    const db = Database.fromConfig(testConfig({ DATABASE_URL: pooled, DATABASE_POOL_MAX: '2' }));
    try {
      await assert.rejects(
        db.tx(async (q) => q.query('select pg_sleep(1)'), { statementTimeoutMs: 200 }),
        (e: { code?: string }) => e.code === '57014',
      );
      for (let i = 0; i < 6; i++) {
        const r = await db.query<{ s: string }>(`select current_setting('statement_timeout') s`);
        assert.equal(r.rows[0]!.s, '5s');
      }
    } finally {
      await db.close();
    }
  });

  test('a statement outside a transaction is cancelled by the ROLE timeout, server side (5s)', { skip }, async () => {
    // Client query_timeout is statement timeout + 1s, so the 57014 below comes from the server's role setting.
    const db = Database.fromConfig(testConfig({ DATABASE_URL: pooled, DATABASE_POOL_MAX: '1' }));
    try {
      const t0 = Date.now();
      await assert.rejects(db.query('select pg_sleep(8)'), (e: { code?: string }) => e.code === '57014');
      const took = Date.now() - t0;
      assert.ok(took >= 4500 && took < 6000, `cancelled after ${took} ms`);
      assert.equal(await db.ping(), true, 'the pooled connection is usable afterwards');
    } finally {
      await db.close();
    }
  });

  test('a rolled-back transaction leaves no state on the shared server connection', { skip }, async () => {
    const db = Database.fromConfig(testConfig({ DATABASE_URL: pooled, DATABASE_POOL_MAX: '1' }));
    try {
      await assert.rejects(db.tx(async (q) => { await q.query(`insert into app.users (id, full_name) values (gen_random_uuid(), 'Rolled back')`); throw new Error('boom'); }), /boom/);
      const r = await db.query<{ n: number }>(`select count(*)::int n from app.users where full_name = 'Rolled back'`);
      assert.equal(r.rows[0]!.n, 0);
      const t = await db.query<{ x: string }>(`select txid_current_if_assigned()::text x`);
      assert.equal(t.rows[0]!.x, null);
    } finally {
      await db.close();
    }
  });
});
