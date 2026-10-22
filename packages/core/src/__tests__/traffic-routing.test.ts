import { ALWAYS_ALLOWED, OriginHealthTracker, canRetryOnAnotherOrigin, effectiveWeight, isRouteAllowed, selectOrigin, type BackendOrigin, type TrafficPolicy } from '../traffic';

const now = Date.UTC(2026, 9, 23, 9);
const origin = (id: string, priority: number, over: Partial<BackendOrigin> = {}): BackendOrigin => ({
  id, endpoint: `https://${id}.origin.test`, region: 'eu-west', provider: 'Provider (pending selection)', health: 'healthy', weight: 50, priority, maintenance: false, version: '1.0.0', lastHealthyAt: now, lastFailoverAt: null, ...over,
});
const policy = (kind: TrafficPolicy['kind'], over: Partial<TrafficPolicy> = {}): TrafficPolicy => ({ kind, version: 1, updatedAt: now, updatedBy: 'test', ...over });
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('origin selection', () => {
  it('no origins configured → an honest 503 (backend not chosen yet)', () => {
    const r = selectOrigin(policy('primary_only'), [], 'rides_create');
    expect(r).toMatchObject({ ok: false, status: 503, code: 'backend_not_configured', retryAfterSeconds: 30 });
  });

  it('primary down → traffic fails over to the secondary', () => {
    const a = origin('a', 1, { health: 'unhealthy' }), b = origin('b', 2);
    const r = selectOrigin(policy('primary_only'), [a, b], 'rides_create');
    expect(r).toMatchObject({ ok: true, reason: 'failover' });
    if (r.ok) expect(r.origin.id).toBe('b');
    const healthy = selectOrigin(policy('primary_only'), [origin('a', 1), b], 'rides_create');
    expect(healthy.ok && healthy.origin.id).toBe('a');
  });

  it('both down → 503 with Retry-After', () => {
    const r = selectOrigin(policy('weighted'), [origin('a', 1, { health: 'unhealthy' }), origin('b', 2, { health: 'unhealthy' })], 'fares');
    expect(r).toMatchObject({ ok: false, code: 'no_healthy_origin', retryAfterSeconds: 30 });
  });

  it('a drained (maintenance) origin takes no new traffic; secondary-only prefers the secondary and falls back', () => {
    const r = selectOrigin(policy('primary_only'), [origin('a', 1, { maintenance: true }), origin('b', 2)], 'users');
    expect(r.ok && r.origin.id).toBe('b');
    expect(selectOrigin(policy('secondary_only'), [origin('a', 1), origin('b', 2)], 'users')).toMatchObject({ ok: true, reason: 'secondary' });
    const fb = selectOrigin(policy('secondary_only'), [origin('a', 1), origin('b', 2, { health: 'unhealthy' })], 'users');
    expect(fb.ok && fb.origin.id).toBe('a');
  });

  it('weighted 80/20 split stays within tolerance (seeded)', () => {
    const rand = seeded(42);
    const os = [origin('a', 1, { weight: 80 }), origin('b', 2, { weight: 20 })];
    let a = 0;
    for (let i = 0; i < 10_000; i++) {
      const r = selectOrigin(policy('weighted'), os, 'fares', rand, { now });
      if (r.ok && r.origin.id === 'a') a++;
    }
    expect(a / 10_000).toBeGreaterThan(0.77);
    expect(a / 10_000).toBeLessThan(0.83);
  });

  it('a recovered origin ramps up gradually instead of taking its full share at once', () => {
    const b = origin('b', 2, { weight: 50, recoveredAt: now });
    expect(effectiveWeight(b, now)).toBeCloseTo(5);
    expect(effectiveWeight(b, now + 150_000)).toBeCloseTo(27.5);
    expect(effectiveWeight(b, now + 10 * 60_000)).toBe(50);
  });

  it('maintenance pauses new bookings but never trips in progress, safety or support', () => {
    const p = policy('maintenance');
    expect(isRouteAllowed(p, 'rides_create')).toBe(false);
    expect(isRouteAllowed(p, 'offers')).toBe(false);
    for (const c of ALWAYS_ALLOWED) expect(isRouteAllowed(p, c)).toBe(true);
    expect(selectOrigin(p, [origin('a', 1)], 'rides_create')).toMatchObject({ ok: false, code: 'temporarily_unavailable', retryAfterSeconds: 120 });
    expect(selectOrigin(p, [origin('a', 1)], 'rides_active').ok).toBe(true);
  });

  it('emergency switches off only the listed operations', () => {
    const p = policy('emergency', { disabled: ['payments', 'files'] });
    expect(isRouteAllowed(p, 'payments')).toBe(false);
    expect(isRouteAllowed(p, 'files')).toBe(false);
    expect(isRouteAllowed(p, 'rides_create')).toBe(true);
    expect(isRouteAllowed(p, 'safety')).toBe(true);
  });

  it('never replays a write without an idempotency key on another origin', () => {
    expect(canRetryOnAnotherOrigin('GET')).toBe(true);
    expect(canRetryOnAnotherOrigin('POST')).toBe(false);
    expect(canRetryOnAnotherOrigin('POST', 'short')).toBe(false);
    expect(canRetryOnAnotherOrigin('POST', 'bk-3f9a2c7e-01')).toBe(true);
    expect(canRetryOnAnotherOrigin('PATCH', null)).toBe(false);
  });
});

