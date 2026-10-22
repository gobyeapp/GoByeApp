import {
  ALERT_POLICIES,
  createLogger,
  createMockTransport,
  createRealtimeClient,
  errorRateBreached,
  healthHttpStatus,
  memoryAlertSink,
  memoryMetrics,
  memorySink,
  percentile,
  publicHealth,
  readiness,
  redact,
  redactString,
  realtimeChannels,
  type RealtimeEnvelope,
} from '../index';

describe('redaction and structured logs', () => {
  it('removes credentials, signed URL parts, cards and tokens; masks ID numbers; rounds coordinates', () => {
    const out = redact({
      password: 'hunter2',
      headers: { Authorization: 'Bearer abc.def.ghi', 'x-request-id': 'req_1' },
      url: 'https://acc.r2.cloudflarestorage.com/kyc/a.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA/x&X-Amz-Signature=deadbeef',
      card: '4111 1111 1111 1111',
      note: 'paid with 4111111111111111 via sk_live_abcdefgh1234',
      nin: '12345678901',
      licence_number: 'ABC123456789',
      location: { latitude: 6.524379, longitude: 3.379206 },
      pickupPin: '0185',
    });
    const s = JSON.stringify(out);
    for (const bad of ['hunter2', 'abc.def.ghi', 'deadbeef', 'AKIA/x', '4111', 'sk_live_', '12345678901', 'ABC123456789', '0185']) expect(s).not.toContain(bad);
    expect(out.nin).toBe('••••8901');
    expect(out.location).toEqual({ latitude: 6.524, longitude: 3.379 });
    expect(out.headers['x-request-id']).toBe('req_1');
    expect(redactString('see https://x.test/a?token=abc123&v=1')).toBe('see https://x.test/a?token=[redacted]&v=1');
  });

  it('logs JSON events with service, environment and request ids, filtered by level', () => {
    const sink = memorySink();
    const log = createLogger({ service: 'gateway', environment: 'production', sink, now: () => Date.UTC(2026, 9, 23) }).child({ correlationId: 'c1' });
    log.log('debug', 'noise');
    log.log('error', 'origin.failed', { requestId: 'r1', outcome: 'failure', durationMs: 31, error: { kind: 'unavailable', message: 'down' }, token: 't' });
    expect(sink.events).toEqual([
      { ts: '2026-10-23T00:00:00.000Z', env: 'production', service: 'gateway', level: 'error', event: 'origin.failed', correlationId: 'c1', requestId: 'r1', outcome: 'failure', durationMs: 31, error: { kind: 'unavailable', message: 'down' }, token: '[redacted]' },
    ]);
  });

  it('metrics, provisional alert policies and the alert interface', async () => {
    const m = memoryMetrics();
    m.counter('api_requests_total', 1, { route: '/rides' });
    m.counter('api_requests_total', 2, { route: '/rides' });
    [120, 80, 400, 60, 900].forEach((v) => m.histogram('api_request_duration_ms', v));
    expect(m.count('api_requests_total', { route: '/rides' })).toBe(3);
    expect(percentile(m.values('api_request_duration_ms'), 95)).toBe(900);
    expect(ALERT_POLICIES.every((p) => p.provisional)).toBe(true);
    expect(ALERT_POLICIES.map((p) => p.id)).toEqual(expect.arrayContaining(['origin-unavailable', 'elevated-5xx', 'r2-upload-failures', 'unhealthy-pool', 'payment-failures']));
    expect(errorRateBreached(5, 100)).toBe(false); // below the minimum volume
    expect(errorRateBreached(10, 300)).toBe(true);
    const sink = memoryAlertSink();
    await sink.send({ policyId: 'elevated-5xx', at: 1, summary: 'token=abc leaked?' });
    expect(sink.sent[0].summary).toBe('token=abc leaked?'.replace('abc', 'abc')); // plain text without a URL stays
  });
});

describe('health contracts', () => {
  it('readiness reflects critical dependencies; the public view hides them', () => {
    const down = readiness('1.4.0', { database: 'fail', cache: 'ok' }, ['database']);
    expect(down.status).toBe('unavailable');
    expect(healthHttpStatus(down)).toBe(503);
    const degraded = readiness('1.4.0', { database: 'ok', sms: 'fail' }, ['database']);
    expect(degraded.status).toBe('degraded');
    expect(healthHttpStatus(degraded)).toBe(200);
    expect(publicHealth(down)).toEqual({ status: 'unavailable', version: '1.4.0' });
  });
});

