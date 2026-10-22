import { CONNECTION_FLOW, canGoLive, canTransition, nextStatuses, type ApprovalRequest, type AuditEvent, type ConnectionState, type IntegrationArea, type IntegrationRecord, type PlatformDataset } from '@gobye/core';
import type { Tone } from '@/ui/kit';
import type { IconName } from '@/ui/Icon';

/**
 * Pure logic for the developer workspace (integration inventory and event log). No React, no clock:
 * callers pass `now` from usePlatform(). Nothing here talks to a provider; every result is simulated.
 */

export type Check = IntegrationRecord['checks'][number];

/* ---------- Labels ---------- */

export const AREA_ORDER: IntegrationArea[] = ['payments', 'email', 'sms', 'push', 'maps', 'auth', 'database', 'storage', 'monitoring', 'jobs', 'identity'];

export const AREA_META: Record<IntegrationArea, { label: string; icon: IconName }> = {
  payments: { label: 'Payments and payouts', icon: 'bank' },
  email: { label: 'Email', icon: 'mail' },
  sms: { label: 'SMS and OTP', icon: 'phone' },
  push: { label: 'Push notifications', icon: 'bell' },
  maps: { label: 'Maps, search and routes', icon: 'mapPin' },
  auth: { label: 'Authentication', icon: 'lock' },
  database: { label: 'Database', icon: 'server' },
  storage: { label: 'File storage', icon: 'document' },
  monitoring: { label: 'Monitoring', icon: 'radar' },
  jobs: { label: 'Background jobs', icon: 'time' },
  identity: { label: 'Identity checks', icon: 'shield' },
};

export const STATE_META: Record<ConnectionState, { tone: Tone; text: string; icon: IconName }> = {
  prototype: { tone: 'neutral', text: 'Prototype', icon: 'code' },
  configured: { tone: 'info', text: 'Configured', icon: 'settings' },
  tested: { tone: 'success', text: 'Tested', icon: 'checkCircle' },
  live: { tone: 'success', text: 'Live', icon: 'radar' },
  degraded: { tone: 'danger', text: 'Degraded', icon: 'alert' },
};

/** Visible copy must not contain dashes; dataset strings may. Also drops internal decision references. */
export function cleanText(s: string): string {
  return s
    .replace(/,?\s*D-\d+/g, '')
    .replace(/\s*[—–]\s*/g, ': ')
    .replace(/\(\s*\)/g, '')
    .trim();
}

export const providerName = (i: Pick<IntegrationRecord, 'provider'>) => cleanText(i.provider);
export const providerChosen = (i: Pick<IntegrationRecord, 'provider'>) => !/^not chosen/i.test(i.provider);

/* ---------- Secrets: masking and validation ---------- */

const DOTS = '••••';

/**
 * Mask a secret for display and audit. Never reveals more than 4 characters, and never more than a
 * quarter of a short value (a 6 character value shows 1). Empty input shows dots only.
 */
export function maskSecret(value: string): string {
  const v = value.trim();
  if (!v) return DOTS;
  const reveal = Math.min(4, Math.floor(v.length / 4));
  return reveal > 0 ? `${DOTS}${v.slice(-reveal)}` : DOTS;
}

/** Characters of the original value visible in a masked hint (for tests and guards). */
export function revealedCount(masked: string): number {
  return masked.replace(/^.*•/, '').length;
}

/** The masked part of a stored hint like "sk_test_••••7f2a" → "••••7f2a" (audit before/after). */
export function hintTail(hint: string | undefined): string {
  if (!hint) return 'None';
  const i = hint.indexOf('•');
  return i >= 0 ? hint.slice(i) : DOTS;
}

