import { describe, expect, it } from 'vitest';
import { createGateway, type GatewayEnv } from '../src/workers/api-gateway/gateway';
import { verifyOriginRequest } from '../src/workers/api-gateway/originAuth';
import { matchRoute } from '../src/workers/api-gateway/routes';

const TOKEN = 'Bearer abcdefghijklmnop0123456789';
const A = { id: 'origin-a', endpoint: 'https://a.internal.example', region: 'eu', provider: 'pending', health: 'healthy', weight: 50, priority: 1, maintenance: false, version: '1', lastHealthyAt: 0, lastFailoverAt: null };
const B = { ...A, id: 'origin-b', endpoint: 'https://b.internal.example', priority: 2 };
const env = (over: Partial<GatewayEnv> = {}): GatewayEnv => ({ ORIGINS_JSON: JSON.stringify([A, B]), TRAFFIC_POLICY: 'primary_only', ORIGIN_AUTH_SECRET: 'test-secret-not-real', ENVIRONMENT: 'development', ...over });

type Seen = { url: string; method: string; headers: Record<string, string>; body: string };
function gw(handler: (r: Request) => Promise<Response> | Response = () => Response.json({ data: { ok: true }, requestId: 'x' })) {
  const seen: Seen[] = [];
  const logs: Record<string, unknown>[] = [];
  let n = 0;
  const g = createGateway({
    fetchOrigin: async (r) => {
      seen.push({ url: r.url, method: r.method, headers: Object.fromEntries(r.headers), body: r.body ? await r.clone().text() : '' });
      return handler(r);
    },
    now: () => 1_792_700_000_000,
    rand: () => 0.5,
    log: (l) => logs.push(l),
    newRequestId: () => `req-${++n}`,
  });
  return { g, seen, logs };
}
const req = (path: string, init: RequestInit = {}) => new Request(`https://api.gobye.app${path}`, { ...init, headers: { 'cf-connecting-ip': '102.89.1.10', ...(init.headers as Record<string, string>) } });

