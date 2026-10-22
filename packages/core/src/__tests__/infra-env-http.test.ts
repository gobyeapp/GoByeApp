import {
  assertMocksAllowed,
  assertQuoteFresh,
  backoffDelay,
  createApiClient,
  createLogger,
  errorFromResponse,
  findSecrets,
  lockedFare,
  memorySink,
  newIdempotencyKey,
  isIdempotencyKey,
  parsePublicConfig,
  parseRetryAfter,
  resolveAmbiguous,
  routeLabel,
  type HttpFetch,
} from '../index';
import type { Kobo } from '../types';

describe('public configuration', () => {
  it('defaults to development with mocks and local addresses', () => {
    const r = parsePublicConfig({}, 'expo');
    expect(r).toEqual({ ok: true, value: { environment: 'development', apiBaseUrl: 'http://localhost:8787/v1', realtimeUrl: 'ws://localhost:8787/v1/realtime', mediaBaseUrl: 'http://localhost:8787/media', useMocks: true, demoRelayUrl: undefined } });
  });

  it('accepts a production config with https / wss, no mocks, and trims trailing slashes', () => {
    const r = parsePublicConfig(
      { VITE_ENV: 'production', VITE_API_BASE_URL: 'https://api.gobye.app/v1/', VITE_REALTIME_URL: 'wss://realtime.gobye.app/v1', VITE_MEDIA_BASE_URL: 'https://media.gobye.app', VITE_USE_MOCKS: 'false' },
      'vite',
    );
    expect(r.ok && r.value.apiBaseUrl).toBe('https://api.gobye.app/v1');
  });

  it('lists every problem: http in production, private address, mocks on, demo relay, bad env', () => {
    const r = parsePublicConfig(
      { EXPO_PUBLIC_ENV: 'production', EXPO_PUBLIC_API_BASE_URL: 'http://api.gobye.app/v1', EXPO_PUBLIC_REALTIME_URL: 'wss://192.168.1.4/rt', EXPO_PUBLIC_MEDIA_BASE_URL: 'https://media.gobye.app', EXPO_PUBLIC_USE_MOCKS: 'true', EXPO_PUBLIC_DEMO_RELAY_URL: 'http://192.168.1.4:8787' },
      'expo',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const names = r.error.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_REALTIME_URL', 'EXPO_PUBLIC_USE_MOCKS', 'EXPO_PUBLIC_DEMO_RELAY_URL']));
    expect(parsePublicConfig({ EXPO_PUBLIC_ENV: 'prod' }, 'expo').ok).toBe(false);
  });

  it('refuses anything that looks like a secret, by name or by value', () => {
    expect(findSecrets({ EXPO_PUBLIC_R2_SECRET_ACCESS_KEY: 'x' })).toHaveLength(1);
    expect(findSecrets({ VITE_PAYSTACK_SECRET_KEY: 'x' })).toHaveLength(1);
    expect(findSecrets({ VITE_SOMETHING: 'sk_live_abcdefghijkl' })[0].problem).toContain('Paystack');
    expect(findSecrets({ EXPO_PUBLIC_X: 'postgres://user:pw@db.example.com/gobye' })).toHaveLength(1);
    expect(findSecrets({ EXPO_PUBLIC_DEMO_RELAY_KEY: 'anon-key' })).toEqual([]);
    const r = parsePublicConfig({ EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'x' }, 'expo');
    expect(r.ok).toBe(false);
  });

  it('only allows simulated services in production when explicitly allowed', () => {
    expect(() => assertMocksAllowed({ environment: 'production', useMocks: true })).toThrow('disabled in production');
    expect(() => assertMocksAllowed({ environment: 'production', useMocks: true }, { allowMocksInProduction: true })).not.toThrow();
    expect(() => assertMocksAllowed({ environment: 'development', useMocks: false })).toThrow('switched off');
    expect(() => assertMocksAllowed({ environment: 'staging', useMocks: true })).not.toThrow();
  });
});

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
const res = (status: number, body?: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
});

function fakeFetch(replies: (ReturnType<typeof res> | 'throw' | 'hang')[]) {
  const calls: Call[] = [];
  const fetch: HttpFetch = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = replies.shift() ?? res(200, { data: null });
    if (r === 'throw') return Promise.reject(new Error('ECONNRESET'));
    if (r === 'hang') return new Promise(() => undefined);
    return Promise.resolve(r);
  };
  return { fetch, calls };
}

