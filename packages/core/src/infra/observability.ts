import type { GoByeEnvironment } from './env';

/**
 * Observability foundation (D-051): structured JSON logs with redaction, a metrics interface and the
 * provisional alert policies. Status: implemented and tested locally. No log store, metrics backend or
 * alert channel is connected yet (Pending provider selection): sinks are interfaces.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  ts: string;
  env: GoByeEnvironment;
  service: string;
  level: LogLevel;
  event: string;
  requestId?: string;
  correlationId?: string;
  outcome?: 'success' | 'failure' | 'rejected' | 'timeout' | 'retry';
  durationMs?: number;
  error?: { kind?: string; code?: string; message?: string; status?: number };
  [k: string]: unknown;
}

export type LogSink = (e: LogEvent) => void;

export interface Logger {
  log(level: LogLevel, event: string, fields?: Omit<Partial<LogEvent>, 'ts' | 'env' | 'service' | 'level' | 'event'> & Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

/* ---------- Redaction ---------- */

const SECRET_KEYS = /^(password|pass|pwd|pin|pickup_?pin|otp|otp_?code|verification_?code|token|access_?token|refresh_?token|id_?token|authorization|cookie|set-cookie|secret|api_?key|apikey|x-api-key|signature|card(_?number)?|pan|cvv|cvc|private_?key|session)$/i;
const ID_KEYS = /^(nin|bvn|licence(_?number)?|license(_?number)?|id_?number|identity_?number|account_?number|passport(_?number)?)$/i;
const COORD_KEYS = /^(lat|latitude|lng|lon|longitude)$/i;

const SIGNED_PARAMS = /([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|Signature|token|access_token|sig|signature|Expires|X-Amz-Date)=)[^&#\s"]*/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET_LIKE = /\b(sk|rk)_(live|test)_[A-Za-z0-9]{6,}|\b(ghp_|github_pat_)[A-Za-z0-9_]{10,}|\b(AKIA|ASIA)[A-Z0-9]{16}\b/g;

const R = '[redacted]';

/** Scrub one string: signed URL params, bearer tokens, JWTs, card-like numbers and known secret formats. */
export function redactString(s: string): string {
  return s.replace(SIGNED_PARAMS, `$1${R}`).replace(BEARER, `$1 ${R}`).replace(JWT, R).replace(SECRET_LIKE, R).replace(CARD, (m) => (m.replace(/\D/g, '').length >= 13 ? R : m));
}

/**
 * Deep copy with secrets removed: credential fields dropped, ID numbers masked to the last four,
 * coordinates rounded to 3 decimal places (~110 m), strings scrubbed. Safe to log.
 */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6) return '[truncated]' as unknown as T;
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) out[k] = R;
      else if (ID_KEYS.test(k) && (typeof v === 'string' || typeof v === 'number')) out[k] = `••••${String(v).slice(-4)}`;
      else if (COORD_KEYS.test(k) && typeof v === 'number') out[k] = Math.round(v * 1000) / 1000;
      else out[k] = redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/* ---------- Logger ---------- */

export function createLogger(opts: { service: string; environment: GoByeEnvironment; sink?: LogSink; minLevel?: LogLevel; now?: () => number; base?: Record<string, unknown> }): Logger {
  const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const min = order[opts.minLevel ?? (opts.environment === 'production' ? 'info' : 'debug')];
  const sink: LogSink = opts.sink ?? (() => undefined);
  const now = opts.now ?? Date.now;
  const make = (base: Record<string, unknown>): Logger => ({
    log(level, event, fields = {}) {
      if (order[level] < min) return;
      const e = redact({ ...base, ...fields }) as Record<string, unknown>;
      sink({ ...e, ts: new Date(now()).toISOString(), env: opts.environment, service: opts.service, level, event } as LogEvent);
    },
    child: (fields) => make({ ...base, ...fields }),
  });
  return make(opts.base ?? {});
}

/** A sink that keeps events in memory (tests, the admin's simulated views). */
export function memorySink(): LogSink & { events: LogEvent[] } {
  const events: LogEvent[] = [];
  const s = ((e: LogEvent) => void events.push(e)) as LogSink & { events: LogEvent[] };
  s.events = events;
  return s;
}

/* ---------- Metrics ---------- */

export type MetricName =
  | 'api_requests_total'
  | 'api_request_duration_ms'
  | 'api_errors_total'
  | 'auth_failures_total'
  | 'uploads_total'
  | 'upload_failures_total'
  | 'storage_bytes'
  | 'proxy_errors_total'
  | 'origin_health'
  | 'matching_failures_total'
  | 'realtime_disconnects_total'
  | 'queue_failures_total'
  | 'deployment_failures_total';

export type MetricLabels = Record<string, string>;

export interface Metrics {
  counter(name: MetricName, value?: number, labels?: MetricLabels): void;
  histogram(name: MetricName, value: number, labels?: MetricLabels): void;
  gauge(name: MetricName, value: number, labels?: MetricLabels): void;
}

const key = (name: string, labels: MetricLabels = {}) => `${name}{${Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join(',')}}`;

