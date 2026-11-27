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
  /**
   * Worker only (account deletion job): removes the person's sign-in account through the Supabase Auth
   * admin API after our data is anonymised. Unset = our data is still anonymised and the job records that
   * the sign-in account remains, for an owner to remove in Supabase.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  /** Salt for hashing caller IPs on consent records (never the IP itself). Unset = no IP hash stored. */
  IP_HASH_SALT: z.string().min(16).optional(),
  /** Legacy shared secret (HS256). Development/test only; production uses asymmetric signing keys via JWKS. */
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_ALLOW_HS256: bool(false),
  /**
   * Which sign-in service issues the tokens (docs/DATA_PLATFORM_PORTABILITY.md). `supabase` (default):
   * Supabase Auth via SUPABASE_URL. `oidc`: any standards-based provider (signed JWTs + a JWKS URL), so a
   * future move away from Supabase Auth is a configuration change, not a code change.
   */
  AUTH_PROVIDER: z.enum(['supabase', 'oidc']).default('supabase'),
  AUTH_ISSUER: url.optional(),
  AUTH_JWKS_URL: url.optional(),
  AUTH_AUDIENCE: z.string().optional(),
  /** Staff permissions apply only to sessions with MFA (aal2). */
  STAFF_REQUIRE_MFA: bool(true),

  /* Edge gateway (infra/cloudflare api-gateway) signs every forwarded request. */
  ORIGIN_AUTH_SECRET: z.string().optional(),
  ORIGIN_AUTH_REQUIRED: bool(true),

  /* Providers (BACKEND_ARCHITECTURE.md §8). */
  PAYMENTS_PROVIDER: z.enum(['none', 'simulated', 'paystack']).default('none'),
  /** Paystack secret key (sk_test_… or sk_live_…). Server secret store only. */
  PAYSTACK_SECRET_KEY: z.string().regex(/^sk_(test|live)_[A-Za-z0-9]{20,}$/, 'must be a Paystack secret key').optional(),
  /** Where the provider's payment page sends the customer afterwards (an app link). */
  PAYMENTS_RETURN_URL: url.optional(),
  MAPS_PROVIDER: z.enum(['none', 'fake', 'google']).default('none'),
  /** Google Maps Platform SERVER key (Routes, Places, Geocoding only). Never an app key. */
  GOOGLE_MAPS_SERVER_KEY: z.string().min(20).optional(),
  /** Push, email and SMS each have their own provider; a channel without one is "not connected". */
  PUSH_PROVIDER: z.enum(['none', 'expo']).default('none'),
  EXPO_ACCESS_TOKEN: z.string().min(10).optional(),
  EMAIL_PROVIDER: z.enum(['none', 'resend']).default('none'),
  RESEND_API_KEY: z.string().regex(/^re_[A-Za-z0-9_]{10,}$/, 'must be a Resend API key').optional(),
  /** The address receipts come from, e.g. "GoBye <receipts@gobye.app>". The domain must be verified with the provider. */
  EMAIL_FROM: z.string().max(120).optional(),
  SMS_PROVIDER: z.enum(['none', 'termii']).default('none'),
  TERMII_API_KEY: z.string().min(10).optional(),
  TERMII_SENDER_ID: z.string().regex(/^[A-Za-z0-9 ]{3,11}$/, '3 to 11 letters or digits').optional(),
  TERMII_BASE_URL: url.optional(),
  /** Secret of the sign-in service's "Send SMS" hook (v1,whsec_…). With it, sign-in codes go out through SMS_PROVIDER. */
  SUPABASE_SMS_HOOK_SECRET: z.string().regex(/^v1,whsec_[A-Za-z0-9+/=]{20,}$/, 'must look like v1,whsec_…').optional(),
  IDENTITY_PROVIDER: z.enum(['none', 'simulated', 'qoreid']).default('none'),
  QOREID_CLIENT_ID: z.string().min(6).optional(),
  QOREID_SECRET: z.string().min(10).optional(),
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
  /* Rides (D-100). */
  /** Riders may pay the driver in cash. Off until the owner decides (D-023: cash is open). */
  RIDE_CASH_ENABLED: bool(false),
  /** A driver needs an active pass to go online (D-024). Off until passes can be bought (payments). */
  DRIVER_PASS_REQUIRED: bool(false),
  /** Wallet balances and paying from the wallet (D-101). Off until the money reviews are done. */
  WALLET_ENABLED: bool(false),

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
    if (c.AUTH_PROVIDER === 'supabase' && !c.SUPABASE_URL) problems.push('SUPABASE_URL: required in staging and production');
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
  if (c.AUTH_PROVIDER === 'oidc') {
    if (!c.AUTH_ISSUER) problems.push('AUTH_ISSUER: required when AUTH_PROVIDER=oidc');
    if (!c.AUTH_JWKS_URL) problems.push('AUTH_JWKS_URL: required when AUTH_PROVIDER=oidc');
    if (!c.AUTH_AUDIENCE) problems.push('AUTH_AUDIENCE: required when AUTH_PROVIDER=oidc');
    if (prodLike && c.AUTH_JWKS_URL && !c.AUTH_JWKS_URL.startsWith('https://')) problems.push('AUTH_JWKS_URL: must use https');
    if (c.SUPABASE_ALLOW_HS256) problems.push('SUPABASE_ALLOW_HS256: not used with AUTH_PROVIDER=oidc');
  }
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

  if (c.MAPS_PROVIDER === 'google' && !c.GOOGLE_MAPS_SERVER_KEY) problems.push('GOOGLE_MAPS_SERVER_KEY: required when MAPS_PROVIDER=google');
  if (c.EMAIL_PROVIDER === 'resend') {
    if (!c.RESEND_API_KEY) problems.push('RESEND_API_KEY: required when EMAIL_PROVIDER=resend');
    if (!c.EMAIL_FROM || !/<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$|^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(c.EMAIL_FROM)) problems.push('EMAIL_FROM: required when EMAIL_PROVIDER=resend (an address on a domain verified with the provider)');
  }
  if (c.SMS_PROVIDER === 'termii') {
    for (const k of ['TERMII_API_KEY', 'TERMII_SENDER_ID', 'TERMII_BASE_URL'] as const) if (!c[k]) problems.push(`${k}: required when SMS_PROVIDER=termii`);
    if (c.TERMII_BASE_URL && !c.TERMII_BASE_URL.startsWith('https://')) problems.push('TERMII_BASE_URL: must use https');
  }
  if (c.SUPABASE_SMS_HOOK_SECRET && c.SMS_PROVIDER === 'none') problems.push('SUPABASE_SMS_HOOK_SECRET: needs SMS_PROVIDER (the hook has nothing to send codes with)');
  if (c.IDENTITY_PROVIDER === 'qoreid' && (!c.QOREID_CLIENT_ID || !c.QOREID_SECRET)) problems.push('QOREID_CLIENT_ID / QOREID_SECRET: required when IDENTITY_PROVIDER=qoreid');
  if (c.APP_ENV === 'production' && c.IDENTITY_PROVIDER === 'simulated') problems.push('IDENTITY_PROVIDER: simulated identity checks are refused in production');
  if (c.PAYMENTS_PROVIDER === 'paystack') {
    if (!c.PAYSTACK_SECRET_KEY) problems.push('PAYSTACK_SECRET_KEY: required when PAYMENTS_PROVIDER=paystack');
    if (c.APP_ENV === 'production' && c.PAYSTACK_SECRET_KEY && !c.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) problems.push('PAYSTACK_SECRET_KEY: a live key is required in production');
    if (c.APP_ENV !== 'production' && c.PAYSTACK_SECRET_KEY?.startsWith('sk_live_')) problems.push('PAYSTACK_SECRET_KEY: live keys are refused outside production');
  }
  if (c.WALLET_ENABLED && c.PAYMENTS_PROVIDER === 'none') problems.push('WALLET_ENABLED: needs PAYMENTS_PROVIDER (wallet money cannot be switched on without a payment provider)');
  if (c.PAYMENTS_RETURN_URL && prodLike && !c.PAYMENTS_RETURN_URL.startsWith('https://')) problems.push('PAYMENTS_RETURN_URL: must use https');

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