export function validateSecret(value: string, integ: Pick<IntegrationRecord, 'area' | 'provider' | 'environment'>): string | null {
  const v = value.trim();
  if (!v) return 'Enter the secret';
  if (/\s/.test(v)) return 'Secrets can’t contain spaces';
  if (v.length < 16) return 'That looks too short for a secret key';
  if (integ.area === 'payments' && /paystack/i.test(integ.provider)) {
    const want = integ.environment === 'live' ? 'sk_live_' : 'sk_test_';
    if (!v.startsWith(want)) return integ.environment === 'live' ? 'Live configuration needs a live secret key (starts sk_live_)' : 'Paystack test mode needs a test secret key (starts sk_test_)';
  }
  return null;
}

/** Hint stored after "saving": a non-secret kind prefix for Paystack keys plus the masked tail. */
export function credentialHintFor(value: string): string {
  const v = value.trim();
  const prefix = /^(sk_test_|sk_live_)/.exec(v)?.[1] ?? '';
  return `${prefix}${maskSecret(v.slice(prefix.length))}`;
}

/* ---------- Checks and connection tests ---------- */

const DEFAULT_CHECKS: Record<IntegrationArea, string[]> = {
  payments: ['API key valid', 'Webhook URL reachable', 'Webhook signature verified'],
  email: ['Sender domain verified', 'API key valid', 'Delivery webhook reachable'],
  sms: ['Sender ID approved', 'API key valid', 'Test OTP delivered'],
  push: ['iOS credentials', 'Android credentials'],
  maps: ['API key valid', 'Key restricted to GoBye apps', 'Routes request succeeds'],
  auth: ['OTP sign in works', 'Session policy applied'],
  database: ['Connection healthy', 'Migrations up to date', 'Recent backup restorable'],
  storage: ['Bucket reachable', 'Access rules applied'],
  monitoring: ['Project key valid', 'Test error received'],
  jobs: ['Queue reachable', 'Scheduler running'],
  identity: ['API key valid', 'Test verification returns a result'],
};

/** Checks that depend on someone outside engineering; a connection test can't pass them. */
const EXTERNAL_CHECKS: { match: RegExp; waitingOn: 'owner' | 'provider'; detail: string }[] = [
  { match: /business verification/i, waitingOn: 'owner', detail: 'Waiting on owner (CAC documents)' },
  { match: /settlement account/i, waitingOn: 'owner', detail: 'Waiting on owner to confirm the settlement account' },
  { match: /sender id approved/i, waitingOn: 'provider', detail: 'Waiting on provider approval' },
];

export function externalCheck(name: string) {
  return EXTERNAL_CHECKS.find((x) => x.match.test(name));
}

/** The checks an integration must pass. Records without any get the documented defaults for their area. */
export function requiredChecks(i: Pick<IntegrationRecord, 'area' | 'checks'>): Check[] {
  return i.checks.length ? i.checks : DEFAULT_CHECKS[i.area].map((name) => ({ name, passed: false }));
}

export const NO_CREDENTIALS = 'No credentials configured';

/**
 * Simulated connection test. Without credentials every technical check fails with "No credentials
 * configured". With credentials, technical checks pass. Checks waiting on the owner or the provider
 * keep their state either way (a test can't complete business verification).
 */
export function simulateConnectionTest(i: Pick<IntegrationRecord, 'area' | 'checks' | 'credentialHint'>, at: number): Check[] {
  const checks = requiredChecks(i);
  return checks.map((c) => {
    const ext = externalCheck(c.name);
    if (ext) return c.passed ? { name: c.name, passed: true, at, detail: c.detail } : { name: c.name, passed: false, at, detail: c.detail ?? ext.detail };
    if (!i.credentialHint) return { name: c.name, passed: false, at, detail: NO_CREDENTIALS };
    return { name: c.name, passed: true, at };
  });
}

