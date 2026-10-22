import { clientError, errorFromResponse, type ApiError, type ApiResult } from './errors';
import type { ApiSuccessBody } from './health';
import type { Logger } from './observability';

/**
 * The one HTTP client every app uses for /v1 (D-051). Talks to the stable API address
 * (https://api.gobye.app/v1), never to an origin server, so changing backends needs no app release.
 * Status: implemented and tested locally against a fake fetch. No backend exists yet.
 *
 * Rules:
 * - Every request gets an x-request-id (shown to support on errors).
 * - Writes that move money or commit a driver send an Idempotency-Key.
 * - Automatic retries only for GET/HEAD and for writes that carry an Idempotency-Key, and only after a
 *   network error, timeout, 502, 503 or 504 (bounded, exponential backoff with full jitter, Retry-After
 *   honoured). A write without a key is never retried.
 * - A timed-out write is "ambiguous": use resolveAmbiguous() to read the authoritative state.
 * - Tokens, signed URLs and request bodies are never logged.
 */

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: unknown }) => Promise<FetchResponseLike>;

interface AbortLike {
  signal: unknown;
  abort(): void;
}
const runtime = globalThis as unknown as { fetch?: HttpFetch; AbortController?: new () => AbortLike };

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
  /** Override retries (GET default 2, keyed writes default 1, other writes always 0). */
  retries?: number;
  /** Public endpoints (e.g. health) skip the auth header. */
  anonymous?: boolean;
  headers?: Record<string, string>;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: HttpFetch;
  /** Current access token (or null). Called per request so refreshed tokens are picked up. */
  getToken?: () => Promise<string | null> | string | null;
  timeoutMs?: number;
  logger?: Logger;
  /** Reports whether the device has a connection (NetInfo). Offline requests fail fast. */
  isOnline?: () => boolean;
  /** Injected for tests. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  newRequestId?: () => string;
  /** Client name/version for x-client header, e.g. "rider/0.1.0". */
  client?: string;
}

export interface ApiClient {
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<ApiResult<T>>;
  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<ApiResult<T>>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<ApiResult<T>>;
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<ApiResult<T>>;
  delete<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<ApiResult<T>>;
}

export const MAX_BACKOFF_MS = 8_000;
const BASE_BACKOFF_MS = 400;

/** Full-jitter exponential backoff: random in [0, min(cap, base * 2^attempt)]. */
export function backoffDelay(attempt: number, random: () => number = Math.random, base = BASE_BACKOFF_MS, cap = MAX_BACKOFF_MS): number {
  return Math.floor(random() * Math.min(cap, base * 2 ** attempt));
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const defaultRequestId = () => `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  const q = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${b}${p}${q ? `?${q}` : ''}`;
}