describe('realtime client', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = (over: Partial<Parameters<typeof createRealtimeClient>[0]> = {}) => {
    const transport = createMockTransport();
    let n = 0;
    const resyncs: [string, number | undefined][] = [];
    const client = createRealtimeClient({
      transport,
      getCredentials: async () => ({ url: 'wss://realtime.test/v1', token: `tok_${++n}` }),
      resync: async (channel, lastSeq) => {
        resyncs.push([channel, lastSeq]);
        return { seq: 10, state: { status: 'in_progress' } };
      },
      random: () => 0.5,
      ...over,
    });
    return { transport, client, resyncs };
  };

  it('connects with fresh credentials, authenticates and subscribes', async () => {
    const { transport, client } = setup();
    const ch = realtimeChannels.trip('ride_1');
    client.subscribe(ch, { onEvent: () => undefined });
    client.connect();
    await jest.advanceTimersByTimeAsync(0);
    expect(client.state).toBe('open');
    expect(transport.sent).toEqual([{ op: 'auth', token: 'tok_1' }, { op: 'subscribe', channel: 'trip:ride_1', sinceSeq: undefined }]);
  });

  it('orders events, drops duplicates, and resyncs after a gap that is never filled', async () => {
    const { transport, client, resyncs } = setup();
    const got: number[] = [];
    let resynced: unknown;
    client.subscribe('trip:r', { onEvent: (e) => got.push(e.seq), onResync: (s) => (resynced = s) });
    client.connect();
    await jest.advanceTimersByTimeAsync(0);
    transport.emit({ op: 'subscribed', channel: 'trip:r', seq: 0 });
    transport.event('trip:r', 1);
    transport.event('trip:r', 3); // arrives before 2
    transport.event('trip:r', 2);
    transport.event('trip:r', 2); // duplicate
    expect(got).toEqual([1, 2, 3]);
    transport.event('trip:r', 5); // 4 never arrives
    await jest.advanceTimersByTimeAsync(1_600);
    expect(resyncs).toEqual([['trip:r', 3]]);
    expect(resynced).toEqual({ status: 'in_progress' });
    transport.event('trip:r', 11);
    expect(got).toEqual([1, 2, 3, 11]); // authoritative seq 10 → continue from 11; 5 was older than the resync point
  });

  it('reconnects with jittered backoff and new credentials, resubscribing from the last seq', async () => {
    const { transport, client } = setup();
    client.subscribe('trip:r', { onEvent: () => undefined });
    client.connect();
    await jest.advanceTimersByTimeAsync(0);
    transport.emit({ op: 'subscribed', channel: 'trip:r', seq: 0 });
    transport.event('trip:r', 1);
    transport.failNext(1);
    transport.disconnect();
    expect(client.state).toBe('reconnecting');
    await jest.advanceTimersByTimeAsync(250); // 0.5 × 500 (attempt 0) → fails
    expect(client.state).toBe('reconnecting');
    await jest.advanceTimersByTimeAsync(500); // 0.5 × 1000 (attempt 1) → opens
    expect(client.state).toBe('open');
    expect(transport.connects).toHaveLength(3);
    expect(transport.sent.slice(-2)).toEqual([{ op: 'auth', token: 'tok_3' }, { op: 'subscribe', channel: 'trip:r', sinceSeq: 1 }]);
  });

  it('pauses in the background and offline, then resumes and re-reads state', async () => {
    const { transport, client, resyncs } = setup();
    client.subscribe('trip:r', { onEvent: () => undefined });
    client.connect();
    await jest.advanceTimersByTimeAsync(0);
    client.setAppActive(false);
    expect(client.state).toBe('idle');
    expect(transport.connected).toBe(false);
    client.setAppActive(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(client.state).toBe('open');
    expect(resyncs).toEqual([['trip:r', undefined]]);
    client.setNetworkAvailable(false);
    expect(client.state).toBe('offline');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(transport.connects).toHaveLength(2); // no reconnect storm while offline
    client.setNetworkAvailable(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(client.state).toBe('open');
  });

  it('refuses unsupported versions and invalid events; reports denied subscriptions; renews expired auth', async () => {
    const { transport, client, resyncs } = setup();
    const got: RealtimeEnvelope[] = [];
    let denied = '';
    client.subscribe('trip:r', { onEvent: (e) => got.push(e), validate: (e) => typeof (e.data as { status?: unknown }).status === 'string' });
    client.subscribe('trip:other', { onEvent: () => undefined, onDenied: (r) => (denied = r) });
    client.connect();
    await jest.advanceTimersByTimeAsync(0);
    transport.emit({ op: 'denied', channel: 'trip:other', reason: 'not_a_participant' });
    expect(denied).toBe('not_a_participant');
    transport.emit({ op: 'subscribed', channel: 'trip:r', seq: 0 });
    transport.event('trip:r', 1, { status: 42 }); // fails validation
    transport.event('trip:r', 1, { status: 'arrived' }, { version: 2 }); // too new
    await jest.advanceTimersByTimeAsync(0);
    expect(got).toEqual([]);
    expect(resyncs[0][0]).toBe('trip:r');
    transport.emit({ op: 'auth_expired' });
    await jest.advanceTimersByTimeAsync(300);
    expect(transport.sent.filter((f) => f.op === 'auth').pop()).toEqual({ op: 'auth', token: 'tok_2' });
  });

  it('close stops everything', async () => {
    const { transport, client } = setup();
    client.connect();
    await jest.advanceTimersByTimeAsync(0);
    client.close();
    transport.disconnect();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(client.state).toBe('closed');
    expect(transport.connects).toHaveLength(1);
  });
});