describe('health tracking', () => {
  it('one failed check does not flip traffic; three do; two good checks bring it back (hysteresis)', () => {
    const t = new OriginHealthTracker();
    let o = origin('a', 1);
    const fail = { ok: false, latencyMs: 0 }, ok = { ok: true, latencyMs: 120 };
    o = t.record(o, fail, now).origin;
    expect(o.health).toBe('degraded');
    o = t.record(o, ok, now + 1).origin;
    expect(o.health).toBe('healthy');
    for (let i = 0; i < 2; i++) o = t.record(o, fail, now + 2 + i).origin;
    expect(o.health).toBe('degraded');
    const down = t.record(o, fail, now + 10);
    expect(down.origin.health).toBe('unhealthy');
    expect(down.event).toMatchObject({ from: 'degraded', to: 'unhealthy' });
    o = t.record(down.origin, ok, now + 20).origin;
    expect(o.health).toBe('unhealthy');
    const up = t.record(o, ok, now + 30);
    expect(up.origin.health).toBe('healthy');
    expect(up.origin.recoveredAt).toBe(now + 30);
  });

  it('flapping checks never mark a healthy origin unhealthy', () => {
    const t = new OriginHealthTracker();
    let o = origin('a', 1);
    for (let i = 0; i < 20; i++) o = t.record(o, { ok: i % 2 === 0, latencyMs: 100 }, now + i).origin;
    expect(o.health).not.toBe('unhealthy');
  });

  it('slow checks mark an origin degraded, still usable', () => {
    const t = new OriginHealthTracker();
    const o = t.record(origin('a', 1), { ok: true, latencyMs: 4000 }, now).origin;
    expect(o.health).toBe('degraded');
    expect(selectOrigin(policy('primary_only'), [o], 'fares').ok).toBe(true);
  });
});

describe('durable state during a transition (contract)', () => {
  it('an active trip keeps working when traffic moves: the trip lives in the shared database, not in an origin', () => {
    // Simulated shared store standing in for the database both origins use.
    const db = new Map<string, { status: string }>([['trip-1', { status: 'in_progress' }]]);
    const read = (originId: string, id: string) => ({ servedBy: originId, trip: db.get(id) });
    const before = selectOrigin(policy('primary_only'), [origin('a', 1), origin('b', 2)], 'rides_active');
    const after = selectOrigin(policy('primary_only'), [origin('a', 1, { health: 'unhealthy' }), origin('b', 2)], 'rides_active');
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(read(before.origin.id, 'trip-1').trip).toEqual(read(after.origin.id, 'trip-1').trip);
      expect(after.origin.id).toBe('b');
    }
  });

  it('a payment resent after reconnecting is answered from the idempotency record, not charged twice', () => {
    const charges: string[] = [];
    const records = new Map<string, { status: 'paid'; ref: string }>();
    const pay = (key: string) => {
      const prior = records.get(key);
      if (prior) return { ...prior, replayed: true };
      charges.push(key);
      const r = { status: 'paid' as const, ref: `ref-${charges.length}` };
      records.set(key, r);
      return { ...r, replayed: false };
    };
    const first = pay('bk-123-pay-1');
    // The first origin died after charging but before answering; the client reconnects via origin B.
    const second = pay('bk-123-pay-1');
    expect(charges).toHaveLength(1);
    expect(second).toEqual({ ...first, replayed: true });
  });
});