/** Path with ids replaced, safe for logs and metrics ("/rides/:id"). */
export const routeLabel = (path: string) =>
  path
    .split('?')[0]
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    // Segments with a digit and 6+ characters are ids ("bk-mvk2mcw0", "ride_123456"); words stay.
    .replace(/\/(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{6,}(?=\/|$)/g, '/:id');

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const doFetch: HttpFetch = opts.fetch ?? ((u, i) => {
    if (!runtime.fetch) throw new Error('No fetch available');
    return runtime.fetch(u, i);
  });
  const random = opts.random ?? Math.random;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const newId = opts.newRequestId ?? defaultRequestId;

  async function once<T>(method: HttpMethod, path: string, o: RequestOptions, requestId: string): Promise<ApiResult<T>> {
    if (opts.isOnline && !opts.isOnline()) return { ok: false, error: clientError('offline', { requestId }) };
    const headers: Record<string, string> = { Accept: 'application/json', 'x-request-id': requestId, ...(o.headers ?? {}) };
    if (opts.client) headers['x-client'] = opts.client;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.idempotencyKey) headers['Idempotency-Key'] = o.idempotencyKey;
    if (!o.anonymous && opts.getToken) {
      const t = await opts.getToken();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    const ctrl = runtime.AbortController ? new runtime.AbortController() : null;
    let timedOut = false;
    const timeout = o.timeoutMs ?? opts.timeoutMs ?? 15_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        ctrl?.abort();
        resolve('timeout');
      }, timeout);
    });
    const sentWrite = method !== 'GET' && method !== 'HEAD';
    try {
      const res = await Promise.race([doFetch(buildUrl(opts.baseUrl, path, o.query), { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: ctrl?.signal }), timeoutPromise]);
      if (res === 'timeout') return { ok: false, error: clientError('timeout', { requestId, ambiguous: sentWrite }) };
      const text = await res.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
          if (res.ok) return { ok: false, error: clientError('server', { status: res.status, requestId, message: 'We got an unexpected reply. Try again.' }) };
        }
      }
      const rid = res.headers.get('x-request-id') ?? requestId;
      if (!res.ok) return { ok: false, error: { ...errorFromResponse(res.status, parsed, res.headers.get('retry-after'), rid), ambiguous: res.status === 504 && sentWrite ? true : undefined } };
      const data = parsed && typeof parsed === 'object' && 'data' in (parsed as object) ? (parsed as ApiSuccessBody<T>).data : (parsed as T);
      return { ok: true, value: data, requestId: rid };
    } catch {
      if (timedOut) return { ok: false, error: clientError('timeout', { requestId, ambiguous: sentWrite }) };
      // A failure after sending a write may still have reached the server.
      return { ok: false, error: clientError('network', { requestId, ambiguous: sentWrite }) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T>(method: HttpMethod, path: string, o: RequestOptions = {}): Promise<ApiResult<T>> {
    const idempotent = method === 'GET' || method === 'HEAD' || (!!o.idempotencyKey && (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE'));
    const maxRetries = !idempotent ? 0 : o.retries ?? (method === 'GET' || method === 'HEAD' ? 2 : 1);
    // One request id across retries of the same call, so the logs line up.
    const requestId = newId();
    const started = Date.now();
    let attempt = 0;
    for (;;) {
      const r = await once<T>(method, path, o, requestId);
      const e = r.ok ? null : r.error;
      const retryable = !!e && (e.kind === 'network' || e.kind === 'timeout' || (e.status !== undefined && RETRYABLE_STATUS.has(e.status)));
      if (r.ok || !retryable || attempt >= maxRetries || e?.kind === 'offline') {
        opts.logger?.log(r.ok ? 'info' : 'warn', 'api.request', {
          requestId,
          method,
          route: routeLabel(path),
          outcome: r.ok ? 'success' : e?.kind === 'timeout' ? 'timeout' : 'failure',
          durationMs: Date.now() - started,
          attempts: attempt + 1,
          error: e ? { kind: e.kind, code: e.code, status: e.status } : undefined,
        });
        return r;
      }
      const wait = e?.retryAfterSeconds !== undefined ? Math.min(MAX_BACKOFF_MS * 4, e.retryAfterSeconds * 1000) : backoffDelay(attempt, random);
      opts.logger?.log('debug', 'api.retry', { requestId, method, route: routeLabel(path), outcome: 'retry', attempts: attempt + 1, waitMs: wait, error: e ? { kind: e.kind, status: e.status } : undefined });
      attempt += 1;
      await sleep(wait);
    }
  }

  return {
    request,
    get: (p, o) => request('GET', p, o),
    post: (p, b, o) => request('POST', p, { ...o, body: b }),
    patch: (p, b, o) => request('PATCH', p, { ...o, body: b }),
    delete: (p, o) => request('DELETE', p, o),
  };
}

/* ---------- Ambiguous writes ---------- */

export type AmbiguousOutcome<T> =
  | { state: 'succeeded'; value: T }
  | { state: 'not_found' }
  /** Still unknown (lookup also failed): tell the user "checking", keep the key, ask again later. */
  | { state: 'unknown'; error: ApiError };

/**
 * After a booking / payment / offer create timed out, do NOT resend it. Ask the server what happened
 * to that Idempotency-Key: if it succeeded, use its result; if the server never saw it, it is safe to
 * submit again WITH THE SAME KEY; if the lookup fails too, keep showing "checking".
 */
export async function resolveAmbiguous<T>(lookup: () => Promise<ApiResult<T>>, attempts = 3, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), random: () => number = Math.random): Promise<AmbiguousOutcome<T>> {
  let last: ApiError = clientError('unknown');
  for (let i = 0; i < attempts; i++) {
    const r = await lookup();
    if (r.ok) return { state: 'succeeded', value: r.value };
    if (r.error.kind === 'not_found') return { state: 'not_found' };
    last = r.error;
    if (i < attempts - 1) await sleep(backoffDelay(i, random));
  }
  return { state: 'unknown', error: last };
}

