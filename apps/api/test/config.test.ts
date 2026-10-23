import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config/config';
import { poolConfig } from '../src/database/database';

const SECRET = 'x'.repeat(40);
const prod = {
  APP_ENV: 'production',
  DATABASE_URL: 'postgresql://gobye_api:not-a-real-password@db.example.supabase.co:5432/postgres',
  DATABASE_MIGRATION_URL: 'postgresql://gobye_migrator:not-a-real-password@db.example.supabase.co:5432/postgres',
  DATABASE_SSL: 'verify-full',
  DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----',
  SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  ORIGIN_AUTH_SECRET: SECRET,
};

function problems(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    return e.problems;
  }
}

test('a complete production configuration loads', () => {
  const c = loadConfig(prod);
  assert.equal(c.APP_ENV, 'production');
  assert.equal(c.isProductionLike, true);
  assert.equal(c.PORT, 8080);
  assert.equal(c.STAFF_REQUIRE_MFA, true);
  assert.equal(c.PAYMENTS_PROVIDER, 'none');
});

test('APP_ENV is required and must be known', () => {
  assert.ok(problems({}).some((p) => p.startsWith('APP_ENV')));
  assert.ok(problems({ APP_ENV: 'prod' }).some((p) => p.startsWith('APP_ENV')));
});

test('production refuses every unsafe setting, listing all problems at once', () => {
  const p = problems({
    APP_ENV: 'production',
    DATABASE_SSL: 'disable',
    SUPABASE_URL: 'http://abc.supabase.co',
    SUPABASE_JWT_SECRET: SECRET,
    SUPABASE_ALLOW_HS256: 'true',
    ORIGIN_AUTH_REQUIRED: 'false',
    PAYMENTS_PROVIDER: 'simulated',
    MAPS_PROVIDER: 'fake',
    NOTIFICATIONS_PROVIDER: 'log',
    STORAGE_PROVIDER: 'memory',
    STAFF_REQUIRE_MFA: 'false',
    LOG_LEVEL: 'debug',
  });
  for (const name of ['DATABASE_URL', 'DATABASE_SSL', 'SUPABASE_URL', 'SUPABASE_JWT_SECRET', 'ORIGIN_AUTH_REQUIRED', 'ORIGIN_AUTH_SECRET', 'PAYMENTS_PROVIDER', 'MAPS_PROVIDER', 'NOTIFICATIONS_PROVIDER', 'STORAGE_PROVIDER', 'STAFF_REQUIRE_MFA', 'LOG_LEVEL'])
    assert.ok(p.some((x) => x.startsWith(name)), `expected a problem for ${name}: ${p.join(' | ')}`);
});

test('staging also requires the gateway secret and verified database TLS, but allows test providers', () => {
  const p = problems({ ...prod, APP_ENV: 'staging', ORIGIN_AUTH_SECRET: 'short', DATABASE_CA_CERT: '' });
  assert.ok(p.some((x) => x.startsWith('ORIGIN_AUTH_SECRET')));
  assert.ok(p.some((x) => x.startsWith('DATABASE_CA_CERT')));
  assert.doesNotThrow(() => loadConfig({ ...prod, APP_ENV: 'staging', PAYMENTS_PROVIDER: 'simulated', MAPS_PROVIDER: 'fake' }));
});

test('problems never echo secret values', () => {
  const p = problems({ APP_ENV: 'production', DATABASE_URL: 'mysql://user:hunter2-secret@host/db', ORIGIN_AUTH_SECRET: 'tiny-secret-value' });
  const text = p.join('\n');
  assert.ok(!text.includes('hunter2-secret'));
  assert.ok(!text.includes('tiny-secret-value'));
});

test('R2 storage needs all its credentials; CORS origins are checked', () => {
  const p = problems({ APP_ENV: 'development', ORIGIN_AUTH_REQUIRED: 'false', STORAGE_PROVIDER: 'r2', CORS_ORIGINS: 'https://admin.gobye.app,not a url,*' });
  for (const n of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PREFIX']) assert.ok(p.some((x) => x.startsWith(n)));
  assert.ok(p.filter((x) => x.startsWith('CORS_ORIGINS')).length >= 2);
});

test('development without the gateway must say so explicitly', () => {
  assert.ok(problems({ APP_ENV: 'development' }).some((p) => p.startsWith('ORIGIN_AUTH_SECRET')));
  assert.doesNotThrow(() => loadConfig({ APP_ENV: 'development', ORIGIN_AUTH_REQUIRED: 'false' }));
});

test('each environment template loads once its secrets are filled in (templates and validator stay in step)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(__dirname, '..', '..', '..', '..', 'env');
  const fill: Record<string, string> = {
    APP_VERSION: 'abc1234',
    DATABASE_URL: 'postgresql://gobye_api:placeholder@db.example.supabase.co:6543/postgres',
    DATABASE_MIGRATION_URL: 'postgresql://gobye_migrator:placeholder@db.example.supabase.co:5432/postgres',
    DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----',
    SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
    ORIGIN_AUTH_SECRET: 'z'.repeat(48),
  };
  for (const name of ['development', 'staging', 'production']) {
    const env: Record<string, string> = {};
    for (const line of readFileSync(join(dir, `${name}.env.example`), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]!] = m[2]!;
    }
    for (const [k, v] of Object.entries(env)) if (v === '') { if (fill[k] && name !== 'development') env[k] = fill[k]; else delete env[k]; }
    const c = loadConfig(env);
    assert.equal(c.APP_ENV, name);
  }
});

test('migrations must use a session connection; staging needs staff MFA', () => {
  const p = problems({ ...prod, APP_ENV: 'staging', DATABASE_MIGRATION_URL: 'postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres', STAFF_REQUIRE_MFA: 'false' });
  assert.ok(p.some((x) => x.startsWith('DATABASE_MIGRATION_URL') && x.includes('6543')));
  assert.ok(p.some((x) => x.startsWith('STAFF_REQUIRE_MFA')));
  const { DATABASE_MIGRATION_URL: _omit, ...noMigrationUrl } = prod;
  assert.ok(problems(noMigrationUrl).some((x) => x.startsWith('DATABASE_MIGRATION_URL')));
});

test('TLS settings in the database URL cannot override DATABASE_SSL', () => {
  const c = loadConfig(prod);
  for (const q of ['?ssl=0', '?sslmode=disable', '?ssl=false&sslrootcert=/tmp/x', '?sslmode=no-verify&uselibpqcompat=true']) {
    const pc = poolConfig(prod.DATABASE_URL + q, c);
    assert.doesNotMatch(String(pc.connectionString), /ssl|uselibpqcompat/i, q);
    assert.equal((pc.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized, true, q);
  }
});