/** Apply test results to a record (mutates; use on an act() draft). */
export function applyTestResults(i: IntegrationRecord, results: Check[], at: number) {
  i.checks = results;
  const ok = canGoLive(results);
  if (ok) i.lastSuccessfulTestAt = at;
  else {
    const failed = results.filter((c) => !c.passed);
    i.failures = [{ at, message: `Connection test: ${failed.length} of ${results.length} checks failed (${failed[0]!.name}: ${failed[0]!.detail ?? 'failed'})`, resolved: false }, ...i.failures];
  }
  if (!ok && i.state === 'live' && canTransition(CONNECTION_FLOW, 'live', 'degraded')) i.state = 'degraded';
  return ok;
}

/* ---------- State transitions ---------- */

export interface TransitionOption {
  to: ConnectionState;
  label: string;
  /** Reason the action is unavailable; undefined when it can be taken. */
  blocked?: string;
  /** Going live on payments creates an approval instead of changing the state. */
  viaApproval?: boolean;
}

export function pendingLiveRequest(approvals: ApprovalRequest[], integrationId: string) {
  return approvals.find((a) => a.kind === 'payments_activation' && a.status === 'pending' && a.target.type === 'integration' && a.target.id === integrationId && !/^Change settlement destination/.test(a.title));
}

/**
 * Buttons for the integration's next states, following CONNECTION_FLOW. Rules on top of the table:
 * configured needs a chosen provider and credentials; tested needs every check passed; live needs a
 * live configuration with every check passed, and for payments an owner approval.
 */
export function transitionOptions(i: IntegrationRecord, ctx: { pendingLive?: ApprovalRequest } = {}): TransitionOption[] {
  if (i.area === 'database') return [];
  const allPass = canGoLive(i.checks);
  return nextStatuses(CONNECTION_FLOW, i.state).map((to): TransitionOption => {
    switch (to) {
      case 'configured':
        if (i.state === 'prototype') {
          if (!providerChosen(i)) return { to, label: 'Mark configured', blocked: 'Choose a provider first' };
          if (!i.credentialHint) return { to, label: 'Mark configured', blocked: 'Add a credential first' };
          return { to, label: 'Mark configured' };
        }
        return { to, label: i.state === 'tested' ? 'Back to configured' : 'Take out of service' };
      case 'tested':
        return { to, label: 'Mark tested', blocked: allPass ? undefined : 'Run a connection test; every check must pass' };
      case 'prototype':
        return { to, label: 'Back to prototype' };
      case 'degraded':
        return { to, label: 'Mark degraded' };
      case 'live': {
        const label = i.area === 'payments' ? 'Request live' : 'Mark live';
        if (i.environment !== 'live') return { to, label, blocked: 'This is the test configuration. Live needs its own configuration and checks' };
        if (!allPass) return { to, label, blocked: 'Every live check must pass first' };
        if (i.area === 'payments') return { to, label, viaApproval: true, blocked: ctx.pendingLive ? `Already requested (${ctx.pendingLive.id})` : undefined };
        return { to, label };
      }
    }
  });
}

/** Payments going live always needs an owner approval; nothing else changes state directly to live without passing checks. */
export function canApplyTransition(i: IntegrationRecord, to: ConnectionState): { ok: true } | { ok: false; error: string } {
  if (!canTransition(CONNECTION_FLOW, i.state, to)) return { ok: false, error: 'That change isn’t allowed from this state' };
  const opt = transitionOptions(i).find((o) => o.to === to);
  if (!opt) return { ok: false, error: 'That change isn’t available for this integration' };
  if (opt.blocked) return { ok: false, error: opt.blocked };
  if (opt.viaApproval) return { ok: false, error: 'Payments go live only through an owner approval' };
  return { ok: true };
}

export function nextApprovalId(approvals: Pick<ApprovalRequest, 'id'>[]): string {
  const max = approvals.reduce((m, a) => Math.max(m, Number(/^apr-(\d+)$/.exec(a.id)?.[1] ?? 0)), 0);
  return `apr-${String(max + 1).padStart(4, '0')}`;
}

/* ---------- Environments, callbacks, dependencies ---------- */

