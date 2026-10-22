import type { ApiErrorBody } from './health';

/**
 * Client-side error model for every network call (D-051). Screens switch on `kind`, never on raw HTTP
 * status, so the backend can change providers without UI changes. Status: implemented and tested.
 */
export type ApiErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'offline'
  | 'network'
  | 'server'
  | 'unknown';

export interface ApiError {
  kind: ApiErrorKind;
  /** Backend code when there was one (e.g. 'quote_expired'). */
  code?: string;
  /** Safe sentence for the user. */
  message: string;
  status?: number;
  requestId?: string;
  retryAfterSeconds?: number;
  details?: Record<string, string>;
  /**
   * True when the request may have reached the server and done its work (timeout or connection cut
   * after sending). Never retry these blindly: look up the authoritative state instead.
   */
  ambiguous?: boolean;
}

export type ApiResult<T> = { ok: true; value: T; requestId?: string } | { ok: false; error: ApiError };

const FRIENDLY: Record<ApiErrorKind, string> = {
  validation: 'Check the highlighted details and try again.',
  unauthenticated: 'Your session has ended. Sign in again.',
  forbidden: 'You don’t have access to this.',
  not_found: 'We couldn’t find that.',
  conflict: 'This changed while you were on it. Refresh and try again.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  unavailable: 'GoBye is temporarily unavailable. Try again shortly.',
  timeout: 'This is taking longer than usual. Check your connection.',
  offline: 'You’re offline. Check your connection.',
  network: 'We couldn’t reach GoBye. Check your connection.',
  server: 'Something went wrong on our side. Try again.',
  unknown: 'Something went wrong. Try again.',
};

export const friendlyMessage = (kind: ApiErrorKind) => FRIENDLY[kind];

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422 || status === 413) return 'validation';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 502 || status === 503) return 'unavailable';
  if (status === 504) return 'timeout';
  if (status >= 500) return 'server';
  return 'unknown';
}

function isEnvelope(x: unknown): x is ApiErrorBody {
  return !!x && typeof x === 'object' && 'error' in x && !!(x as ApiErrorBody).error && typeof (x as ApiErrorBody).error.code === 'string';
}

/** Map an HTTP error response (status, parsed body, Retry-After header) to an ApiError. */
export function errorFromResponse(status: number, body: unknown, retryAfterHeader?: string | null, requestIdHeader?: string | null): ApiError {
  const kind = kindForStatus(status);
  const env = isEnvelope(body) ? body.error : undefined;
  const headerRetry = retryAfterHeader ? parseRetryAfter(retryAfterHeader) : undefined;
  return {
    kind,
    code: env?.code,
    // Server messages are written for users; fall back to our own when missing.
    message: env?.message || FRIENDLY[kind],
    status,
    requestId: env?.requestId ?? requestIdHeader ?? undefined,
    retryAfterSeconds: env?.retryAfterSeconds ?? headerRetry,
    details: env?.details,
    // 504 from the gateway: the origin may have finished the work.
    ambiguous: status === 504 ? true : undefined,
  };
}

/** Retry-After as seconds (number or HTTP date). */
export function parseRetryAfter(v: string, now = Date.now()): number | undefined {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 1000)) : undefined;
}

export function clientError(kind: ApiErrorKind, extra: Partial<ApiError> = {}): ApiError {
  return { kind, message: FRIENDLY[kind], ...extra };
}
