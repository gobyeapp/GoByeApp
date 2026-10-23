import { ERROR_STATUS, type ApiErrorCode } from '@gobye/core';

/**
 * Structured API errors (envelope from packages/core/src/infra/health.ts, shared with the gateway and the
 * app's API client). Generic codes are lower case (`validation_failed`); domain codes from API_CONTRACTS.md
 * are upper case (`NO_ACTIVE_ACCESS`). `message` is always safe to show: never SQL, hostnames or stack traces.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: { details?: Record<string, string>; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'AppError';
  }

  static of(code: ApiErrorCode, message: string, extra?: AppError['extra']) {
    return new AppError(ERROR_STATUS[code], code, message, extra);
  }
}

export const Errors = {
  validation: (details: Record<string, string>, message = 'Some details are missing or not valid.') => AppError.of('validation_failed', message, { details }),
  unauthenticated: (message = 'Sign in to continue.') => AppError.of('unauthenticated', message),
  tokenExpired: () => new AppError(401, 'TOKEN_EXPIRED', 'Your session has expired. Sign in again.'),
  forbidden: (message = 'You do not have access to this.') => AppError.of('forbidden', message),
  mfaRequired: () => new AppError(403, 'MFA_REQUIRED', 'Confirm your sign-in with your second factor to use staff tools.'),
  suspended: () => new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.'),
  notFound: (message = 'Not found.') => AppError.of('not_found', message),
  conflict: (message: string) => AppError.of('conflict', message),
  idempotencyConflict: () => AppError.of('idempotency_conflict', 'This Idempotency-Key was already used for a different request.'),
  inProgress: () => AppError.of('conflict', 'The same request is still being processed. Try again shortly.', { retryAfterSeconds: 2 }),
  unavailable: (message = 'The service is temporarily unavailable. Try again shortly.') => AppError.of('service_unavailable', message, { retryAfterSeconds: 5 }),
  notConfigured: (what: string) => new AppError(503, 'NOT_CONFIGURED', `${what} is not connected yet.`),
};
