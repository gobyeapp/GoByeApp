import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { signOriginRequest } from '../../../infra/cloudflare/src/workers/api-gateway/originAuth';
import { verifyOriginSignature } from '../src/auth/guards';
import { makeApp, type TestApp } from './helpers';

/** HTTP conventions without a database: envelopes, request ids, versioning, limits, headers, gateway signature. */
describe('HTTP conventions (no database)', () => {
  let t: TestApp;
  before(async () => {
    t = await makeApp({ config: { BODY_LIMIT_BYTES: '2048', APP_VERSION: 'test-sha' } });
  });
  after(async () => t.app.close());

  test('GET /health/live is up without dependencies', async () => {
    const r = await t.inject({ method: 'GET', url: '/health/live' });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { status: 'ok', version: 'test-sha' });
  });

  test('GET /health/ready is 503 when the database is missing, and leaks no dependency detail', async () => {
    const r = await t.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(r.statusCode, 503);
    assert.equal(r.headers['retry-after'], '5');
    assert.deepEqual(r.json(), { status: 'unavailable', version: 'test-sha' });
  });

  test('a well-formed x-request-id is echoed; a malformed one is replaced', async () => {
    const ok = await t.inject({ method: 'GET', url: '/health/live', headers: { 'x-request-id': 'gw-0f2c9a1e-test' } });
    assert.equal(ok.headers['x-request-id'], 'gw-0f2c9a1e-test');
    const bad = await t.inject({ method: 'GET', url: '/health/live', headers: { 'x-request-id': 'bad id <script>' } });
    assert.match(String(bad.headers['x-request-id']), /^[0-9a-f-]{36}$/);
  });

  test('protected routes need a bearer token; the error envelope carries the request id', async () => {
    const r = await t.inject({ method: 'GET', url: '/v1/me', headers: { 'x-request-id': 'req-00000001' } });
    assert.equal(r.statusCode, 401);
    assert.deepEqual(r.json(), { error: { code: 'unauthenticated', message: 'Sign in to continue.', requestId: 'req-00000001' } });
  });

  test('a token is refused when sign-in is not configured (fails closed)', async () => {
    const r = await t.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer a.b.c' } });
    assert.equal(r.statusCode, 503);
    assert.equal(r.json().error.code, 'NOT_CONFIGURED');
  });

  test('unknown versions are named; unknown routes are 404 in the envelope', async () => {
    const v = await t.inject({ method: 'GET', url: '/v2/me' });
    assert.equal(v.statusCode, 400);
    assert.equal(v.json().error.code, 'unsupported_api_version');
    const n = await t.inject({ method: 'GET', url: '/v1/does-not-exist' });
    assert.equal(n.statusCode, 404);
    assert.equal(n.json().error.code, 'not_found');
    const unversioned = await t.inject({ method: 'GET', url: '/me' });
    assert.equal(unversioned.statusCode, 404);
  });

  test('invalid JSON is a validation error; oversized bodies are 413', async () => {
    const bad = await t.inject({ method: 'POST', url: '/v1/costs/expenses', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    assert.equal(bad.statusCode, 422);
    assert.equal(bad.json().error.code, 'validation_failed');
    const big = await t.inject({ method: 'POST', url: '/v1/costs/expenses', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ x: 'y'.repeat(5000) }) });
    assert.equal(big.statusCode, 413);
    assert.equal(big.json().error.code, 'payload_too_large');
  });

  test('every response has baseline security headers and is not cached', async () => {
    for (const url of ['/health/live', '/v1/me', '/v1/nope']) {
      const r = await t.inject({ method: 'GET', url });
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['x-frame-options'], 'DENY');
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.equal(r.headers['x-powered-by'], undefined);
    }
  });
});

describe('gateway signature (X-Gobye-Origin-Auth)', () => {
  const secret = 's'.repeat(48);
  let t: TestApp;
  before(async () => {
    t = await makeApp({ config: { ORIGIN_AUTH_REQUIRED: 'true', ORIGIN_AUTH_SECRET: secret } });
  });
  after(async () => t.app.close());

  test('the origin verifies exactly what the Cloudflare gateway signs', async () => {
    const now = Date.now();
    const header = await signOriginRequest(secret, 'req-abcdef12', now, 'GET', '/v1/me?x=1');
    assert.equal(verifyOriginSignature(secret, 'req-abcdef12', header, now, 'GET', '/v1/me?x=1'), true);
    assert.equal(verifyOriginSignature(secret, 'req-other-99', header, now, 'GET', '/v1/me?x=1'), false, 'bound to the request id');
    assert.equal(verifyOriginSignature(secret, 'req-abcdef12', header, now, 'POST', '/v1/me?x=1'), false, 'bound to the method');
    assert.equal(verifyOriginSignature(secret, 'req-abcdef12', header, now, 'GET', '/v1/costs/expenses'), false, 'bound to the path');
    assert.equal(verifyOriginSignature('t'.repeat(48), 'req-abcdef12', header, now, 'GET', '/v1/me?x=1'), false, 'bound to the secret');
    assert.equal(verifyOriginSignature(secret, 'req-abcdef12', header, now + 61_000, 'GET', '/v1/me?x=1'), false, 'expires after 60 s');
    assert.equal(verifyOriginSignature(secret, 'req-abcdef12', 't=1,sig=zz', now, 'GET', '/v1/me?x=1'), false);
  });

  test('requests without a valid signature are refused before authentication', async () => {
    const none = await t.inject({ method: 'GET', url: '/v1/me' });
    assert.equal(none.statusCode, 403);
    const forged = await t.inject({ method: 'GET', url: '/v1/me', headers: { 'x-request-id': 'req-abcdef12', 'x-gobye-origin-auth': `t=${Date.now()},sig=${'0'.repeat(64)}` } });
    assert.equal(forged.statusCode, 403);
    const sig = await signOriginRequest(secret, 'req-signed-01', Date.now(), 'GET', '/v1/me');
    const signed = await t.inject({ method: 'GET', url: '/v1/me', headers: { 'x-request-id': 'req-signed-01', 'x-gobye-origin-auth': sig } });
    assert.equal(signed.statusCode, 401, 'past the gateway check, now needs sign-in');
    const replayed = await t.inject({ method: 'GET', url: '/v1/me', headers: { 'x-request-id': 'req-signed-01', 'x-gobye-origin-auth': sig } });
    assert.equal(replayed.statusCode, 403, 'the same signed request id is refused the second time');
    const otherRoute = await t.inject({ method: 'GET', url: '/v1/costs/expenses?month=2026-10', headers: { 'x-request-id': 'req-signed-02', 'x-gobye-origin-auth': await signOriginRequest(secret, 'req-signed-02', Date.now(), 'GET', '/v1/me') } });
    assert.equal(otherRoute.statusCode, 403, 'a signature for /v1/me does not open another route');
  });

  test('health probes from the host do not need the gateway signature', async () => {
    assert.equal((await t.inject({ method: 'GET', url: '/health/live' })).statusCode, 200);
    assert.equal((await t.inject({ method: 'GET', url: '/health/ready' })).statusCode, 503);
  });
});
