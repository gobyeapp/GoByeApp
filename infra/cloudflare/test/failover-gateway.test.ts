import { describe, expect, it } from 'vitest';
import { createGateway, type GatewayEnv } from '../src/workers/api-gateway/gateway';

const TOKEN = 'Bearer abcdefghijklmnop0123456789';
const base = { region: 'eu', provider: 'pending', health: 'healthy', weight: 50, maintenance: false, version: '1', lastHealthyAt: 0, lastFailoverAt: null };
const A = { ...base, id: 'origin-a', endpoint: 'https://a.internal.example', priority: 1 };
const B = { ...base, id: 'origin-b', endpoint: 'https://b.internal.example', priority: 2 };
const env = (origins: unknown[], policy = 'primary_only'): GatewayEnv => ({ ORIGINS_JSON: JSON.stringify(origins), TRAFFIC_POLICY: policy, ORIGIN_AUTH_SECRET: 'test-secret-not-real' });
const req = (path: string, init: RequestInit = {}) => new Request(`https://api.gobye.app${path}`, { ...init, headers: { authorization: TOKEN, 'content-type': 'application/json', ...(init.headers as Record<string, string>) } });

function gw(behaviour: Record<string, 'ok' | 'down' | 'hang' | '503' | '500'>) {
  const calls: string[] = [];
  const g = createGateway({
    log: () => undefined,
    rand: () => 0.1,
    fetchOrigin: (r) => {
      const host = new URL(r.url).host;
      calls.push(`${r.method} ${host}`);
      const b = behaviour[host] ?? 'ok';
      if (b === 'down') return Promise.reject(new TypeError('connect ECONNREFUSED'));
      if (b === 'hang') return new Promise((_, rej) => r.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      if (b === '503') return Promise.resolve(new Response('upstream overloaded at 10.0.0.5', { status: 503 }));
      if (b === '500') return Promise.resolve(new Response('Error: at /srv/app/index.js:42 db=postgres://u:p@10.0.0.9', { status: 500 }));
      return Promise.resolve(Response.json({ data: { from: host }, requestId: 'x' }));
    },
  });
  return { g, calls };
}

describe('API gateway: failover (simulated origins)', () => {
  it('primary marked unhealthy → traffic goes to the secondary', async () => {
    const { g, calls } = gw({});
    const res = await g.fetch(req('/v1/users/me'), env([{ ...A, health: 'unhealthy' }, B]));
    expect(res.status).toBe(200);
    expect(calls).toEqual(['GET b.internal.example']);
  });

  it('primary unreachable on a safe read → retried once on the secondary', async () => {
    const { g, calls } = gw({ 'a.internal.example': 'down' });
    const res = await g.fetch(req('/v1/users/me'), env([A, B]));
    expect(res.status).toBe(200);
    expect(calls).toEqual(['GET a.internal.example', 'GET b.internal.example']);
  });

  it('a booking POST without an idempotency key is NOT replayed on another origin', async () => {
    const { g, calls } = gw({ 'a.internal.example': 'down' });
    const res = await g.fetch(req('/v1/rides', { method: 'POST', body: '{}' }), env([A, B]));
    expect(res.status).toBe(502);
    expect(calls).toEqual(['POST a.internal.example']);
  });

  it('a payment POST with an idempotency key may move to the secondary when the primary refused the connection', async () => {
    const { g, calls } = gw({ 'a.internal.example': 'down' });
    const res = await g.fetch(req('/v1/payments/charges', { method: 'POST', body: '{}', headers: { 'idempotency-key': 'bk-123-pay-1' } }), env([A, B]));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('origin timeout → 504 and the write is not replayed (it may have succeeded)', async () => {
    const { g, calls } = gw({ 'a.internal.example': 'hang' });
    const started = Date.now();
    const res = await g.fetch(req('/v1/offers', { method: 'POST', body: '{}', headers: { 'idempotency-key': 'of-123-abcdef' } }), env([A, B]));
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe('gateway_timeout');
    expect(calls).toEqual(['POST a.internal.example']);
    expect(Date.now() - started).toBeGreaterThanOrEqual(7_900);
  }, 15_000);

  it('both origins down → 502 for the retried read; both marked unhealthy → 503 no_healthy_origin', async () => {
    const { g } = gw({ 'a.internal.example': 'down', 'b.internal.example': 'down' });
    expect((await g.fetch(req('/v1/users/me'), env([A, B]))).status).toBe(502);
    const res = await g.fetch(req('/v1/users/me'), env([{ ...A, health: 'unhealthy' }, { ...B, health: 'unhealthy' }]));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('no_healthy_origin');
  });

  it('recovery: once the primary is healthy again it takes primary traffic back', async () => {
    const { g, calls } = gw({});
    await g.fetch(req('/v1/users/me'), env([{ ...A, health: 'unhealthy' }, B]));
    await g.fetch(req('/v1/users/me'), env([{ ...A, health: 'healthy', recoveredAt: Date.now() }, B]));
    expect(calls).toEqual(['GET b.internal.example', 'GET a.internal.example']);
  });

  it('origin 5xx bodies are replaced: no stack traces or internal addresses reach the client', async () => {
    const { g } = gw({ 'a.internal.example': '500' });
    const res = await g.fetch(req('/v1/users/me'), env([A]));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('10.0.0');
    expect(text).not.toContain('postgres');
    expect(text).not.toContain('internal.example');
    expect(JSON.parse(text).error.code).toBe('upstream_error');
  });

  it('maintenance policy: new bookings get 503 with Retry-After; trips in progress still route', async () => {
    const { g, calls } = gw({});
    const blocked = await g.fetch(req('/v1/rides', { method: 'POST', body: '{}' }), env([A, B], 'maintenance'));
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get('retry-after')).toBe('120');
    expect((await g.fetch(req('/v1/rides/bk-1/status'), env([A, B], 'maintenance'))).status).toBe(200);
    expect(calls).toEqual(['GET a.internal.example']);
  });
});
