import { isRouteAllowed, type BackendOrigin, type OriginHealth, type RouteClass, type TrafficPolicy } from './model';

/**
 * Pure origin selection for the gateway (D-051). The gateway (or, later, Cloudflare Load Balancing)
 * decides where each new request goes; durable state (bookings, trips, payments) lives in the database,
 * so moving traffic between origins never moves or loses a trip.
 */

export type OriginSelection =
  | { ok: true; origin: BackendOrigin; reason: 'primary' | 'failover' | 'weighted' | 'secondary' }
  | { ok: false; status: 503; code: 'backend_not_configured' | 'no_healthy_origin' | 'temporarily_unavailable'; retryAfterSeconds: number; message: string };

export interface OriginSelectOptions {
  now?: number;
  /** Time over which a recovered origin ramps back to its full weight. */
  rampMs?: number;
}

export const DEFAULT_RAMP_MS = 5 * 60_000;
export const RETRY_AFTER_NO_ORIGIN = 30;
export const RETRY_AFTER_RESTRICTED = 120;

const usable = (o: BackendOrigin) => !o.maintenance && (o.health === 'healthy' || o.health === 'degraded');
const rank = (h: OriginHealth) => (h === 'healthy' ? 0 : h === 'degraded' ? 1 : 2);

/** Weight after a recovery: ramps linearly from 10% to 100% over `rampMs`, so a recovered origin isn't flooded. */
export function effectiveWeight(o: BackendOrigin, now: number, rampMs = DEFAULT_RAMP_MS): number {
  if (!o.recoveredAt || rampMs <= 0) return o.weight;
  const t = Math.min(1, Math.max(0, (now - o.recoveredAt) / rampMs));
  return o.weight * (0.1 + 0.9 * t);
}

export function selectOrigin(policy: TrafficPolicy, origins: BackendOrigin[], routeClass: RouteClass, rand: () => number = Math.random, opts: OriginSelectOptions = {}): OriginSelection {
  if (!isRouteAllowed(policy, routeClass)) {
    return {
      ok: false,
      status: 503,
      code: 'temporarily_unavailable',
      retryAfterSeconds: RETRY_AFTER_RESTRICTED,
      message: policy.notice ?? (policy.kind === 'maintenance' ? 'New bookings are paused for a short while. Trips in progress are not affected.' : 'This is switched off for a short while.'),
    };
  }
  if (origins.length === 0) {
    return { ok: false, status: 503, code: 'backend_not_configured', retryAfterSeconds: RETRY_AFTER_NO_ORIGIN, message: 'The GoBye service is not available yet.' };
  }
  const byPriority = [...origins].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const live = byPriority.filter(usable).sort((a, b) => rank(a.health) - rank(b.health) || a.priority - b.priority);
  if (live.length === 0) {
    return { ok: false, status: 503, code: 'no_healthy_origin', retryAfterSeconds: RETRY_AFTER_NO_ORIGIN, message: 'The service is busy. Please try again shortly.' };
  }
  const primary = byPriority[0];
  if (policy.kind === 'weighted') {
    const healthy = live.filter((o) => o.health === 'healthy');
    const pool = healthy.length ? healthy : live;
    const now = opts.now ?? Date.now();
    const weights = pool.map((o) => Math.max(0, effectiveWeight(o, now, opts.rampMs)));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return { ok: true, origin: pool[0], reason: 'weighted' };
    let r = rand() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r < 0) return { ok: true, origin: pool[i], reason: 'weighted' };
    }
    return { ok: true, origin: pool[pool.length - 1], reason: 'weighted' };
  }
  if (policy.kind === 'secondary_only') {
    const secondary = byPriority.slice(1).find(usable);
    if (secondary) return { ok: true, origin: secondary, reason: 'secondary' };
    return { ok: true, origin: live[0], reason: 'failover' };
  }
  // primary_only, maintenance and emergency all route to the preferred healthy origin.
  const first = live[0];
  return { ok: true, origin: first, reason: first.id === primary.id ? 'primary' : 'failover' };
}

/**
 * Whether a failed request may be sent again to another origin. Reads are safe. Writes are only safe
 * with an idempotency key the backend honours; bookings, driver assignment and payments without one
 * are never replayed (the client checks the authoritative status instead).
 */
export function canRetryOnAnotherOrigin(method: string, idempotencyKey?: string | null): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  return !!idempotencyKey && /^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey);
}

/* ---------- Health tracking with hysteresis ---------- */

export interface OriginHealthThresholds {
  /** Consecutive failed checks before an origin is marked unhealthy. */
  unhealthyAfter: number;
  /** Consecutive good checks before an unhealthy origin is healthy again. */
  healthyAfter: number;
  /** A check slower than this counts as degraded (not failed). */
  degradedLatencyMs: number;
}

export const DEFAULT_ORIGIN_HEALTH_THRESHOLDS: OriginHealthThresholds = { unhealthyAfter: 3, healthyAfter: 2, degradedLatencyMs: 1500 };

export type OriginHealthEvent = { originId: string; from: OriginHealth; to: OriginHealth; at: number };

/** Turns raw health-check results into stable health states (one bad check doesn't flip traffic). */
export class OriginHealthTracker {
  private fails = new Map<string, number>();
  private oks = new Map<string, number>();
  constructor(private readonly thresholds: OriginHealthThresholds = DEFAULT_ORIGIN_HEALTH_THRESHOLDS) {}

  /** Record one `/health/ready` result; returns the updated origin and a transition event if the state changed. */
  record(origin: BackendOrigin, check: { ok: boolean; latencyMs: number }, now: number): { origin: BackendOrigin; event: OriginHealthEvent | null } {
    const id = origin.id;
    let next: OriginHealth = origin.health;
    if (check.ok) {
      this.fails.set(id, 0);
      const ok = (this.oks.get(id) ?? 0) + 1;
      this.oks.set(id, ok);
      const slow = check.latencyMs > this.thresholds.degradedLatencyMs;
      if (origin.health === 'unhealthy' || origin.health === 'unknown') {
        if (ok >= this.thresholds.healthyAfter) next = slow ? 'degraded' : 'healthy';
      } else next = slow ? 'degraded' : 'healthy';
    } else {
      this.oks.set(id, 0);
      const f = (this.fails.get(id) ?? 0) + 1;
      this.fails.set(id, f);
      if (f >= this.thresholds.unhealthyAfter) next = 'unhealthy';
      else if (origin.health === 'healthy') next = 'degraded';
    }
    if (next === origin.health) return { origin: { ...origin, lastHealthyAt: next === 'healthy' ? now : origin.lastHealthyAt }, event: null };
    const recovered = (origin.health === 'unhealthy' || origin.health === 'unknown') && (next === 'healthy' || next === 'degraded');
    return {
      origin: {
        ...origin,
        health: next,
        lastHealthyAt: next === 'healthy' ? now : origin.lastHealthyAt,
        lastFailoverAt: next === 'unhealthy' ? now : origin.lastFailoverAt,
        recoveredAt: recovered ? now : next === 'unhealthy' ? null : origin.recoveredAt ?? null,
      },
      event: { originId: id, from: origin.health, to: next, at: now },
    };
  }
}
