/**
 * Shared wire contracts (D-051): the standard API envelope used by every /v1 route and the gateway,
 * and the health endpoints the load balancer will probe. Status: contracts implemented and tested;
 * no backend serves them yet (Pending provider selection).
 */

/** Machine-readable error codes. The HTTP status carries the class; `code` the precise reason. */
export type ApiErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'idempotency_conflict'
  | 'quote_expired'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_api_version'
  | 'service_unavailable'
  | 'maintenance'
  | 'gateway_timeout'
  | 'origin_unavailable'
  | 'internal_error';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | string;
    /** Safe, user-presentable sentence. Never internal hostnames, stack traces or SQL. */
    message: string;
    /** Same value as the x-request-id response header, for support. */
    requestId: string;
    /** Present on 429 and 503: when it is safe to try again. */
    retryAfterSeconds?: number;
    /** Field-level validation problems: { field: message }. */
    details?: Record<string, string>;
  };
}

export interface ApiSuccessBody<T> {
  data: T;
  /** Optional paging / versioning metadata. */
  meta?: { requestId?: string; nextCursor?: string | null; version?: string };
}

export const API_VERSION = 'v1';

/** HTTP status for each error code (gateway and backend must agree). */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 409,
  quote_expired: 409,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_api_version: 400,
  service_unavailable: 503,
  maintenance: 503,
  gateway_timeout: 504,
  origin_unavailable: 502,
  internal_error: 500,
};

export function errorBody(code: ApiErrorCode, message: string, requestId: string, extra: { retryAfterSeconds?: number; details?: Record<string, string> } = {}): ApiErrorBody {
  return { error: { code, message, requestId, ...extra } };
}

/* ---------- Health ---------- */

export type HealthStatus = 'ok' | 'degraded' | 'unavailable';

/**
 * GET /health/live  → is the process running (no dependency checks; 200 unless the process is broken).
 * GET /health/ready → can this instance serve traffic now: includes critical dependencies (database,
 *                     cache, payment provider reachability). 503 when not ready, so the load balancer
 *                     stops sending new requests.
 */
export interface HealthReport {
  status: HealthStatus;
  /** Deployed build version (git sha / release tag). */
  version: string;
  /** Internal detail per dependency. Never returned on the public endpoint. */
  checks?: Record<string, 'ok' | 'fail'>;
  /** Internal only: milliseconds per check, for dashboards. */
  timingsMs?: Record<string, number>;
}

/** Readiness from dependency checks: any critical failure → unavailable; a non-critical one → degraded. */
export function readiness(version: string, checks: Record<string, 'ok' | 'fail'>, critical: string[]): HealthReport {
  const failed = Object.entries(checks).filter(([, v]) => v === 'fail').map(([k]) => k);
  const status: HealthStatus = failed.some((f) => critical.includes(f)) ? 'unavailable' : failed.length ? 'degraded' : 'ok';
  return { status, version, checks };
}

/** What a public caller sees: status and version only, so dependency names and timings don't leak. */
export function publicHealth(r: HealthReport): { status: HealthStatus; version: string } {
  return { status: r.status, version: r.version };
}

/** HTTP status for a health response: degraded still serves (200), unavailable is 503. */
export const healthHttpStatus = (r: Pick<HealthReport, 'status'>) => (r.status === 'unavailable' ? 503 : 200);
