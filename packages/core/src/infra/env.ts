import type { Result } from '../types';

/**
 * Public configuration (D-051). The only settings a rider app, driver app, website or admin bundle may
 * carry: addresses and switches, never credentials. Everything server-only is listed in
 * SECRET_ENV_NAMES and is rejected if it ever turns up in a public bundle.
 *
 * Status: Implemented and tested locally. No backend exists yet, so the API / realtime / media addresses
 * point at hostnames that are proposed, not live (docs/ENVIRONMENT_CONFIGURATION.md).
 */

export type GoByeEnvironment = 'development' | 'staging' | 'production';

export interface PublicConfig {
  environment: GoByeEnvironment;
  /** Stable API base, e.g. https://api.gobye.app/v1. Never an individual origin server. */
  apiBaseUrl: string;
  /** Realtime endpoint (wss://), e.g. wss://realtime.gobye.app/v1. */
  realtimeUrl: string;
  /** Public media CDN (approved public files only), e.g. https://media.gobye.app. */
  mediaBaseUrl: string;
  /** Simulated services. Always off in production unless explicitly allowed for a demo build. */
  useMocks: boolean;
  /** Demo relay (D-049) for the connected demo; development / staging only. */
  demoRelayUrl?: string;
}

/** Server-only variables. If any of these names appears in a public bundle, configuration fails. */
export const SECRET_ENV_NAMES = [
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'PAYSTACK_SECRET_KEY',
  'PAYMENT_WEBHOOK_SECRET',
  'DATABASE_URL',
  'ORIGIN_AUTH_SECRET',
  'UPLOAD_SIGNING_SECRET',
  'MEDIA_TOKEN_SECRET',
  'SESSION_SIGNING_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SMS_PROVIDER_API_KEY',
  'GOOGLE_MAPS_SERVER_KEY',
] as const;

/** Name patterns that mean "this is a secret", whatever the exact name. */
const SECRET_NAME = /(SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|PASSWD|ACCESS_KEY|SIGNING|WEBHOOK|DATABASE_URL|_TOKEN$)/i;

