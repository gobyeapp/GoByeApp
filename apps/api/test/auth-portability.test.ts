import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { createTokenVerifier, verifierFromConfig } from '../src/auth/jwt';
import { ConfigError, loadConfig, testConfig } from '../src/config/config';

/**
 * Sign-in portability (docs/DATA_PLATFORM_PORTABILITY.md): with AUTH_PROVIDER=oidc the API accepts tokens
 * from any standards-based provider (signed JWT + JWKS), so leaving Supabase Auth is a config change.
 */

const ISS = 'https://auth.example-provider.com';
const AUD = 'gobye-api';
const USER = '6f1c2b9a-1111-4222-8333-444455556666';

async function oidcKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'oidc-1', alg: 'RS256', use: 'sig' };
  const verifier = createTokenVerifier({ issuer: ISS, audience: AUD, keys: createLocalJWKSet({ keys: [jwk] }), flavour: 'oidc' });
  const token = (claims: Record<string, unknown>, o: { issuer?: string; audience?: string } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'oidc-1' }).setIssuer(o.issuer ?? ISS).setAudience(o.audience ?? AUD).setIssuedAt().setExpirationTime('10m').sign(privateKey);
  return { verifier, token };
}

test('oidc: standard claims are accepted; a second factor comes from amr or aal', async () => {
  const { verifier, token } = await oidcKeys();
  const plain = await verifier.verify(await token({ sub: USER, email: 'ada@example.com', sid: 's-1' }));
  assert.deepEqual([plain.userId, plain.aal, plain.email, plain.sessionId], [USER, 'aal1', 'ada@example.com', 's-1']);
  assert.equal((await verifier.verify(await token({ sub: USER, amr: ['pwd', 'otp'] }))).aal, 'aal2');
  assert.equal((await verifier.verify(await token({ sub: USER, aal: 'aal2' }))).aal, 'aal2');
});

test('oidc: wrong issuer or audience, non-UUID subject and service roles are refused', async () => {
  const { verifier, token } = await oidcKeys();
  await assert.rejects(verifier.verify(await token({ sub: USER }, { issuer: 'https://evil.example.com' })), /Sign in/);
  await assert.rejects(verifier.verify(await token({ sub: USER }, { audience: 'other' })), /Sign in/);
  await assert.rejects(verifier.verify(await token({ sub: 'user_2abc' })), /Sign in/);
  await assert.rejects(verifier.verify(await token({ sub: USER, role: 'service_role' })), /Sign in/);
});

test('config: AUTH_PROVIDER=oidc needs issuer, JWKS and audience, and replaces SUPABASE_URL', () => {
  const problems = (env: Record<string, string>) => {
    try {
      loadConfig(env);
      return [];
    } catch (e) {
      return (e as ConfigError).problems;
    }
  };
  const p = problems({ APP_ENV: 'development', ORIGIN_AUTH_REQUIRED: 'false', AUTH_PROVIDER: 'oidc' });
  for (const k of ['AUTH_ISSUER', 'AUTH_JWKS_URL', 'AUTH_AUDIENCE']) assert.ok(p.some((x) => x.startsWith(k)), k);
  const staging = {
    APP_ENV: 'staging',
    DATABASE_URL: 'postgresql://gobye_api.ref:x@pooler.example.com:6543/postgres',
    DATABASE_MIGRATION_URL: 'postgresql://gobye_migrator.ref:x@pooler.example.com:5432/postgres',
    DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----',
    ORIGIN_AUTH_SECRET: 'z'.repeat(48),
    AUTH_PROVIDER: 'oidc',
    AUTH_ISSUER: ISS,
    AUTH_JWKS_URL: `${ISS}/.well-known/jwks.json`,
    AUTH_AUDIENCE: AUD,
  };
  assert.deepEqual(problems(staging), [], 'no SUPABASE_URL needed with oidc');
  assert.ok(problems({ ...staging, AUTH_PROVIDER: 'supabase' }).some((x) => x.startsWith('SUPABASE_URL')));
  const v = verifierFromConfig(testConfig({ AUTH_PROVIDER: 'oidc', AUTH_ISSUER: ISS, AUTH_JWKS_URL: `${ISS}/.well-known/jwks.json`, AUTH_AUDIENCE: AUD }));
  assert.ok(v, 'a verifier is built from oidc config');
});