const noSleep = async () => undefined;

describe('API client', () => {
  it('sends a request id, the token and the idempotency key, and unwraps { data }', async () => {
    const { fetch, calls } = fakeFetch([res(201, { data: { id: 'ride_1' } }, { 'x-request-id': 'req_server' })]);
    const api = createApiClient({ baseUrl: 'https://api.gobye.app/v1/', fetch, getToken: () => 'tok_123', newRequestId: () => 'req_1', client: 'rider/0.1.0' });
    const r = await api.post<{ id: string }>('/rides', { pickup: 'x' }, { idempotencyKey: 'booking_abc_123456789012' });
    expect(r).toEqual({ ok: true, value: { id: 'ride_1' }, requestId: 'req_server' });
    expect(calls[0].url).toBe('https://api.gobye.app/v1/rides');
    expect(calls[0].headers).toMatchObject({ 'x-request-id': 'req_1', Authorization: 'Bearer tok_123', 'Idempotency-Key': 'booking_abc_123456789012', 'x-client': 'rider/0.1.0', 'Content-Type': 'application/json' });
  });

  it('maps the standard error envelope and Retry-After', async () => {
    const e = errorFromResponse(429, { error: { code: 'rate_limited', message: 'Slow down.', requestId: 'req_9' } }, '12');
    expect(e).toMatchObject({ kind: 'rate_limited', code: 'rate_limited', message: 'Slow down.', requestId: 'req_9', retryAfterSeconds: 12, status: 429 });
    expect(errorFromResponse(422, { error: { code: 'validation_failed', message: 'Check.', requestId: 'r', details: { phone: 'Invalid' } } }).details).toEqual({ phone: 'Invalid' });
    expect(errorFromResponse(500, 'oops').message).toBe('Something went wrong on our side. Try again.');
    expect(parseRetryAfter('Thu, 22 Oct 2026 12:00:10 GMT', Date.UTC(2026, 9, 22, 12, 0, 0))).toBe(10);
  });

  it('never retries a write without an idempotency key, and marks it ambiguous', async () => {
    const { fetch, calls } = fakeFetch(['throw', res(200, { data: 1 })]);
    const api = createApiClient({ baseUrl: 'https://api.test/v1', fetch, sleep: noSleep });
    const r = await api.post('/rides', {});
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, error: { kind: 'network', ambiguous: true } });
  });

  it('retries a GET on 503 with backoff, honouring Retry-After, then succeeds', async () => {
    const { fetch, calls } = fakeFetch([res(503, { error: { code: 'service_unavailable', message: 'Busy', requestId: 'r' } }, { 'retry-after': '2' }), res(502), res(200, { data: { ok: 1 } })]);
    const waits: number[] = [];
    const api = createApiClient({ baseUrl: 'https://api.test/v1', fetch, sleep: async (ms) => void waits.push(ms), random: () => 0.5 });
    const r = await api.get('/rides/abc');
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([2000, 400]); // Retry-After 2 s, then jittered backoff (0.5 × 800)
    expect(new Set(calls.map((c) => c.headers['x-request-id'])).size).toBe(1);
  });

  it('retries a keyed write once on 504 but not on 409 or 422', async () => {
    const a = fakeFetch([res(504), res(200, { data: 'ok' })]);
    const r1 = await createApiClient({ baseUrl: 'https://x/v1', fetch: a.fetch, sleep: noSleep }).post('/payments', {}, { idempotencyKey: 'payment_k_123456789012' });
    expect(r1.ok).toBe(true);
    expect(a.calls).toHaveLength(2);
    const b = fakeFetch([res(409, { error: { code: 'idempotency_conflict', message: 'Different request.', requestId: 'r' } })]);
    const r2 = await createApiClient({ baseUrl: 'https://x/v1', fetch: b.fetch, sleep: noSleep }).post('/payments', {}, { idempotencyKey: 'payment_k_123456789012' });
    expect(b.calls).toHaveLength(1);
    expect(r2).toMatchObject({ ok: false, error: { kind: 'conflict', code: 'idempotency_conflict' } });
  });

  it('times out a hanging request (ambiguous for writes)', async () => {
    jest.useFakeTimers();
    const { fetch } = fakeFetch(['hang']);
    const api = createApiClient({ baseUrl: 'https://x/v1', fetch, timeoutMs: 5000, sleep: noSleep });
    const p = api.post('/rides', {});
    await jest.advanceTimersByTimeAsync(5001);
    expect(await p).toMatchObject({ ok: false, error: { kind: 'timeout', ambiguous: true } });
    jest.useRealTimers();
  });

  it('fails fast when offline, and handles a non-JSON success body', async () => {
    const { fetch, calls } = fakeFetch([res(200, '<html>')]);
    expect(await createApiClient({ baseUrl: 'https://x/v1', fetch, isOnline: () => false }).get('/a')).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(calls).toHaveLength(0);
    expect(await createApiClient({ baseUrl: 'https://x/v1', fetch }).get('/a')).toMatchObject({ ok: false, error: { kind: 'server' } });
  });

  it('logs the route and outcome but never the token, body or signed URLs', async () => {
    const sink = memorySink();
    const { fetch } = fakeFetch([res(401, { error: { code: 'unauthenticated', message: 'Sign in.', requestId: 'r' } })]);
    const api = createApiClient({ baseUrl: 'https://x/v1', fetch, getToken: () => 'secret-token-value', logger: createLogger({ service: 'rider', environment: 'staging', sink }) });
    await api.post('/files/kycabcdef123/complete?X-Amz-Signature=abc', { password: 'hunter2' });
    const text = JSON.stringify(sink.events);
    expect(text).not.toContain('secret-token-value');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('X-Amz-Signature=abc');
    expect(sink.events[0]).toMatchObject({ event: 'api.request', route: '/files/:id/complete', outcome: 'failure', error: { kind: 'unauthenticated' } });
    expect(routeLabel('/rides/bk-mvk2mcw0/offers/12')).toBe('/rides/:id/offers/:n');
  });

  it('backoff is full jitter and capped', () => {
    expect(backoffDelay(0, () => 0.999)).toBeLessThan(400);
    expect(backoffDelay(10, () => 0.999)).toBeLessThanOrEqual(8000);
    expect(backoffDelay(3, () => 0)).toBe(0);
  });
});

