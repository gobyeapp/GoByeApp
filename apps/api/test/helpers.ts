import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { createApp, MIGRATIONS_DIR } from '../src/app.factory';
import { testConfig, type AppConfig, type RawConfig } from '../src/config/config';
import { Database } from '../src/database/database';
import { loadMigrations, migrate } from '../src/database/migrations';
import { createTokenVerifier, type TokenVerifier } from '../src/auth/jwt';
import { sqlPrincipalRepository } from '../src/auth/principal';
import { providersFromConfig } from '../src/providers/providers';
import type { Providers } from '../src/providers/ports';

/**
 * Test database: a fresh, throwaway database per test file on the Postgres at TEST_DATABASE_ADMIN_URL
 * (default: the local development server). Tests that need it skip with a clear reason when no Postgres
 * is reachable, so `npm test` still runs the rest on a laptop without Postgres. CI sets
 * REQUIRE_DATABASE_TESTS=1 (and REQUIRE_POOLER_TESTS=1), which turns a skip into a failure.
 */
export const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://gobye:gobye_local_only@127.0.0.1:5432/postgres';

export interface TestDb {
  db: Database;
  url: string;
  drop(): Promise<void>;
}

let reachable: boolean | null = null;
export async function postgresAvailable(): Promise<boolean> {
  if (reachable !== null) return reachable;
  const c = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    reachable = true;
  } catch {
    reachable = false;
  }
  // CI sets REQUIRE_DATABASE_TESTS=1: an unreachable database must fail the run, never skip silently.
  if (!reachable && process.env.REQUIRE_DATABASE_TESTS === '1') throw new Error(`REQUIRE_DATABASE_TESTS=1 but ${NO_DB_REASON}`);
  return reachable;
}
export const NO_DB_REASON = `PostgreSQL not reachable at TEST_DATABASE_ADMIN_URL (${ADMIN_URL.replace(/:[^:@/]+@/, ':***@')}); database tests skipped`;

export async function createTestDb(opts: { migrate?: boolean } = {}): Promise<TestDb> {
  const name = `gobye_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  const url = u.toString();
  if (opts.migrate !== false) {
    const c = new Client({ connectionString: url });
    await c.connect();
    await migrate(c, loadMigrations(MIGRATIONS_DIR));
    await c.end();
  }
  const db = Database.fromConfig(testConfig({ DATABASE_URL: url, DATABASE_POOL_MAX: '8' }));
  return {
    db,
    url,
    async drop() {
      await db.close();
      const a = new Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

/* ---------- Supabase-like signing keys and tokens ---------- */

export const ISSUER = 'https://test-project.supabase.co/auth/v1';

export interface Keys {
  verifier: TokenVerifier;
  token(claims: Record<string, unknown>, o?: { expiresIn?: string | number; issuer?: string; audience?: string; kid?: string }): Promise<string>;
  privateKey: CryptoKey;
}

export async function makeKeys(opts: { sharedSecret?: string } = {}): Promise<Keys> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key-1', alg: 'ES256', use: 'sig' };
  const verifier = createTokenVerifier({ issuer: ISSUER, audience: 'authenticated', keys: createLocalJWKSet({ keys: [jwk] }), sharedSecret: opts.sharedSecret, keysReachable: async () => true });
  return {
    verifier,
    privateKey,
    async token(claims, o = {}) {
      return new SignJWT({ role: 'authenticated', aal: 'aal1', ...claims })
        .setProtectedHeader({ alg: 'ES256', kid: o.kid ?? 'test-key-1', typ: 'JWT' })
        .setIssuer(o.issuer ?? ISSUER)
        .setAudience(o.audience ?? 'authenticated')
        .setIssuedAt()
        .setExpirationTime(o.expiresIn ?? '1h')
        .sign(privateKey);
    },
  };
}

/* ---------- App under test ---------- */

export interface TestApp {
  app: NestFastifyApplication;
  config: AppConfig;
  inject(o: InjectOptions): Promise<LightMyRequestResponse>;
}

export async function makeApp(p: { config?: Partial<Record<keyof RawConfig, string>>; db?: Database; keys?: Keys; now?: () => number; providers?: Providers } = {}): Promise<TestApp> {
  const config = testConfig(p.config);
  const db = p.db ?? Database.fromConfig(config);
  const app = await createApp({
    config,
    db,
    migrations: loadMigrations(MIGRATIONS_DIR),
    verifier: p.keys?.verifier ?? null,
    principals: db.configured ? sqlPrincipalRepository(db) : null,
    providers: p.providers ?? providersFromConfig(config),
    now: p.now,
  });
  const fastify = app.getHttpAdapter().getInstance();
  return { app, config, inject: (o) => fastify.inject(o) };
}

/* ---------- Fixtures ---------- */

export async function addUser(db: Database, o: { id?: string; name?: string; rider?: boolean; driver?: { city: 'lagos' | 'abuja'; verification?: string }; status?: string } = {}): Promise<string> {
  const id = o.id ?? randomUUID();
  await db.query(`insert into app.users (id, full_name, status, deleted_at) values ($1, $2, $3, case when $3 = 'deleted' then now() end)`, [id, o.name ?? 'Test Person', o.status ?? 'active']);
  if (o.rider) await db.query(`insert into app.riders (user_id) values ($1)`, [id]);
  if (o.driver) await db.query(`insert into app.drivers (user_id, city, verification_status, approved_at) values ($1, $2, $3, case when $3 = 'approved' then now() end)`, [id, o.driver.city, o.driver.verification ?? 'approved']);
  return id;
}

export async function addStaff(db: Database, o: { authUserId?: string; roles: string[]; cities?: string[]; status?: string }): Promise<{ authUserId: string; staffId: string }> {
  const authUserId = o.authUserId ?? randomUUID();
  const r = await db.query<{ id: string }>(
    `insert into app.staff_members (auth_user_id, full_name, email, roles, cities, status) values ($1, 'Test Staff', $2, $3, $4, $5) returning id`,
    [authUserId, `${authUserId.slice(0, 8)}@staff.test`, o.roles, o.cities ?? [], o.status ?? 'active'],
  );
  return { authUserId, staffId: r.rows[0]!.id };
}

export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
