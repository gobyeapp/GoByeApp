/**
 * GoBye API on Cloudflare Containers (D-065): pure helpers for the container Worker (index.ts), kept free
 * of `cloudflare:workers` so they run in unit tests.
 */

/** Settings passed from the Worker's vars and secrets into the API container (apps/api/src/config). */
export const CONTAINER_ENV_KEYS = [
  'APP_ENV',
  'APP_VERSION',
  'LOG_LEVEL',
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'DATABASE_SSL',
  'DATABASE_CA_CERT',
  'DATABASE_POOL_MAX',
  'DATABASE_STATEMENT_TIMEOUT_MS',
  'AUTH_PROVIDER',
  'AUTH_ISSUER',
  'AUTH_JWKS_URL',
  'AUTH_AUDIENCE',
  'SUPABASE_URL',
  'SUPABASE_JWT_AUDIENCE',
  'STAFF_REQUIRE_MFA',
  'ORIGIN_AUTH_REQUIRED',
  'ORIGIN_AUTH_SECRET',
  'CORS_ORIGINS',
  'PAYMENTS_PROVIDER',
  'MAPS_PROVIDER',
  'NOTIFICATIONS_PROVIDER',
  'STORAGE_PROVIDER',
  'WORKER_ENABLED',
] as const;
/** Whole families passed through (WhatsApp booking D-064, R2 storage). */
export const CONTAINER_ENV_PREFIXES = ['WHATSAPP_', 'R2_'] as const;

/**
 * The container's environment: only listed string settings (never bindings or other Worker internals),
 * plus the port the image listens on.
 */
export function containerEnv(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string') continue;
    if ((CONTAINER_ENV_KEYS as readonly string[]).includes(k) || CONTAINER_ENV_PREFIXES.some((p) => k.startsWith(p))) out[k] = v;
  }
  out.PORT = '8080';
  out.HOST = '0.0.0.0';
  return out;
}

/** Name of the single API instance (one container while traffic is small; more later behind getRandom). */
export const PRIMARY_INSTANCE = 'gobye-api-primary';

/** Durable Object location hint: Western Europe, next to the Supabase database in London (eu-west-2). */
export const LOCATION_HINT = 'weur';

/** Path the cron trigger calls to keep the container (and its job worker) awake. */
export const KEEPALIVE_PATH = '/health/live';
