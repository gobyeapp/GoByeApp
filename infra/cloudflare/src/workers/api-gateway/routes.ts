import type { RouteClass } from '@gobye/core/src/traffic/index';

/**
 * Route table for https://api.gobye.app/v1 (D-051). Each route class has its own methods, auth rule,
 * body limit, timeout and rate limit. Large files never pass through the gateway: uploads go straight
 * to R2 with a short-lived presigned URL, so /v1/files only carries small JSON metadata.
 */

export interface RouteRule {
  routeClass: RouteClass;
  methods: readonly string[];
  /** The gateway only checks a bearer token is present; the backend still authorises every request. */
  auth: boolean;
  maxBodyBytes: number;
  timeoutMs: number;
  /** Requests per window per client key; null = never rate limited at the edge (safety). */
  limit: { requests: number; windowSeconds: number } | null;
}

const KB = 1024;
const WRITE = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const RULES: Record<RouteClass, RouteRule> = {
  auth: { routeClass: 'auth', methods: WRITE, auth: false, maxBodyBytes: 8 * KB, timeoutMs: 10_000, limit: { requests: 20, windowSeconds: 60 } },
  users: { routeClass: 'users', methods: WRITE, auth: true, maxBodyBytes: 32 * KB, timeoutMs: 10_000, limit: { requests: 120, windowSeconds: 60 } },
  drivers: { routeClass: 'drivers', methods: WRITE, auth: true, maxBodyBytes: 64 * KB, timeoutMs: 10_000, limit: { requests: 120, windowSeconds: 60 } },
  rides_create: { routeClass: 'rides_create', methods: ['POST'], auth: true, maxBodyBytes: 16 * KB, timeoutMs: 10_000, limit: { requests: 10, windowSeconds: 60 } },
  // Trips in progress post a driver position every few seconds: a generous limit, never shared with bookings.
  rides_active: { routeClass: 'rides_active', methods: WRITE, auth: true, maxBodyBytes: 16 * KB, timeoutMs: 8_000, limit: { requests: 600, windowSeconds: 60 } },
  fares: { routeClass: 'fares', methods: WRITE, auth: true, maxBodyBytes: 16 * KB, timeoutMs: 8_000, limit: { requests: 60, windowSeconds: 60 } },
  offers: { routeClass: 'offers', methods: WRITE, auth: true, maxBodyBytes: 8 * KB, timeoutMs: 8_000, limit: { requests: 30, windowSeconds: 60 } },
  payments: { routeClass: 'payments', methods: WRITE, auth: true, maxBodyBytes: 16 * KB, timeoutMs: 15_000, limit: { requests: 20, windowSeconds: 60 } },
  files: { routeClass: 'files', methods: WRITE, auth: true, maxBodyBytes: 8 * KB, timeoutMs: 10_000, limit: { requests: 30, windowSeconds: 60 } },
  notifications: { routeClass: 'notifications', methods: WRITE, auth: true, maxBodyBytes: 8 * KB, timeoutMs: 8_000, limit: { requests: 120, windowSeconds: 60 } },
  support: { routeClass: 'support', methods: WRITE, auth: true, maxBodyBytes: 32 * KB, timeoutMs: 10_000, limit: { requests: 60, windowSeconds: 60 } },
  safety: { routeClass: 'safety', methods: WRITE, auth: true, maxBodyBytes: 32 * KB, timeoutMs: 10_000, limit: null },
};

/** One-time-code requests get their own, tighter limit (SMS cost and abuse). */
export const OTP_LIMIT = { requests: 5, windowSeconds: 300 };

const SEGMENT: Record<string, RouteClass | ((method: string, rest: string[]) => RouteClass)> = {
  auth: 'auth',
  users: 'users',
  // The API's own account and staff routes (apps/api, D-059) share the account class's limits.
  me: 'users',
  costs: 'users',
  ops: 'users',
  drivers: 'drivers',
  // POST /v1/rides creates a booking; anything on /v1/rides/{id}/... is an existing ride (status, cancel, PIN, location).
  rides: (method, rest) => (rest.length === 0 && method === 'POST' ? 'rides_create' : 'rides_active'),
  fares: 'fares',
  offers: 'offers',
  payments: 'payments',
  files: 'files',
  notifications: 'notifications',
  support: 'support',
  safety: 'safety',
};

export type Match =
  | { kind: 'health'; which: 'live' | 'ready' }
  | { kind: 'api'; rule: RouteRule; path: string; isOtp: boolean }
  | { kind: 'unsupported_version'; version: string }
  | { kind: 'not_found' };

export function matchRoute(method: string, pathname: string): Match {
  if (pathname === '/health/live') return { kind: 'health', which: 'live' };
  if (pathname === '/health/ready') return { kind: 'health', which: 'ready' };
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'not_found' };
  const [version, area, ...rest] = parts;
  if (/^v\d+$/.test(version) && version !== 'v1') return { kind: 'unsupported_version', version };
  if (version !== 'v1' || !area) return { kind: 'not_found' };
  if (parts.some((p) => p === '..' || p === '.' || p.includes('%2e') || p.includes('%2E'))) return { kind: 'not_found' };
  const entry = SEGMENT[area];
  if (!entry) return { kind: 'not_found' };
  const routeClass = typeof entry === 'function' ? entry(method.toUpperCase(), rest) : entry;
  return { kind: 'api', rule: RULES[routeClass], path: `/${parts.join('/')}`, isOtp: area === 'auth' && rest[0] === 'otp' };
}