describe('API gateway: routing', () => {
  it('classifies /v1 routes, booking creation separately from trips in progress', () => {
    expect(matchRoute('POST', '/v1/rides')).toMatchObject({ kind: 'api', rule: { routeClass: 'rides_create' } });
    expect(matchRoute('POST', '/v1/rides/bk-1/cancel')).toMatchObject({ kind: 'api', rule: { routeClass: 'rides_active' } });
    expect(matchRoute('POST', '/v1/auth/otp')).toMatchObject({ kind: 'api', isOtp: true });
    for (const a of ['users', 'drivers', 'fares', 'offers', 'payments', 'files', 'notifications', 'support']) expect(matchRoute('GET', `/v1/${a}/me`).kind).toBe('api');
    // apps/api routes (D-059) reach the origin.
    for (const p of ['/v1/me', '/v1/costs/expenses', '/v1/costs/break-even', '/v1/ops/health']) expect(matchRoute('GET', p)).toMatchObject({ kind: 'api', rule: { routeClass: 'users' } });
    expect(matchRoute('GET', '/v2/rides')).toEqual({ kind: 'unsupported_version', version: 'v2' });
    expect(matchRoute('GET', '/v1/admin/secret')).toEqual({ kind: 'not_found' });
  });

  it('passes WhatsApp webhooks (no bearer token) to the origin with the exact body and Meta signature (D-064)', async () => {
    expect(matchRoute('POST', '/v1/webhooks/whatsapp')).toMatchObject({ kind: 'api', rule: { routeClass: 'webhooks', auth: false } });
    const { g, seen } = gw();
    const body = '{"object":"whatsapp_business_account",  "entry":[]}'; // spacing kept: the signature covers these bytes
    const res = await g.fetch(req('/v1/webhooks/whatsapp', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) } }), env());
    expect(res.status).toBe(200);
    expect(seen[0]!.body).toBe(body);
    expect(seen[0]!.headers['x-hub-signature-256']).toBe('sha256=' + 'a'.repeat(64));
    expect(seen[0]!.headers['x-gobye-origin-auth']).toMatch(/^t=\d+,sig=/);
    const verify = await g.fetch(req('/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123'), env());
    expect(verify.status).toBe(200);
    expect((await g.fetch(req('/v1/webhooks/whatsapp', { method: 'DELETE' }), env())).status).toBe(405);
  });

  it('forwards to the primary origin with the path, request id and a signed origin header', async () => {
    const { g, seen } = gw();
    const res = await g.fetch(req('/v1/users/me?x=1', { headers: { authorization: TOKEN } }), env());
    expect(res.status).toBe(200);
    expect(seen[0].url).toBe('https://a.internal.example/v1/users/me?x=1');
    expect(seen[0].headers['x-request-id']).toBe('req-1');
    expect(res.headers.get('x-request-id')).toBe('req-1');
    const sig = seen[0].headers['x-gobye-origin-auth'];
    expect(await verifyOriginRequest('test-secret-not-real', 'req-1', sig, 1_792_700_000_000, 'GET', '/v1/users/me?x=1')).toBe(true);
    expect(await verifyOriginRequest('wrong', 'req-1', sig, 1_792_700_000_000, 'GET', '/v1/users/me?x=1')).toBe(false);
    // Bound to the method and path: the same header can't be replayed against another route.
    expect(await verifyOriginRequest('test-secret-not-real', 'req-1', sig, 1_792_700_000_000, 'POST', '/v1/users/me?x=1')).toBe(false);
    expect(await verifyOriginRequest('test-secret-not-real', 'req-1', sig, 1_792_700_000_000, 'GET', '/v1/costs/expenses')).toBe(false);
  });

  it('health endpoints: live always; ready only with a usable origin, without dependency details', async () => {
    const { g } = gw();
    expect((await g.fetch(req('/health/live'), env())).status).toBe(200);
    expect((await g.fetch(req('/health/ready'), env())).status).toBe(200);
    const notReady = await g.fetch(req('/health/ready'), env({ ORIGINS_JSON: '[]' }));
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ error: { code: 'service_unavailable', message: 'Not ready.', requestId: 'req-3', retryAfterSeconds: 30 } });
  });

  it('no backend configured yet: an honest 503 backend_not_configured', async () => {
    const { g, seen } = gw();
    const res = await g.fetch(req('/v1/rides', { method: 'POST', headers: { authorization: TOKEN, 'content-type': 'application/json' }, body: '{}' }), env({ ORIGINS_JSON: undefined }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('backend_not_configured');
    expect(res.headers.get('retry-after')).toBe('30');
    expect(seen).toHaveLength(0);
  });

  it('unknown API version and unknown routes get the standard envelope', async () => {
    const { g } = gw();
    const v2 = await g.fetch(req('/v2/rides'), env());
    expect(v2.status).toBe(404);
    expect((await v2.json()).error.code).toBe('unsupported_api_version');
    expect((await g.fetch(req('/v1/nope'), env())).status).toBe(404);
  });
});

