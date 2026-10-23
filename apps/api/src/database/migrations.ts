import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';

/**
 * Forward-only SQL migrations (BACKEND_ARCHITECTURE.md §7, docs/DATABASE_MIGRATIONS.md).
 *
 * - Files: `apps/api/migrations/NNNN_snake_name.sql`, applied in version order.
 * - Each file runs in its own transaction with lock and statement timeouts, unless its first line is
 *   `-- gobye:no-transaction` (for CREATE INDEX CONCURRENTLY).
 * - A session advisory lock stops two deploys migrating at once.
 * - Applied files are fingerprinted (SHA-256). Editing an applied file is refused: write a new migration.
 * - No down migrations. Mistakes are fixed forward; data safety comes from backups / PITR and from the
 *   expand → migrate → contract pattern.
 */

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
  transactional: boolean;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
export const MIGRATION_LOCK_KEY = 7_406_011_001; // arbitrary, stable: "gobye migrations"

export function loadMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const out: MigrationFile[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const m = FILE.exec(f);
    if (!m) throw new Error(`Migration file name not allowed: ${f} (expected NNNN_snake_name.sql)`);
    if (seen.has(m[1]!)) throw new Error(`Duplicate migration version ${m[1]}`);
    seen.add(m[1]!);
    const sql = readFileSync(join(dir, f), 'utf8');
    const transactional = !/^--\s*gobye:no-transaction/.test(sql);
    // Postgres runs a multi-statement string as one implicit transaction, which CREATE INDEX CONCURRENTLY
    // refuses: a no-transaction file may hold exactly one statement.
    if (!transactional && statementCount(sql) !== 1) throw new Error(`Migration ${f} is marked no-transaction and must contain exactly one statement`);
    out.push({ version: m[1]!, name: m[2]!, sql, checksum: createHash('sha256').update(sql).digest('hex'), transactional });
  }
  return out;
}

/** Statements in a SQL file, ignoring comments and string literals (enough for the no-transaction rule). */
export function statementCount(sql: string): number {
  const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^']|'')*'/g, "''");
  return stripped.split(';').filter((p) => p.trim().length > 0).length;
}

export interface MigrationPlan {
  applied: AppliedMigration[];
  pending: MigrationFile[];
  /** Applied files whose content changed, or applied versions missing from disk. Any entry blocks `up`. */
  problems: string[];
}

export function plan(files: MigrationFile[], applied: AppliedMigration[]): MigrationPlan {
  const byVersion = new Map(files.map((f) => [f.version, f]));
  const problems: string[] = [];
  for (const a of applied) {
    const f = byVersion.get(a.version);
    if (!f) problems.push(`Applied migration ${a.version}_${a.name} is missing from this build (deploying an older image over a newer database?)`);
    else if (f.checksum !== a.checksum) problems.push(`Migration ${a.version}_${a.name} was edited after it was applied; write a new migration instead`);
  }
  const appliedSet = new Set(applied.map((a) => a.version));
  const pending = files.filter((f) => !appliedSet.has(f.version));
  const lastApplied = applied.map((a) => a.version).sort().at(-1);
  for (const p of pending) if (lastApplied && p.version < lastApplied) problems.push(`Migration ${p.version}_${p.name} is older than the latest applied (${lastApplied}); renumber it`);
  return { applied, pending, problems };
}

const BOOTSTRAP = `
create schema if not exists ops;
create table if not exists ops.schema_migrations (
  version     text primary key,
  name        text not null,
  checksum    text not null,
  applied_at  timestamptz not null default now(),
  applied_by  text not null default current_user,
  duration_ms integer not null
);`;

export async function readApplied(client: Pick<Client, 'query'>): Promise<AppliedMigration[]> {
  const exists = await client.query(`select to_regclass('ops.schema_migrations') is not null as ok`);
  if (!exists.rows[0]?.ok) return [];
  const r = await client.query(`select version, name, checksum, applied_at from ops.schema_migrations order by version`);
  return r.rows as AppliedMigration[];
}

export interface RunResult {
  applied: string[];
  skipped: number;
}

/** Applies pending migrations. Throws (having applied nothing further) on any plan problem or SQL error. */
export async function migrate(client: Client, files: MigrationFile[], log: (m: string) => void = () => undefined): Promise<RunResult> {
  const got = await client.query('select pg_try_advisory_lock($1) as ok', [MIGRATION_LOCK_KEY]);
  if (!got.rows[0]?.ok) throw new Error('Another migration is running (advisory lock held). Try again when it finishes.');
  try {
    await client.query(BOOTSTRAP);
    const p = plan(files, await readApplied(client));
    if (p.problems.length) throw new Error(`Refusing to migrate:\n- ${p.problems.join('\n- ')}`);
    const done: string[] = [];
    for (const f of p.pending) {
      const started = Date.now();
      log(`Applying ${f.version}_${f.name}${f.transactional ? '' : ' (no transaction)'}`);
      if (f.transactional) {
        await client.query('begin');
        try {
          await client.query(`set local lock_timeout = '5s'`);
          await client.query(`set local statement_timeout = '120s'`);
          await client.query(f.sql);
          await client.query('insert into ops.schema_migrations (version, name, checksum, duration_ms) values ($1, $2, $3, $4)', [f.version, f.name, f.checksum, Date.now() - started]);
          await client.query('commit');
        } catch (e) {
          await client.query('rollback').catch(() => undefined);
          throw new Error(`Migration ${f.version}_${f.name} failed and was rolled back: ${(e as Error).message}`, { cause: e });
        }
      } else {
        await client.query(f.sql);
        await client.query('insert into ops.schema_migrations (version, name, checksum, duration_ms) values ($1, $2, $3, $4)', [f.version, f.name, f.checksum, Date.now() - started]);
      }
      done.push(`${f.version}_${f.name}`);
    }
    return { applied: done, skipped: p.applied.length };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
  }
}

/** For /health/ready: is the database at least at the version this build expects? */
export async function schemaIsCurrent(q: { query: Client['query'] }, files: MigrationFile[]): Promise<boolean> {
  const latest = files.at(-1)?.version;
  if (!latest) return true;
  try {
    const r = await q.query(`select max(version) as v from ops.schema_migrations`);
    const v = r.rows[0]?.v as string | null;
    return !!v && v >= latest;
  } catch {
    return false;
  }
}
