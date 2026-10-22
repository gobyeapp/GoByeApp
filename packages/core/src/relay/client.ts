import type { RelayTable } from './types';

/**
 * Demo relay client (D-049). Speaks the subset of the Supabase / PostgREST REST API the demo needs:
 * select with filters, insert, upsert and filtered update. The same client works against the local
 * demo server (`npm run demo:relay`) and a Supabase project with the `demo_*` tables.
 */

type Scalar = string | number | boolean | null;
export type RelayWhere = Record<string, Scalar | { in: (string | number)[] } | { neq: Scalar } | { gte: number } | { gt: number }>;

export interface RelayQuery {
  where?: RelayWhere;
  order?: [column: string, direction: 'asc' | 'desc'];
  limit?: number;
}

export interface Relay {
  /** Base URL, for the "Connected to …" label. */
  readonly url: string;
  select<T>(table: RelayTable, query?: RelayQuery): Promise<T[]>;
  insert<T>(table: RelayTable, row: T): Promise<T>;
  /** Insert or replace by `id`. */
  upsert<T>(table: RelayTable, row: T): Promise<T>;
  /** Patch every row matching `where`; returns the rows changed (empty when the filter matched nothing). */
  update<T>(table: RelayTable, where: RelayWhere, patch: Partial<T>): Promise<T[]>;
}

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

/** The bit of `fetch` the client uses (core stays free of DOM / Node type libraries). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: unknown },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

interface AbortLike {
  signal: unknown;
  abort(): void;
}
const runtime = globalThis as unknown as { fetch?: FetchLike; AbortController?: new () => AbortLike };

export interface RelayConfig {
  url: string;
  /** Supabase anon key (or any key the server expects). Not needed for the local demo server. */
  key?: string;
  timeoutMs?: number;
  /** Injected for tests. */
  fetch?: FetchLike;
}

const encodeValue = (v: Scalar): string => (v === null ? 'null' : String(v));
const quote = (v: string | number) => (typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '\\"')}"`);

/** PostgREST filter string for one column. */
export function encodeFilter(value: RelayWhere[string]): string {
  if (value !== null && typeof value === 'object') {
    if ('in' in value) return `in.(${value.in.map(quote).join(',')})`;
    if ('neq' in value) return value.neq === null ? 'not.is.null' : `neq.${encodeValue(value.neq)}`;
    if ('gte' in value) return `gte.${value.gte}`;
    if ('gt' in value) return `gt.${value.gt}`;
  }
  return value === null ? 'is.null' : `eq.${encodeValue(value as Scalar)}`;
}

export function encodeQuery(query: RelayQuery = {}): string {
  const parts: string[] = ['select=*'];
  for (const [k, v] of Object.entries(query.where ?? {})) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(encodeFilter(v))}`);
  if (query.order) parts.push(`order=${encodeURIComponent(`${query.order[0]}.${query.order[1]}`)}`);
  if (query.limit) parts.push(`limit=${query.limit}`);
  return parts.join('&');
}

export function createRelay(config: RelayConfig): Relay {
  const base = config.url.replace(/\/+$/, '');
  const f: FetchLike = config.fetch ?? ((url, init) => {
    if (!runtime.fetch) throw new RelayError('No fetch in this runtime.');
    return runtime.fetch(url, init);
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config.key) {
    headers.apikey = config.key;
    headers.Authorization = `Bearer ${config.key}`;
  }

  async function call<T>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
    const ctrl = runtime.AbortController ? new runtime.AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), config.timeoutMs ?? 8_000);
    try {
      const res = await f(`${base}/rest/v1/${path}`, {
        method,
        headers: prefer ? { ...headers, Prefer: prefer } : headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl?.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new RelayError(`Relay ${method} ${path.split('?')[0]} failed (${res.status}) ${text.slice(0, 160)}`, res.status);
      return (text ? JSON.parse(text) : []) as T;
    } catch (e) {
      if (e instanceof RelayError) throw e;
      throw new RelayError(`Can’t reach the demo relay at ${base}.`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    url: base,
    select: <T,>(table: RelayTable, query?: RelayQuery) => call<T[]>('GET', `${table}?${encodeQuery(query)}`),
    async insert<T>(table: RelayTable, row: T) {
      const rows = await call<T[]>('POST', table, row, 'return=representation');
      return rows[0] ?? row;
    },
    async upsert<T>(table: RelayTable, row: T) {
      const rows = await call<T[]>('POST', `${table}?on_conflict=id`, row, 'return=representation,resolution=merge-duplicates');
      return rows[0] ?? row;
    },
    update: <T,>(table: RelayTable, where: RelayWhere, patch: Partial<T>) => {
      const q = encodeQuery({ where }).replace(/^select=\*&?/, '');
      return call<T[]>('PATCH', `${table}?${q}`, patch, 'return=representation');
    },
  };
}

/* ---------- In-memory relay (tests, and the same semantics as the local demo server) ---------- */

type Row = Record<string, unknown> & { id: string };

export function matchesWhere(row: Record<string, unknown>, where: RelayWhere = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k] ?? null;
    if (cond !== null && typeof cond === 'object') {
      if ('in' in cond) return cond.in.some((x) => String(x) === String(v));
      if ('neq' in cond) return cond.neq === null ? v !== null : String(v) !== String(cond.neq);
      if ('gte' in cond) return typeof v === 'number' && v >= cond.gte;
      if ('gt' in cond) return typeof v === 'number' && v > cond.gt;
    }
    return cond === null ? v === null : String(v) === String(cond);
  });
}

export function applyQuery<T extends Record<string, unknown>>(rows: T[], query: RelayQuery = {}): T[] {
  let out = rows.filter((r) => matchesWhere(r, query.where));
  if (query.order) {
    const [col, dir] = query.order;
    out = [...out].sort((a, b) => {
      const x = a[col] as number | string;
      const y = b[col] as number | string;
      return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
    });
  }
  return query.limit ? out.slice(0, query.limit) : out;
}

export function createMemoryRelay(): Relay & { tables: Record<string, Row[]> } {
  const tables: Record<string, Row[]> = {};
  const t = (name: string) => (tables[name] ??= []);
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    url: 'memory://demo-relay',
    tables,
    async select<T>(table: RelayTable, query?: RelayQuery) {
      return clone(applyQuery(t(table), query)) as unknown as T[];
    },
    async insert<T>(table: RelayTable, row: T) {
      const r = clone(row) as unknown as Row;
      if (t(table).some((x) => x.id === r.id)) throw new RelayError('duplicate key', 409);
      t(table).push(r);
      return clone(r) as unknown as T;
    },
    async upsert<T>(table: RelayTable, row: T) {
      const r = clone(row) as unknown as Row;
      const list = t(table);
      const i = list.findIndex((x) => x.id === r.id);
      if (i >= 0) list[i] = { ...list[i], ...r };
      else list.push(r);
      return clone(i >= 0 ? list[i] : r) as unknown as T;
    },
    async update<T>(table: RelayTable, where: RelayWhere, patch: Partial<T>) {
      const out: Row[] = [];
      for (const r of t(table)) if (matchesWhere(r, where)) out.push(Object.assign(r, clone(patch)));
      return clone(out) as unknown as T[];
    },
  };
}
