/**
 * Standard API responses (D-051), the same shape the apps' API client expects:
 *   success  { data, requestId }
 *   failure  { error: { code, message, requestId, retryAfterSeconds?, details? } }
 * Error bodies never contain origin addresses, stack traces or internal configuration.
 */

export type ErrorCode =
  | 'invalid_request'
  | 'invalid_json'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'unsupported_api_version'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'rate_limited'
  | 'upstream_error'
  | 'backend_not_configured'
  | 'no_healthy_origin'
  | 'temporarily_unavailable'
  | 'service_unavailable'
  | 'gateway_timeout';

const MESSAGES: Record<ErrorCode, string> = {
  invalid_request: 'The request isn’t valid.',
  invalid_json: 'The request body isn’t valid JSON.',
  unauthenticated: 'Sign in to continue.',
  forbidden: 'You can’t do that.',
  not_found: 'Not found.',
  unsupported_api_version: 'This API version isn’t supported. Update the app.',
  method_not_allowed: 'This method isn’t allowed here.',
  payload_too_large: 'The request is too large.',
  rate_limited: 'Too many requests. Try again shortly.',
  upstream_error: 'Something went wrong on our side. Try again.',
  backend_not_configured: 'The GoBye service is not available yet.',
  no_healthy_origin: 'The service is busy. Please try again shortly.',
  temporarily_unavailable: 'This is unavailable for a short while.',
  service_unavailable: 'The service is unavailable. Try again shortly.',
  gateway_timeout: 'The service took too long to answer. Check the status before trying again.',
};

/** Headers every gateway response carries: never cached, no sniffing, no framing. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function errorResponse(status: number, code: ErrorCode, requestId: string, opts: { message?: string; retryAfterSeconds?: number; details?: unknown; headers?: Record<string, string> } = {}): Response {
  const body = {
    error: {
      code,
      message: opts.message ?? MESSAGES[code],
      requestId,
      ...(opts.retryAfterSeconds !== undefined ? { retryAfterSeconds: opts.retryAfterSeconds } : {}),
      ...(opts.details !== undefined ? { details: opts.details } : {}),
    },
  };
  const headers: Record<string, string> = { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId, ...(opts.headers ?? {}) };
  if (opts.retryAfterSeconds !== undefined) headers['Retry-After'] = String(opts.retryAfterSeconds);
  return new Response(JSON.stringify(body), { status, headers });
}

export function dataResponse(status: number, data: unknown, requestId: string): Response {
  return new Response(JSON.stringify({ data, requestId }), { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId } });
}
