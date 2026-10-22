/**
 * Rate limiting interface (D-051). The in-memory limiter below is per Worker isolate, so it is only a
 * first line and a test double: production limits belong in Cloudflare Rate Limiting rules (by path and
 * IP) or a Durable Object counter shared across isolates. Status: Implemented (local), production pending.
 */

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string, limit: { requests: number; windowSeconds: number }, now: number): Promise<RateLimitDecision> | RateLimitDecision;
}

export class MemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  hit(key: string, limit: { requests: number; windowSeconds: number }, now: number): RateLimitDecision {
    const span = limit.windowSeconds * 1000;
    const start = Math.floor(now / span) * span;
    const w = this.windows.get(key);
    const cur = w && w.start === start ? w : { start, count: 0 };
    cur.count += 1;
    this.windows.set(key, cur);
    if (this.windows.size > 50_000) this.windows.clear();
    const allowed = cur.count <= limit.requests;
    return { allowed, remaining: Math.max(0, limit.requests - cur.count), retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((start + span - now) / 1000)) };
  }
}
