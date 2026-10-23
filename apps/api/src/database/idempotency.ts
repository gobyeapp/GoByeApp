import { createHash } from 'node:crypto';
import type { Database, Querier } from './database';
import { Errors } from '../common/errors';

/**
 * Idempotent writes (API_CONTRACTS.md §1, API_CLIENT.md): `Idempotency-Key` is required on every POST/PATCH
 * that creates or changes something. The key record is written in the SAME transaction as the change, so
 * "changed but not recorded" cannot happen:
 *
 * 1. insert the key row (or find it) and lock it;
 * 2. completed + same request hash  → replay the stored response, change nothing;
 *    completed + different hash      → 409 idempotency_conflict;
 *    otherwise                       → run the handler in this transaction and store its response.
 * A concurrent duplicate waits on the row lock, then sees the stored response.
 */

const KEY = /^[A-Za-z0-9_-]{8,128}$/;

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method.toUpperCase()} ${path}\n${stableJson(body ?? null)}`).digest('hex');
}

/** JSON with sorted keys, so property order does not change the hash. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function parseIdempotencyKey(header: string | string[] | undefined): string {
  const k = Array.isArray(header) ? header[0] : header;
  if (!k) throw Errors.validation({ 'Idempotency-Key': 'Required for this request.' }, 'Idempotency-Key header is required.');
  if (!KEY.test(k)) throw Errors.validation({ 'Idempotency-Key': 'Use 8 to 128 letters, digits, - or _ (a UUID is ideal).' });
  return k;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

export async function withIdempotency<T>(
  db: Database,
  p: { scope: string; key: string; method: string; path: string; hash: string },
  fn: (tx: Querier) => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  return db.tx(async (tx) => {
    await tx.query(
      `insert into ops.idempotency_keys (scope, key, method, path, request_hash) values ($1, $2, $3, $4, $5)
       on conflict (scope, key) do nothing`,
      [p.scope, p.key, p.method, p.path, p.hash],
    );
    const row = (
      await tx.query<{ request_hash: string; status_code: number | null; response: T | null }>(
        `select request_hash, status_code, response from ops.idempotency_keys where scope = $1 and key = $2 for update`,
        [p.scope, p.key],
      )
    ).rows[0]!;
    if (row.request_hash !== p.hash) throw Errors.idempotencyConflict();
    if (row.status_code !== null) return { status: row.status_code, body: row.response as T, replayed: true };
    const out = await fn(tx);
    await tx.query(`update ops.idempotency_keys set status_code = $3, response = $4::jsonb, completed_at = now() where scope = $1 and key = $2`, [p.scope, p.key, out.status, JSON.stringify(out.body)]);
    return { ...out, replayed: false };
  });
}