/** In-memory metrics (tests and local runs). A real exporter implements the same interface. */
export function memoryMetrics() {
  const counters = new Map<string, number>();
  const gauges = new Map<string, number>();
  const hist = new Map<string, number[]>();
  const m: Metrics & { count(name: MetricName, labels?: MetricLabels): number; values(name: MetricName, labels?: MetricLabels): number[]; gaugeValue(name: MetricName, labels?: MetricLabels): number | undefined } = {
    counter: (name, value = 1, labels) => void counters.set(key(name, labels), (counters.get(key(name, labels)) ?? 0) + value),
    histogram: (name, value, labels) => void hist.set(key(name, labels), [...(hist.get(key(name, labels)) ?? []), value]),
    gauge: (name, value, labels) => void gauges.set(key(name, labels), value),
    count: (name, labels) => counters.get(key(name, labels)) ?? 0,
    values: (name, labels) => hist.get(key(name, labels)) ?? [],
    gaugeValue: (name, labels) => gauges.get(key(name, labels)),
  };
  return m;
}

/** Percentile of a sample (nearest rank). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/* ---------- Service levels and alerts (PROVISIONAL) ---------- */

/** Provisional service-level objectives. No production data exists yet: review after launch. */
export const PROVISIONAL_SLOS = [
  { id: 'api-availability', target: '99.5% of /v1 requests succeed (non-5xx) per 30 days', provisional: true },
  { id: 'api-latency', target: 'p95 < 800 ms for reads, < 1500 ms for booking creation, per 7 days', provisional: true },
  { id: 'realtime', target: '99% of trip events delivered within 3 s of being recorded', provisional: true },
  { id: 'uploads', target: '99% of document uploads complete (or fail with a clear reason) per 7 days', provisional: true },
] as const;

export type AlertSeverity = 'page' | 'ticket';

export interface AlertPolicy {
  id: string;
  title: string;
  /** Metric and threshold in words; numbers are provisional until real traffic exists. */
  condition: string;
  severity: AlertSeverity;
  runbook: string;
  provisional: true;
}

export const ALERT_POLICIES: readonly AlertPolicy[] = [
  { id: 'origin-unavailable', title: 'Backend origin unavailable', condition: 'origin_health = 0 for a pool member for 2 consecutive checks (60 s)', severity: 'page', runbook: 'LOAD_BALANCING_FAILOVER.md#origin-down', provisional: true },
  { id: 'elevated-5xx', title: 'Elevated 5xx errors', condition: 'api_errors_total{class=5xx} / api_requests_total > 2% over 5 min (min 200 requests)', severity: 'page', runbook: 'DEPLOYMENT_RUNBOOK.md#rollback', provisional: true },
  { id: 'auth-failures', title: 'Repeated authentication failures', condition: 'auth_failures_total > 50 per 5 min from one network, or > 500 overall', severity: 'ticket', runbook: 'INFRASTRUCTURE_SECURITY.md#abuse', provisional: true },
  { id: 'r2-upload-failures', title: 'R2 upload failures', condition: 'upload_failures_total / uploads_total > 5% over 15 min (min 20 uploads)', severity: 'ticket', runbook: 'R2_STORAGE_ARCHITECTURE.md#failures', provisional: true },
  { id: 'storage-growth', title: 'Unexpected storage growth', condition: 'storage_bytes grows > 3x its 7-day daily average in 24 h', severity: 'ticket', runbook: 'R2_STORAGE_ARCHITECTURE.md#quotas', provisional: true },
  { id: 'traffic-spike', title: 'Unusual traffic spike', condition: 'api_requests_total > 5x the same hour last week for 10 min', severity: 'ticket', runbook: 'INFRASTRUCTURE_SECURITY.md#ddos', provisional: true },
  { id: 'realtime-instability', title: 'Realtime instability', condition: 'realtime_disconnects_total > 3x baseline over 10 min, or active trips without a location update for 60 s > 5%', severity: 'page', runbook: 'REALTIME_ARCHITECTURE.md#incidents', provisional: true },
  { id: 'payment-failures', title: 'Payment processing failures', condition: 'payment failures > 10% over 15 min (min 20), or any webhook signature failure burst', severity: 'page', runbook: 'BACKUP_DISASTER_RECOVERY.md#payment-provider-outage', provisional: true },
  { id: 'failed-deployment', title: 'Failed deployment', condition: 'deployment_failures_total > 0, or readiness failing on a new release for 5 min', severity: 'ticket', runbook: 'DEPLOYMENT_RUNBOOK.md#failed-deploy', provisional: true },
  { id: 'unhealthy-pool', title: 'Unhealthy load-balancer pool', condition: 'healthy origins in a pool below its minimum for 2 min', severity: 'page', runbook: 'LOAD_BALANCING_FAILOVER.md#pool-unhealthy', provisional: true },
];

export interface Alert {
  policyId: string;
  at: number;
  summary: string;
  labels?: MetricLabels;
}

/** Where alerts go (email, Slack, on-call). No channel is connected yet. */
export interface AlertSink {
  send(alert: Alert): Promise<void>;
}

export function memoryAlertSink(): AlertSink & { sent: Alert[] } {
  const sent: Alert[] = [];
  return { sent, send: async (a) => void sent.push(redact(a)) };
}

/** Evaluate the error-rate policy on counts (used by tests and a future job). */
export function errorRateBreached(errors: number, total: number, threshold = 0.02, minimum = 200): boolean {
  return total >= minimum && errors / total > threshold;
}