/** The other environment's record for the same area and provider (test ↔ live), if it exists. */
export function counterpart(all: IntegrationRecord[], i: IntegrationRecord, env: 'test' | 'live') {
  if (i.environment === env) return i;
  return all.find((x) => x.area === i.area && x.environment === env && x.provider === i.provider);
}

const CALLBACK_AREAS: IntegrationArea[] = ['payments', 'email', 'sms', 'identity'];
export const hasCallbacks = (area: IntegrationArea) => CALLBACK_AREAS.includes(area);

export function webhookUrl(i: Pick<IntegrationRecord, 'provider' | 'environment'>): string {
  const slug = cleanText(i.provider)
    .toLowerCase()
    .replace(/\(.*\)/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '');
  return `https://api.example.test/webhooks/${slug}${i.environment === 'test' ? '/test' : ''}`;
}

const DEP_ALIASES: Record<string, IntegrationArea> = {
  database: 'database',
  'background jobs': 'jobs',
  jobs: 'jobs',
  email: 'email',
  sms: 'sms',
  push: 'push',
  storage: 'storage',
  'file storage': 'storage',
  monitoring: 'monitoring',
  auth: 'auth',
  authentication: 'auth',
  maps: 'maps',
  payments: 'payments',
};

/** Resolve "Database" / "Background jobs" names in dependsOn to the integration records they mean. */
export function resolveDependency(all: IntegrationRecord[], name: string, env: 'test' | 'live'): IntegrationRecord | undefined {
  const area = DEP_ALIASES[name.toLowerCase()];
  if (!area) return undefined;
  return all.find((x) => x.area === area && x.environment === env) ?? all.find((x) => x.area === area);
}

export const openFailures = (i: Pick<IntegrationRecord, 'failures'>) => i.failures.filter((f) => !f.resolved).length;

/* ---------- Event stream (webhooks, jobs, integration failures) ---------- */

export type EventSource = 'collection' | 'payout' | 'integration' | 'announcement';
export type EventOutcome = 'processed' | 'duplicate' | 'failed';

export interface StreamEvent {
  id: string;
  at: number;
  source: EventSource;
  /** Provider event or job name, e.g. "charge.success", "sms.delivery". */
  type: string;
  reference: string;
  outcome: EventOutcome;
  detail: string;
  provider: string;
  record?: { type: 'passenger' | 'driver'; id: string };
  integrationId?: string;
  retried?: { at: number; by: string };
}

export const SOURCE_LABEL: Record<EventSource, string> = {
  collection: 'Collection webhooks',
  payout: 'Payout webhooks',
  integration: 'Integration checks',
  announcement: 'Announcement jobs',
};

export const OUTCOME_META: Record<EventOutcome, { tone: Tone; text: string; icon: IconName }> = {
  processed: { tone: 'success', text: 'Processed', icon: 'checkCircle' },
  duplicate: { tone: 'neutral', text: 'Duplicate, ignored', icon: 'copy' },
  failed: { tone: 'danger', text: 'Failed', icon: 'alert' },
};

export const RETRY_ACTION = 'event.retried';

/** Retries are recorded only in the audit trail (target type "event"); the stream reads them back. */
export function retriedEvents(audit: AuditEvent[]): Map<string, { at: number; by: string }> {
  const m = new Map<string, { at: number; by: string }>();
  for (const a of audit) if (a.action === RETRY_ACTION && a.target.type === 'event' && !m.has(a.target.id)) m.set(a.target.id, { at: a.at, by: a.actor.name });
  return m;
}

const CHANNEL_LABEL = { inbox: 'Inbox', push: 'Push', email: 'Email', sms: 'SMS' } as const;

/**
 * Assemble the event history from shared records. Duplicate webhook deliveries are flagged and never
 * counted as processed again; a retried failure reads as processed with who retried it.
 */
