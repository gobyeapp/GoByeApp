import { Client } from 'pg';
import { ConfigError, loadConfig, type AppConfig } from './config/config';
import { Database, poolConfig } from './database/database';
import { loadMigrations, migrate, plan, readApplied } from './database/migrations';
import { MIGRATIONS_DIR } from './app.factory';

/**
 * Migration CLI (docs/DATABASE_MIGRATIONS.md).
 *   node dist/apps/api/src/migrate.js status            list applied and pending, report problems
 *   node dist/apps/api/src/migrate.js up                apply pending (refused in production without the flag)
 *   node dist/apps/api/src/migrate.js up --confirm-production
 *   node dist/apps/api/src/migrate.js check-runtime   connect as the API does (DATABASE_URL, possibly the
 *                                                     transaction pooler) and check role, timeouts and TLS
 * Uses DATABASE_MIGRATION_URL (direct or session-mode connection; the advisory lock needs a session),
 * falling back to DATABASE_URL.
 */
/**
 * C-1 check for a real environment: the runtime connection (DATABASE_URL, e.g. Supavisor port 6543) must
 * get its timeouts from the role, use TLS, and not be able to change the schema. Prints no secrets.
 */
async function checkRuntime(config: AppConfig): Promise<number> {
  if (!config.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is required\n');
    return 78;
  }
  const db = Database.fromConfig(config);
  const problems: string[] = [];
  try {
    const r = await db.query<{ user: string; st: string; lt: string; it: string; version: string; ssl: boolean | null; superuser: boolean; bypassrls: boolean; can_create: boolean }>(
      `select current_user as user,
              current_setting('statement_timeout') st, current_setting('lock_timeout') lt,
              current_setting('idle_in_transaction_session_timeout') it,
              current_setting('server_version') as version,
              (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl,
              r.rolsuper as superuser, r.rolbypassrls as bypassrls,
              has_schema_privilege('app', 'create') as can_create
         from pg_roles r where r.rolname = current_user`,
    );
    const x = r.rows[0]!;
    const tx = await db.tx(async (q) => (await q.query<{ st: string }>(`select current_setting('statement_timeout') st`)).rows[0]!.st);
    process.stdout.write(
      [
        `Environment: ${config.APP_ENV}`,
        `Connected as: ${x.user} (PostgreSQL ${x.version})`,
        `TLS to the server: ${x.ssl === null ? 'unknown (behind a pooler)' : x.ssl ? 'yes' : 'no'}`,
        `Role statement_timeout: ${x.st}; lock_timeout: ${x.lt}; idle_in_transaction_session_timeout: ${x.it}`,
        `Inside a transaction (SET LOCAL): statement_timeout ${tx}`,
        `bypassrls: ${x.bypassrls}; superuser: ${x.superuser}; can create in schema app: ${x.can_create}`,
      ].join('\n') + '\n',
    );
    if (x.st === '0') problems.push('statement_timeout is not set on the runtime role (run apps/api/db/roles.sql)');
    if (x.lt === '0') problems.push('lock_timeout is not set on the runtime role');
    if (x.it === '0') problems.push('idle_in_transaction_session_timeout is not set on the runtime role');
    if (x.superuser) problems.push('the runtime role is a superuser');
    if (x.can_create) problems.push('the runtime role can create objects in schema app');
    if (!x.bypassrls) problems.push('the runtime role lacks bypassrls: it will read 0 rows (DATABASE_MIGRATIONS.md)');
    if (x.ssl === false && config.isProductionLike) problems.push('the server connection is not using TLS');
  } catch (e) {
    problems.push(`could not run the checks: ${(e as Error).message}`);
  } finally {
    await db.close();
  }
  if (problems.length) process.stdout.write(`Problems:\n- ${problems.join('\n- ')}\n`);
  else process.stdout.write('Runtime connection OK\n');
  return problems.length ? 1 : 0;
}

async function main() {
  const [cmd = 'status', ...flags] = process.argv.slice(2);
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(78);
    }
    throw e;
  }
  if (cmd === 'check-runtime') {
    process.exitCode = await checkRuntime(config);
    return;
  }
  // Staging/production config requires DATABASE_MIGRATION_URL (advisory locks need a session, not the
  // transaction pooler). Development may fall back to DATABASE_URL.
  const url = config.DATABASE_MIGRATION_URL ?? (config.isProductionLike ? undefined : config.DATABASE_URL);
  if (!url) {
    process.stderr.write('DATABASE_MIGRATION_URL or DATABASE_URL is required\n');
    process.exit(78);
  }
  const files = loadMigrations(MIGRATIONS_DIR);
  const client = new Client({ ...poolConfig(url, config, 'gobye-migrate'), max: undefined } as never);
  await client.connect();
  try {
    if (cmd === 'status') {
      const p = plan(files, await readApplied(client));
      process.stdout.write(`Environment: ${config.APP_ENV}\nApplied: ${p.applied.length}\nPending: ${p.pending.map((f) => `${f.version}_${f.name}`).join(', ') || 'none'}\n`);
      if (p.problems.length) {
        process.stdout.write(`Problems:\n- ${p.problems.join('\n- ')}\n`);
        process.exitCode = 1;
      }
    } else if (cmd === 'up') {
      if (config.APP_ENV === 'production' && !flags.includes('--confirm-production')) {
        process.stderr.write('Refusing to migrate production without --confirm-production (check the backup first: docs/DATABASE_MIGRATIONS.md)\n');
        process.exitCode = 2;
        return;
      }
      const r = await migrate(client, files, (m) => process.stdout.write(`${m}\n`));
      process.stdout.write(`Applied ${r.applied.length} migration(s); ${r.skipped} already applied.\n`);
    } else {
      process.stderr.write(`Unknown command "${cmd}". Use status, up or check-runtime.\n`);
      process.exitCode = 64;
    }
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