/** Value patterns that look like real credentials. */
const SECRET_VALUE: { label: string; re: RegExp }[] = [
  { label: 'a Paystack / Stripe secret key', re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/ },
  { label: 'a GitHub token', re: /\b(ghp_|gho_|github_pat_)[A-Za-z0-9_]{16,}/ },
  { label: 'an AWS / R2 style access key', re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { label: 'a private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'a Supabase service-role token', re: /"role"\s*:\s*"service_role"|c2VydmljZV9yb2xl/ },
  { label: 'a database connection string with a password', re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?):\/\/[^:\s]+:[^@\s]+@/ },
];

/** Public variable names per bundler. */
const PREFIX: Record<'expo' | 'vite' | 'web', string> = { expo: 'EXPO_PUBLIC_', vite: 'VITE_', web: '' };

export interface ConfigProblem {
  name: string;
  problem: string;
}

/** Find anything in a set of variables that looks like a credential (by name or by value). */
export function findSecrets(raw: Record<string, string | undefined>): ConfigProblem[] {
  const out: ConfigProblem[] = [];
  for (const [name, value] of Object.entries(raw)) {
    const bare = name.replace(/^(EXPO_PUBLIC_|VITE_|NEXT_PUBLIC_)/, '');
    if ((SECRET_ENV_NAMES as readonly string[]).includes(bare) || SECRET_NAME.test(bare)) {
      // Demo relay key is the Supabase anon key (public by design); allow it, nothing else.
      if (bare !== 'DEMO_RELAY_KEY') out.push({ name, problem: 'Server-only setting: it must never be in a public bundle.' });
    }
    if (value) for (const s of SECRET_VALUE) if (s.re.test(value)) out.push({ name, problem: `Value looks like ${s.label}. Remove it and rotate the credential.` });
  }
  return out;
}

const ENVS: readonly GoByeEnvironment[] = ['development', 'staging', 'production'];

function url(name: string, value: string | undefined, env: GoByeEnvironment, schemes: string[], problems: ConfigProblem[]): string {
  const v = (value ?? '').trim().replace(/\/+$/, '');
  if (!v) {
    problems.push({ name, problem: 'Missing.' });
    return '';
  }
  const m = /^([a-z]+):\/\/([^/\s?#]+)(\/[^\s?#]*)?$/i.exec(v);
  if (!m) {
    problems.push({ name, problem: 'Not a valid address (no query strings or fragments).' });
    return v;
  }
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (env === 'development' && local) return v;
  if (!schemes.includes(scheme)) problems.push({ name, problem: `Must use ${schemes.join(' or ')} outside development.` });
  if (env !== 'development' && local) problems.push({ name, problem: 'Points at a local or private address.' });
  if (/@/.test(host)) problems.push({ name, problem: 'Must not contain credentials.' });
  return v;
}

export interface ParseOptions {
  /** Allow simulated services in a production build (only for an approved demo build). */
  allowMocksInProduction?: boolean;
}

/**
 * Read the public configuration for one bundler. `raw` is the bundler's variables
 * (Expo: process.env with EXPO_PUBLIC_*, Vite: import.meta.env with VITE_*, web: a plain object).
 * Lists every problem at once so a misconfigured build fails with one clear message.
 */
export function parsePublicConfig(raw: Record<string, string | undefined>, source: 'expo' | 'vite' | 'web', options: ParseOptions = {}): Result<PublicConfig, ConfigProblem[]> {
  const p = PREFIX[source];
  const get = (k: string) => raw[`${p}${k}`];
  const problems: ConfigProblem[] = findSecrets(raw);

  const envRaw = (get('ENV') ?? 'development').trim().toLowerCase();
  const environment = (ENVS as readonly string[]).includes(envRaw) ? (envRaw as GoByeEnvironment) : 'development';
  if (!(ENVS as readonly string[]).includes(envRaw)) problems.push({ name: `${p}ENV`, problem: 'Must be development, staging or production.' });

  const dev = environment === 'development';
  const apiBaseUrl = url(`${p}API_BASE_URL`, get('API_BASE_URL') ?? (dev ? 'http://localhost:8787/v1' : undefined), environment, ['https'], problems);
  const realtimeUrl = url(`${p}REALTIME_URL`, get('REALTIME_URL') ?? (dev ? 'ws://localhost:8787/v1/realtime' : undefined), environment, ['wss'], problems);
  const mediaBaseUrl = url(`${p}MEDIA_BASE_URL`, get('MEDIA_BASE_URL') ?? (dev ? 'http://localhost:8787/media' : undefined), environment, ['https'], problems);

  const mocksRaw = get('USE_MOCKS')?.trim().toLowerCase();
  if (mocksRaw !== undefined && mocksRaw !== '' && !['true', 'false', '1', '0'].includes(mocksRaw)) problems.push({ name: `${p}USE_MOCKS`, problem: 'Must be true or false.' });
  const useMocks = mocksRaw === undefined || mocksRaw === '' ? environment !== 'production' : mocksRaw === 'true' || mocksRaw === '1';
  if (useMocks && environment === 'production' && !options.allowMocksInProduction) {
    problems.push({ name: `${p}USE_MOCKS`, problem: 'Simulated services are not allowed in a production build.' });
  }

  const relay = get('DEMO_RELAY_URL')?.trim();
  if (relay && environment === 'production') problems.push({ name: `${p}DEMO_RELAY_URL`, problem: 'The demo relay is for development and staging only.' });

  if (problems.length) return { ok: false, error: problems };
  return { ok: true, value: { environment, apiBaseUrl, realtimeUrl, mediaBaseUrl, useMocks, demoRelayUrl: relay || undefined } };
}

/** One line per problem, for build logs and the developer screen. */
export const describeConfigProblems = (problems: ConfigProblem[]) => problems.map((x) => `${x.name}: ${x.problem}`).join('\n');

/**
 * Guard for wiring simulated services: call it where an app picks mock implementations.
 * Throws in a production build unless mocks were explicitly allowed when parsing.
 */
export function assertMocksAllowed(config: Pick<PublicConfig, 'environment' | 'useMocks'>, options: ParseOptions = {}): void {
  if (config.environment === 'production' && !options.allowMocksInProduction) {
    throw new Error('Simulated services are disabled in production builds (D-051).');
  }
  if (!config.useMocks) throw new Error('Simulated services are switched off for this build.');
}
