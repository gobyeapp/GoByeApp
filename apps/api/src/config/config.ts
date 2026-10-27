import { z } from 'zod';

/**
 * Server configuration, validated once at start-up (Phase 1, BACKEND_ARCHITECTURE.md §4).
 *
 * Rules:
 * - every problem is reported at once, by variable name only: values are never printed;
 * - staging and production refuse unsafe settings (simulated payments, no gateway signature,
 *   unverified database TLS, the legacy shared-secret JWT, staff without MFA);
 * - secrets come from the host's secret store (StackShift project variables, encrypted at rest),
 *   never from a committed file.
 */

export const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .optional()
    .transform((v) => (v === undefined ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const url = z.string().url('must be a full URL');

const schema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  /** Git SHA or release tag, injected at build time; shown by /health. */
  APP_VERSION: z.string().min(1).max(64).default('dev'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(8080, 1, 65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Number of proxies in front (gateway + host load balancer); used for client IPs only. */
  TRUST_PROXY_HOPS: int(0, 0, 5),
  BODY_LIMIT_BYTES: int(262_144, 1024, 10_485_760),
  CORS_ORIGINS: z.string().default(''),

  /* Database (Supabase PostgreSQL). Runtime may use the pooler; migrations use a direct/session connection. */
  DATABASE_URL: z.string().optional(),
  DATABASE_MIGRATION_URL: z.string().optional(),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('verify-full'),
  /** PEM of the Supabase root CA (verify-full). Newlines may be written as \n. */
  DATABASE_CA_CERT: z.string().optional(),
  DATABASE_POOL_MAX: int(10, 1, 100),
  DATABASE_STATEMENT_TIMEOUT_MS: int(5000, 100, 120_000),

  /* Supabase Auth (JWT verification only; the service-role key is never needed for requests). */
  SUPABASE_URL: url.optional(),
  SUPABASE_JWT_AUDIENCE: z.string().default('authenticated'),
  /** Legacy shared secret (HS256). Development/test only; production uses asymmetric signing keys via JWKS. */
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_ALLOW_HS256: bool(false),
  /** Staff permissions apply only to sessions with MFA (aal2). */
  STAFF_REQUIRE_MFA: bool(true),

  /* Edge gateway (infra/cloudflare api-gateway) signs every forwarded request. */
  ORIGIN_AUTH_SECRET: z.string().optional(),
  ORIGIN_AUTH_REQUIRED: bool(true),

  /* Providers (BACKEND_ARCHITECTURE.md §8). */
  PAYMENTS_PROVIDER: z.enum(['none', 'simulated']).default('none'),
  MAPS_PROVIDER: z.enum(['none', 'fake']).default('none'),
  NOTIFICATIONS_PROVIDER: z.enum(['none', 'log']).default('none'),
  STORAGE_PROVIDER: z.enum(['none', 'memory', 'r2']).default('none'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_PREFIX: z.string().regex(/^[a-z0-9-]+$/).optional(),

  /* WhatsApp quick booking (D-064, docs/WHATSAPP_BOOKING.md). Off unless a provider is set. */
  WHATSAPP_PROVIDER: z.enum(['none', 'simulated', 'cloud_api']).default('none'),
  /** Meta app secret: verifies X-Hub-Signature-256 on every webhook. */
  WHATSAPP_APP_SECRET: z.string().optional(),
  /** Our own random string, echoed by Meta when the webhook is registered. */
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  /** System-user access token for the Cloud API (cloud_api only). */
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d{5,20}$/, 'must be the numeric phone number id').optional(),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/, 'like v23.0').default('v23.0'),
  /** https page that opens the app (apps/web open.html): <base>/ride/<id>, <base>/signup. */
  WHATSAPP_OPEN_LINK_BASE: url.default('https://gobye.app/open'),
  /** Kill switch: false keeps the chat answering but refuses new bookings ("book in the app"). */
  WHATSAPP_BOOKING_ENABLED: bool(true),

  /* Durable jobs (Postgres queue, §10). */
  WORKER_ENABLED: bool(false),
  WORKER_POLL_MS: int(2000, 100, 60_000),
  WORKER_CONCURRENCY: int(2, 1, 32),
});

export type RawConfig = z.infer<typeof schema>;
export type AppConfig = RawConfig & { corsOrigins: string[]; isProductionLike: boolean };

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

function portOf(u: string): string | null {
  try {
    return new URL(u).port || null;
  } catch {
    return null;
  }
}

function hostnameOf(u: string | undefined): string | null {
  try {
    return u ? new URL(u).hostname : null;
  } catch {
    return null;
  }
}

/** Parses and cross-checks the environment. Throws ConfigError listing every problem (names only). */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`));
  }
  const c = parsed.data;
  const problems: string[] = [];
  const prodLike = c.APP_ENV === 'staging' || c.APP_ENV === 'production';

  const dbUrl = c.DATABASE_URL;
  if (dbUrl && !/^postgres(ql)?:\/\//.test(dbUrl)) problems.push('DATABASE_URL: must start with postgres:// or postgresql://');
  if (c.DATABASE_MIGRATION_URL && !/^postgres(ql)?:\/\//.test(c.DATABASE_MIGRATION_URL)) problems.push('DATABASE_MIGRATION_URL: must start with postgres:// or postgresql://');

  if (prodLike) {
    if (!dbUrl) problems.push('DATABASE_URL: required in staging and production');
    if (c.DATABASE_SSL !== 'verify-full') problems.push('DATABASE_SSL: must be verify-full in staging and production');
    if (c.DATABASE_SSL === 'verify-full' && !c.DATABASE_CA_CERT) problems.push('DATABASE_CA_CERT: required with verify-full (Supabase root certificate)');
    if (!c.SUPABASE_URL) problems.push('SUPABASE_URL: required in staging and production');
    if (c.SUPABASE_URL && !c.SUPABASE_URL.startsWith('https://')) problems.push('SUPABASE_URL: must use https');
    if (c.SUPABASE_ALLOW_HS256 || c.SUPABASE_JWT_SECRET) problems.push('SUPABASE_JWT_SECRET / SUPABASE_ALLOW_HS256: the legacy shared secret is refused in staging and production; use JWT signing keys (JWKS)');
    if (!c.ORIGIN_AUTH_REQUIRED) problems.push('ORIGIN_AUTH_REQUIRED: must be true in staging and production');
    if (!c.ORIGIN_AUTH_SECRET || c.ORIGIN_AUTH_SECRET.length < 32) problems.push('ORIGIN_AUTH_SECRET: required (32+ characters) in staging and production');
    if (c.LOG_LEVEL === 'trace' || c.LOG_LEVEL === 'debug') problems.push('LOG_LEVEL: debug/trace are refused in staging and production');
    if (!c.STAFF_REQUIRE_MFA) problems.push('STAFF_REQUIRE_MFA: must be true in staging and production');
    if (!c.DATABASE_MIGRATION_URL) problems.push('DATABASE_MIGRATION_URL: required in staging and production (direct or session connection, port 5432)');
  }
  if (c.DATABASE_MIGRATION_URL && portOf(c.DATABASE_MIGRATION_URL) === '6543') problems.push('DATABASE_MIGRATION_URL: port 6543 is the transaction pooler; migrations need a session (direct or session pooler, port 5432)');
  if (c.APP_ENV === 'production') {
    if (c.PAYMENTS_PROVIDER === 'simulated') problems.push('PAYMENTS_PROVIDER: simulated payments are refused in production');
    if (c.MAPS_PROVIDER === 'fake') problems.push('MAPS_PROVIDER: the fake maps provider is refused in production');
    if (c.NOTIFICATIONS_PROVIDER === 'log') problems.push('NOTIFICATIONS_PROVIDER: the log-only notifier is refused in production');
    if (c.STORAGE_PROVIDER === 'memory') problems.push('STORAGE_PROVIDER: in-memory storage is refused in production');
  }
  if (!prodLike && c.ORIGIN_AUTH_REQUIRED && !c.ORIGIN_AUTH_SECRET) problems.push('ORIGIN_AUTH_SECRET: required while ORIGIN_AUTH_REQUIRED=true (set ORIGIN_AUTH_REQUIRED=false for local development without the gateway)');
  if (c.SUPABASE_ALLOW_HS256 && !c.SUPABASE_JWT_SECRET) problems.push('SUPABASE_JWT_SECRET: required when SUPABASE_ALLOW_HS256=true');
  if (c.SUPABASE_JWT_SECRET && c.SUPABASE_JWT_SECRET.length < 32) problems.push('SUPABASE_JWT_SECRET: must be 32+ characters');
  if (c.STORAGE_PROVIDER === 'r2') {
    for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PREFIX'] as const) if (!c[k]) problems.push(`${k}: required when STORAGE_PROVIDER=r2`);
  }

  const corsOrigins = c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of corsOrigins) {
    if (!/^https?:\/\/[^/]+$/.test(o)) problems.push(`CORS_ORIGINS: "${hostnameOf(o) ?? 'entry'}" must be a scheme://host origin`);
    else if (prodLike && !o.startsWith('https://')) problems.push('CORS_ORIGINS: https origins only in staging and production');
  }
  if (corsOrigins.includes('*')) problems.push('CORS_ORIGINS: wildcard is not allowed');

  if (c.WHATSAPP_PROVIDER !== 'none') {
    if (!c.WHATSAPP_APP_SECRET || c.WHATSAPP_APP_SECRET.length < 16) problems.push('WHATSAPP_APP_SECRET: required (16+ characters) when WHATSAPP_PROVIDER is set');
    if (!c.WHATSAPP_VERIFY_TOKEN || c.WHATSAPP_VERIFY_TOKEN.length < 16) problems.push('WHATSAPP_VERIFY_TOKEN: required (16+ random characters) when WHATSAPP_PROVIDER is set');
    if (!c.WHATSAPP_PHONE_NUMBER_ID) problems.push('WHATSAPP_PHONE_NUMBER_ID: required when WHATSAPP_PROVIDER is set');
    if (c.MAPS_PROVIDER === 'none') problems.push('MAPS_PROVIDER: WhatsApp booking needs a maps provider to price trips');
    if (prodLike && !c.WHATSAPP_OPEN_LINK_BASE.startsWith('https://')) problems.push('WHATSAPP_OPEN_LINK_BASE: must use https');
  }
  if (c.WHATSAPP_PROVIDER === 'cloud_api' && !c.WHATSAPP_ACCESS_TOKEN) problems.push('WHATSAPP_ACCESS_TOKEN: required for WHATSAPP_PROVIDER=cloud_api');
  if (c.APP_ENV === 'production' && c.WHATSAPP_PROVIDER === 'simulated') problems.push('WHATSAPP_PROVIDER: simulated is not allowed in production');

  if (problems.length) throw new ConfigError(problems);
  return { ...c, corsOrigins, isProductionLike: prodLike };
}

/** Defaults for tests: no database, no auth provider, permissive origin checks off. */
export function testConfig(overrides: Partial<Record<keyof RawConfig, string>> = {}): AppConfig {
  return loadConfig({ APP_ENV: 'test', DATABASE_SSL: 'disable', ORIGIN_AUTH_REQUIRED: 'false', LOG_LEVEL: 'silent', ...overrides });
}