export function buildEventStream(d: Pick<PlatformDataset, 'collections' | 'withdrawals' | 'integrations' | 'announcements' | 'audit'>): StreamEvent[] {
  const out: StreamEvent[] = [];
  const retried = retriedEvents(d.audit);

  for (const c of d.collections) {
    const seen = new Set<string>();
    c.events.forEach((e, k) => {
      const key = e.event;
      const duplicate = !!e.duplicate || seen.has(key);
      seen.add(key);
      out.push({
        id: `${c.id}:${k}`,
        at: e.at,
        source: 'collection',
        type: e.event,
        reference: c.reference,
        outcome: duplicate ? 'duplicate' : 'processed',
        detail: duplicate ? 'Same reference and event already applied' : e.event === 'charge.failed' ? 'Payment failed at the provider; nothing credited' : `Verified server side; ${c.purpose.replace(/_/g, ' ')} recorded`,
        provider: c.provider,
        record: { type: c.payerType, id: c.payerId },
      });
    });
  }

  for (const w of d.withdrawals) {
    w.history.forEach((h, k) => {
      if (h.by.kind !== 'provider') return;
      const type = /^(transfer\.[a-z]+)/.exec(h.note ?? '')?.[1] ?? `transfer.${h.status}`;
      const rest = (h.note ?? '').replace(/^transfer\.[a-z]+:?\s*/, '');
      out.push({
        id: `${w.id}:${k}`,
        at: h.at,
        source: 'payout',
        type,
        reference: w.transferReference ?? w.id,
        outcome: 'processed',
        detail: rest ? `${rest.charAt(0).toUpperCase()}${rest.slice(1)}` : `Withdrawal marked ${h.status}`,
        provider: h.by.name,
        record: { type: 'driver', id: w.driverId },
      });
    });
  }

  for (const i of d.integrations) {
    i.failures.forEach((f) => {
      out.push({
        id: `${i.id}:f${f.at}`,
        at: f.at,
        source: 'integration',
        type: `${i.area}.failure`,
        reference: i.id,
        outcome: f.resolved ? 'processed' : 'failed',
        detail: f.resolved ? `${cleanText(f.message)} (resolved)` : cleanText(f.message),
        provider: `${providerName(i)} (${i.environment})`,
        integrationId: i.id,
      });
    });
  }

  for (const a of d.announcements) {
    const at = a.sentVersion?.at;
    if (!at) continue;
    (Object.keys(a.delivery) as (keyof typeof a.delivery)[]).forEach((ch) => {
      const x = a.delivery[ch];
      if (!x.failed) return;
      out.push({
        id: `${a.id}:${ch}`,
        at,
        source: 'announcement',
        type: `${ch}.delivery`,
        reference: a.id,
        outcome: 'failed',
        detail: `${x.failed} of ${x.attempted} ${CHANNEL_LABEL[ch]} deliveries failed for “${a.title}”`,
        provider: ch === 'sms' || ch === 'email' ? `${CHANNEL_LABEL[ch]} provider not chosen` : CHANNEL_LABEL[ch],
      });
    });
  }

  for (const e of out) {
    const r = retried.get(e.id);
    if (r && e.outcome === 'failed') {
      e.outcome = 'processed';
      e.retried = r;
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

export interface EventFilter {
  source: EventSource | 'all';
  outcome: EventOutcome | 'all';
  query: string;
}

export function filterEvents(events: StreamEvent[], f: EventFilter): StreamEvent[] {
  const q = f.query.trim().toLowerCase();
  return events.filter((e) => (f.source === 'all' || e.source === f.source) && (f.outcome === 'all' || e.outcome === f.outcome) && (!q || e.reference.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)));
}

export function outcomeCounts(events: StreamEvent[]): Record<EventOutcome, number> {
  const c: Record<EventOutcome, number> = { processed: 0, duplicate: 0, failed: 0 };
  for (const e of events) c[e.outcome]++;
  return c;
}
