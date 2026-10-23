import { Client } from 'pg';
import { ConfigError, loadConfig } from './config/config';
import { poolConfig } from './database/database';
import { loadMigrations, migrate, plan, readApplied } from './database/migrations';
import { MIGRATIONS_DIR } from './app.factory';

/**
 * Migration CLI (docs/DATABASE_MIGRATIONS.md).
 *   node dist/apps/api/src/migrate.js status            list applied and pending, report problems
 *   node dist/apps/api/src/migrate.js up                apply pending (refused in production without the flag)
 *   node dist/apps/api/src/migrate.js up --confirm-production
 * Uses DATABASE_MIGRATION_URL (direct or session-mode connection; the advisory lock needs a session),
 * falling back to DATABASE_URL.
 */
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
      process.stderr.write(`Unknown command "${cmd}". Use status or up.\n`);
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