describe('ambiguous writes and fare integrity', () => {
  it('a timed-out booking is resolved by looking it up, not by sending it again', async () => {
    const lookups = [{ ok: false as const, error: { kind: 'network' as const, message: 'x' } }, { ok: true as const, value: { id: 'ride_9', status: 'searching' } }];
    let n = 0;
    const out = await resolveAmbiguous(async () => lookups[n++], 3, noSleep);
    expect(out).toEqual({ state: 'succeeded', value: { id: 'ride_9', status: 'searching' } });
    expect(n).toBe(2);
    expect(await resolveAmbiguous(async () => ({ ok: false, error: { kind: 'not_found', message: 'x' } }), 3, noSleep)).toEqual({ state: 'not_found' });
    const unknown = await resolveAmbiguous(async () => ({ ok: false, error: { kind: 'timeout', message: 'x' } }), 2, noSleep);
    expect(unknown.state).toBe('unknown');
  });

  it('idempotency keys are scoped and unique; quotes must be fresh; the agreed fare is locked', () => {
    const a = newIdempotencyKey('booking', 1_000, () => 0.1);
    expect(a.startsWith('booking_')).toBe(true);
    expect(isIdempotencyKey(a)).toBe(true);
    expect(newIdempotencyKey('booking')).not.toBe(newIdempotencyKey('booking'));
    expect(assertQuoteFresh({ id: 'q1', expiresAt: 100 }, 101)).toEqual({ ok: false, error: 'quote_expired' });
    expect(assertQuoteFresh({ id: 'q2', expiresAt: 200 }, 100, 'q1')).toEqual({ ok: false, error: 'quote_changed' });
    expect(assertQuoteFresh({ id: 'q1', expiresAt: 200 }, 100, 'q1').ok).toBe(true);
    expect(lockedFare(720000 as Kobo, 650000 as Kobo)).toEqual({ ok: false, error: 'fare_mismatch' });
    expect(lockedFare(720000 as Kobo)).toEqual({ ok: true, value: 720000 });
  });
});