describe('API gateway: request checks', () => {
  it('missing or malformed auth on a protected route → 401, before reaching any origin', async () => {
    const { g, seen } = gw();
    expect((await g.fetch(req('/v1/payments/methods'), env())).status).toBe(401);
    expect((await g.fetch(req('/v1/payments/methods', { headers: { authorization: 'Bearer short' } }), env())).status).toBe(401);
    expect(seen).toHaveLength(0);
    // Auth routes don't need a token (the backend still checks codes and passwords).
    expect((await g.fetch(req('/v1/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env())).status).toBe(200);
  });

  it('invalid JSON → 400; non-JSON body → 400; too large → 413; wrong method → 405', async () => {
    const { g } = gw();
    const h = { authorization: TOKEN, 'content-type': 'application/json' };
    expect((await g.fetch(req('/v1/offers', { method: 'POST', headers: h, body: '{bad' }), env())).status).toBe(400);
    expect((await g.fetch(req('/v1/offers', { method: 'POST', headers: { authorization: TOKEN, 'content-type': 'text/plain' }, body: 'hi' }), env())).status).toBe(400);
    const big = JSON.stringify({ x: 'a'.repeat(9_000) });
    const tooBig = await g.fetch(req('/v1/files/uploads', { method: 'POST', headers: h, body: big }), env());
    expect(tooBig.status).toBe(413);
    expect((await tooBig.json()).error.code).toBe('payload_too_large');
    const m = await g.fetch(req('/v1/users/me', { method: 'PROPFIND', headers: h }), env());
    expect(m.status).toBe(405);
    expect(m.headers.get('allow')).toContain('GET');
  });

  it('rate limit → 429 with Retry-After; one-time codes have a tighter limit; safety is never limited', async () => {
    const { g } = gw();
    const h = { authorization: TOKEN, 'content-type': 'application/json' };
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) last = await g.fetch(req('/v1/rides', { method: 'POST', headers: h, body: '{}' }), env());
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await last!.json()).error.code).toBe('rate_limited');
    let otp: Response | null = null;
    for (let i = 0; i < 6; i++) otp = await g.fetch(req('/v1/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env());
    expect(otp!.status).toBe(429);
    for (let i = 0; i < 50; i++) expect((await g.fetch(req('/v1/safety/sos', { method: 'POST', headers: h, body: '{}' }), env())).status).toBe(200);
  });

  it('strips spoofed forwarding, identity and admin headers; the client IP comes from CF-Connecting-IP only', async () => {
    const { g, seen } = gw();
    await g.fetch(
      req('/v1/users/me', {
        headers: { authorization: TOKEN, 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4', 'x-user-id': 'admin', 'x-gobye-role': 'admin', 'x-admin-override': '1', forwarded: 'for=1.2.3.4', cookie: 'a=b', 'x-request-id': 'client-abc-123' },
      }),
      env(),
    );
    const h = seen[0].headers;
    expect(h['x-forwarded-for']).toBe('102.89.1.10');
    for (const k of ['x-real-ip', 'x-user-id', 'x-gobye-role', 'x-admin-override', 'forwarded', 'cookie']) expect(h[k]).toBeUndefined();
    expect(h['x-client-request-id']).toBe('client-abc-123');
    expect(h['x-request-id']).toBe('req-1');
    expect(h.authorization).toBe(TOKEN);
  });

  it('responses are never cacheable and drop origin internals (Server, Set-Cookie, X-Powered-By)', async () => {
    const { g } = gw(() => new Response('{"data":{"fare":720000}}', { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600', server: 'nginx/1.2', 'x-powered-by': 'Express', 'set-cookie': 's=1' } }));
    const res = await g.fetch(req('/v1/fares/quote', { method: 'POST', headers: { authorization: TOKEN, 'content-type': 'application/json' }, body: '{}' }), env());
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('server')).toBeNull();
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('CORS only for allowed web origins (and CORS is not authentication)', async () => {
    const { g } = gw();
    const ok = await g.fetch(req('/v1/users/me', { method: 'OPTIONS', headers: { origin: 'https://admin.gobye.app' } }), env({ ALLOWED_ORIGINS: 'https://admin.gobye.app' }));
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://admin.gobye.app');
    const bad = await g.fetch(req('/v1/users/me', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env({ ALLOWED_ORIGINS: 'https://admin.gobye.app' }));
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    expect((await g.fetch(req('/v1/users/me', { headers: { origin: 'https://admin.gobye.app' } }), env({ ALLOWED_ORIGINS: 'https://admin.gobye.app' }))).status).toBe(401);
  });

  it('logs one structured line per request without tokens, query strings or origin addresses', async () => {
    const { g, logs } = gw();
    await g.fetch(req('/v1/users/me?phone=0803', { headers: { authorization: TOKEN } }), env());
    const line = JSON.stringify(logs[0]);
    expect(logs[0]).toMatchObject({ service: 'api-gateway', requestId: 'req-1', status: 200, routeClass: 'users', origin: 'origin-a' });
    expect(line).not.toContain('abcdefghijklmnop');
    expect(line).not.toContain('0803');
    expect(line).not.toContain('internal.example');
  });
});
