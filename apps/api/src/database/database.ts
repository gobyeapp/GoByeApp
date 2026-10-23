import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import type { AppConfig } from '../config/config';
import { Errors } from '../common/errors';

/**
 * PostgreSQL access (Supabase in staging/production, any Postgres 15+ locally). BACKEND_ARCHITECTURE.md §6.
 *
 * - One pool per process. With Supabase, the runtime URL may point at the pooler (Supavisor) in
 *   transaction mode; we never use session state outside a transaction and never name prepared
 *   statements, so transaction pooling is safe. Migrations use DATABASE_MIGRATION_URL (direct or session
 *   mode) because they take an advisory lock.
 * - Every transaction sets its own statement and lock timeouts (SET LOCAL), which also work through
 *   the pooler.
 * - TLS: verify-full against the Supabase root certificate in staging/production.
 */

export interface Querier {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export function poolConfig(url: string, cfg: Pick<AppConfig, 'DATABASE_SSL' | 'DATABASE_CA_CERT' | 'DATABASE_POOL_MAX' | 'APP_ENV' | 'DATABASE_STATEMENT_TIMEOUT_MS'>, appName = 'gobye-api'): PoolConfig {
  const ssl =
    cfg.DATABASE_SSL === 'disable'
      ? false
      : cfg.DATABASE_SSL === 'require'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true, ...(cfg.DATABASE_CA_CERT ? { ca: cfg.DATABASE_CA_CERT.replace(/\\n/g, '\n') } : {}) };
  // pg lets TLS parameters in the URL override the `ssl` option (e.g. ?ssl=0 would turn TLS off), so
  // every TLS-related parameter is removed: DATABASE_SSL / DATABASE_CA_CERT are the only source of truth.
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (/^ssl/i.test(k) || k === 'uselibpqcompat') u.searchParams.delete(k);
  return {
    connectionString: u.toString(),
    ssl,
    max: cfg.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: `${appName}-${cfg.APP_ENV}`,
    // C-1 (Phase 1.5): NO session settings here. A `statement_timeout` (or `options=-c …`) start-up
    // parameter is rejected by PgBouncer ("unsupported startup parameter") and is not carried through
    // Supavisor's transaction mode (port 6543), where each transaction may run on a different server
    // connection. Timeouts come from three layers that all work through a transaction pooler:
    //   1. the role: `alter role gobye_api set statement_timeout …` (apps/api/db/roles.sql), applied by
    //      the server to every connection it opens for that role;
    //   2. every transaction: SET LOCAL statement_timeout / lock_timeout (Database.tx);
    //   3. the client: query_timeout on every pool query (Database.query).
    // See STARTUP_PARAMETERS_ALLOWED and the regression tests in config.test.ts / pooler.test.ts.
  };
}

/**
 * The only connection start-up parameters the API may send. Anything else (statement_timeout, options,
 * search_path, …) is session state that a transaction pooler does not preserve or refuses outright.
 */
export const STARTUP_PARAMETERS_ALLOWED = ['application_name'] as const;

export class Database implements Querier {
  private constructor(
    private readonly pool: Pool | null,
    private readonly statementTimeoutMs: number,
  ) {}

  static fromConfig(cfg: AppConfig): Database {
    if (!cfg.DATABASE_URL) return new Database(null, cfg.DATABASE_STATEMENT_TIMEOUT_MS);
    const pool = new Pool(poolConfig(cfg.DATABASE_URL, cfg));
    // An idle client erroring (e.g. the server restarted) must not crash the process.
    pool.on('error', () => undefined);
    return new Database(pool, cfg.DATABASE_STATEMENT_TIMEOUT_MS);
  }

  get configured(): boolean {
    return this.pool !== null;
  }

  private need(): Pool {
    if (!this.pool) throw Errors.notConfigured('The database');
    return this.pool;
  }

  async query<R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
    const r = await this.need().query<R>({ text, values: params, query_timeout: this.statementTimeoutMs + 1000 } as never);
    return { rows: r.rows, rowCount: r.rowCount };
  }

  /** Runs fn in one transaction with SET LOCAL timeouts; rolls back on any error. */
  async tx<T>(fn: (q: Querier, client: PoolClient) => Promise<T>, opts: { isolation?: 'read committed' | 'repeatable read' | 'serializable'; statementTimeoutMs?: number } = {}): Promise<T> {
    const client = await this.need().connect();
    try {
      await client.query(`begin isolation level ${opts.isolation ?? 'read committed'}`);
      await client.query(`set local statement_timeout = ${Math.floor(opts.statementTimeoutMs ?? this.statementTimeoutMs)}`);
      await client.query(`set local lock_timeout = 3000`);
      const q: Querier = { query: async (text, params = []) => { const r = await client.query(text, params as unknown[]); return { rows: r.rows, rowCount: r.rowCount }; } };
      const out = await fn(q, client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Readiness probe: a trivial round trip with a hard timeout. Never throws. */
  async ping(timeoutMs = 2000): Promise<boolean> {
    if (!this.pool) return false;
    let timer: NodeJS.Timeout | undefined;
    try {
      const t = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
      const ok = this.pool.query('select 1 as ok').then((r) => r.rows[0]?.ok === 1).catch(() => false);
      return await Promise.race([ok, t]);
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

/** Postgres error codes we map to API errors. */
export const PG = { uniqueViolation: '23505', serializationFailure: '40001', deadlock: '40P01', lockNotAvailable: '55P03', queryCanceled: '57014' } as const;
export const pgCode = (e: unknown) => (e as { code?: string })?.code;
