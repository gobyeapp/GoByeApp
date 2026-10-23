import type { StaffRole } from '../platform/permissions';

/**
 * Automation Centre registry (D-055).
 *
 * Every background process GoBye relies on is declared here once, with how it starts, what it may be
 * configured to do, what it does on the server, how it retries, when it times out, who is told when it
 * fails and which staff role owns it. The admin Automation Centre reads this list; the future backend
 * job runner must implement exactly these definitions.
 *
 * All authoritative automations run on the server (`execution: 'server'`). No automation runs in the
 * apps or the admin. Status: DEFINITIONS ONLY. No job runner, scheduler or queue exists yet (Q-064:
 * backend not selected), so nothing here is live.
 */

export type TriggerType = 'event' | 'schedule' | 'webhook' | 'condition';

export interface RetryPolicy {
  /** Total attempts including the first. 1 = never retried automatically. */
  maxAttempts: number;
  /** Delay before the 2nd attempt; doubles each time (exponential backoff) up to `maxDelayMs`, plus jitter. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** Only `transient` failures are retried automatically. `unknown_outcome` is never retried blindly. */
  retryOn: readonly 'transient'[];
}

export interface Escalation {
  /** Escalate after this many consecutive failed runs (or one failure if `immediate`). */
  afterFailures: number;
  immediate?: boolean;
  toRoles: StaffRole[];
  channel: 'admin_alert' | 'admin_alert_and_email';
  note: string;
}

export type ParamKind = 'minutes' | 'hours' | 'days' | 'count' | 'boolean';
export interface ConfigurableParam {
  key: string;
  label: string;
  kind: ParamKind;
  /** Current approved value (placeholder until the owner confirms; see `confirmed`). */
  value: number | boolean;
  min?: number;
  max?: number;
  /** False = placeholder, shown as such; true = an owner-confirmed business rule. */
  confirmed: boolean;
  hint?: string;
}

export type AutomationArea = 'subscriptions' | 'wallet' | 'payments' | 'reconciliation' | 'drivers' | 'bookings' | 'support' | 'safety' | 'infrastructure';

export interface AutomationDefinition {
  id: string;
  name: string;
  purpose: string;
  area: AutomationArea;
  trigger: { type: TriggerType; source: string; conditions: string[]; schedule?: string };
  /** What the server does, step by step (the contract for the backend). */
  action: string[];
  execution: 'server';
  /** Moves money or changes balances: needs durable processing, idempotency and reconciliation. */
  financial: boolean;
  /** How a run is made safe to repeat. */
  idempotencyKey: string;
  retry: RetryPolicy;
  timeoutMs: number;
  escalation: Escalation;
  ownerRole: StaffRole;
  params: ConfigurableParam[];
  /** Manual retry allowed from the admin, and with which permission. Successful financial runs are never replayable. */
  manualRetry: 'allowed' | 'lookup_first' | 'not_allowed';
  /** What exists today. Always 'not_connected' until a backend job runner is chosen and tested. */
  runtime: 'not_connected' | 'simulated' | 'live';
  rules: string[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const transient = ['transient'] as const;
const quickRetry: RetryPolicy = { maxAttempts: 5, baseDelayMs: 30_000, maxDelayMs: 15 * MIN, retryOn: transient };
const slowRetry: RetryPolicy = { maxAttempts: 4, baseDelayMs: 5 * MIN, maxDelayMs: 2 * HOUR, retryOn: transient };
const noAutoRetry: RetryPolicy = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, retryOn: transient };

export const AUTOMATIONS: readonly AutomationDefinition[] = [
  {
    id: 'subscription.activate',
    name: 'Activate driver package',
    purpose: 'Give a driver access once their package payment is confirmed: ₦2,000 for 24 hours or ₦60,000 for 30 days.',
    area: 'subscriptions',
    trigger: { type: 'event', source: 'payment.verified (purpose: package_purchase)', conditions: ['Payment verified with the provider (server lookup)', 'Amount equals the package price in force', 'Reference not already used for an activation'] },
    action: ['Post the package purchase to company revenue', 'Start access now, or at the end of current access if one is active', 'Tell the driver the exact end time'],
    execution: 'server',
    financial: true,
    idempotencyKey: 'payment reference',
    retry: quickRetry,
    timeoutMs: 30_000,
    escalation: { afterFailures: 1, immediate: true, toRoles: ['finance'], channel: 'admin_alert_and_email', note: 'A driver paid but has no access: fix within the hour.' },
    ownerRole: 'finance',
    params: [],
    manualRetry: 'lookup_first',
    runtime: 'not_connected',
    rules: ['Prices are confirmed: daily ₦2,000 / 24 hours, monthly ₦60,000 / 30 days (BR-062).', 'Never activate from a webhook alone.', 'One activation per payment reference.'],
  },
  {
    id: 'subscription.expire',
    name: 'End expired driver access',
    purpose: 'Stop new ride requests reaching drivers whose package has ended.',
    area: 'subscriptions',
    trigger: { type: 'schedule', source: 'Scheduler', schedule: 'Every minute', conditions: ['Access end time has passed', 'Driver not already marked expired'] },
    action: ['Mark access expired', 'Stop matching the driver to new requests', 'Let a trip already in progress finish (BR-072 assumption, Q-043)', 'Tell the driver'],
    execution: 'server',
    financial: false,
    idempotencyKey: 'driver id + access end time',
    retry: quickRetry,
    timeoutMs: 60_000,
    escalation: { afterFailures: 3, toRoles: ['operations', 'developer'], channel: 'admin_alert', note: 'Expired drivers may still be getting requests.' },
    ownerRole: 'operations',
    params: [],
    manualRetry: 'allowed',
    runtime: 'not_connected',
    rules: ['Matching also checks access at request time, so a late run never lets an expired driver accept.'],
  },
  {
    id: 'subscription.reminder',
    name: 'Package renewal reminders',
    purpose: 'Remind drivers before their access ends so they can renew without a gap.',
    area: 'subscriptions',
    trigger: { type: 'schedule', source: 'Scheduler', schedule: 'Every 15 minutes', conditions: ['Access ends within the reminder window', 'No reminder sent for this access period'] },
    action: ['Send an in-app message (and push if allowed)', 'Record that the reminder was sent'],
    execution: 'server',
    financial: false,
    idempotencyKey: 'driver id + access end time + reminder number',
    retry: slowRetry,
    timeoutMs: 60_000,
    escalation: { afterFailures: 5, toRoles: ['developer'], channel: 'admin_alert', note: 'Reminders are not going out.' },
    ownerRole: 'marketing',
    params: [
      { key: 'monthlyHoursBefore', label: 'Monthly package: remind this many hours before', kind: 'hours', value: 48, min: 1, max: 168, confirmed: false },
      { key: 'dailyHoursBefore', label: 'Daily package: remind this many hours before', kind: 'hours', value: 2, min: 1, max: 12, confirmed: false },
    ],
    manualRetry: 'allowed',
    runtime: 'not_connected',
    rules: ['Never renews or charges automatically: renewal is the driver’s choice (Q-043).'],
  },
  {
    id: 'wallet.funding.credit',
    name: 'Credit wallet funding',
    purpose: 'Add money to a passenger wallet once the provider confirms the payment.',
    area: 'wallet',
    trigger: { type: 'event', source: 'Webhook intake or pending-payment poll', conditions: ['Provider lookup says successful', 'Amount and currency match the quote shown', 'Reference not already credited'] },
    action: ['Look the payment up with the provider', 'Post one balanced journal: wallet, GoBye fee, provider charge, provider clearing', 'Mark the collection successful', 'Tell the passenger'],
    execution: 'server',
    financial: true,
    idempotencyKey: 'payment reference',
    retry: quickRetry,
    timeoutMs: 30_000,
    escalation: { afterFailures: 1, immediate: true, toRoles: ['finance'], channel: 'admin_alert_and_email', note: 'A mismatch or repeated failure: money may be with the provider but not in the wallet.' },
    ownerRole: 'finance',
    params: [{ key: 'pollMinutes', label: 'Look up pending payments every', kind: 'minutes', value: 5, min: 1, max: 60, confirmed: false }],
    manualRetry: 'lookup_first',
    runtime: 'not_connected',
    rules: ['A webhook only starts a lookup; it never credits by itself.', 'Amount mismatch goes to finance, not to the wallet.'],
  },
  {
    id: 'wallet.withdrawal.payout',
    name: 'Send driver withdrawal',
    purpose: 'Submit an approved withdrawal to the provider and record the result.',
    area: 'wallet',
    trigger: { type: 'event', source: 'withdrawal.approved', conditions: ['Withdrawal approved (finance review at or above the threshold)', 'Earnings reserved', 'No earlier transfer for this reference'] },
    action: ['Submit the transfer with the withdrawal reference as idempotency key', 'Wait for the provider’s final result (webhook, then lookup)', 'Successful: move the reserve to provider clearing; failed: return the reserve to earnings'],
    execution: 'server',
    financial: true,
    idempotencyKey: 'withdrawal id',
    retry: { ...quickRetry, maxAttempts: 3 },
    timeoutMs: 45_000,
    escalation: { afterFailures: 1, immediate: true, toRoles: ['finance'], channel: 'admin_alert_and_email', note: 'Unknown outcome: never resubmit, look up by reference.' },
    ownerRole: 'finance',
    params: [],
    manualRetry: 'lookup_first',
    runtime: 'not_connected',
    rules: ['A timeout after sending is an unknown outcome: look up, never resend.', 'A successful payout can never be replayed.'],
  },
  {
    id: 'payments.webhook.intake',
    name: 'Payment webhook intake',
    purpose: 'Receive provider notifications safely and hand them to the right workflow.',
    area: 'payments',
    trigger: { type: 'webhook', source: 'Provider webhook (through the API gateway)', conditions: ['Signature valid', 'Event id not seen before'] },
    action: ['Verify the signature with the server-side secret', 'Store the raw event', 'Drop duplicates by event id', 'Queue a lookup for the reference'],
    execution: 'server',
    financial: true,
    idempotencyKey: 'provider event id',
    retry: noAutoRetry,
    timeoutMs: 5_000,
    escalation: { afterFailures: 10, toRoles: ['developer'], channel: 'admin_alert', note: 'Many rejected or failing webhooks: check the secret and endpoint.' },
    ownerRole: 'developer',
    params: [],
    manualRetry: 'allowed',
    runtime: 'not_connected',
    rules: ['Answers the provider quickly; the money work happens in the lookup job.', 'Unsigned events are stored as rejected and never acted on.'],
  },
  {
    id: 'payments.reconcile.daily',
    name: 'Daily reconciliation',
    purpose: 'Match every provider transaction and settlement to the ledger, every day.',
    area: 'reconciliation',
    trigger: { type: 'schedule', source: 'Scheduler', schedule: 'Daily at 02:00 Lagos time', conditions: ['Provider settlement report available for the day'] },
    action: ['Fetch the provider report', 'Match by reference: amount, charge, status', 'Record differences as reconciliation items (suspense) for finance', 'Never change a balance automatically'],
    execution: 'server',
    financial: true,
    idempotencyKey: 'provider + date',
    retry: slowRetry,
    timeoutMs: 10 * MIN,
    escalation: { afterFailures: 1, toRoles: ['finance'], channel: 'admin_alert_and_email', note: 'A day not reconciled blocks provider switching.' },
    ownerRole: 'finance',
    params: [{ key: 'runAtHour', label: 'Run at (hour, Lagos time)', kind: 'count', value: 2, min: 0, max: 23, confirmed: false }],
    manualRetry: 'allowed',
    runtime: 'not_connected',
    rules: ['Differences become items for a person to resolve; corrections need two people.'],
  },
  {
    id: 'drivers.documents.expiry',
    name: 'Driver document expiry',
    purpose: 'Warn drivers before a document expires and pause them when it has.',
    area: 'drivers',
    trigger: { type: 'schedule', source: 'Scheduler', schedule: 'Daily at 06:00 Lagos time', conditions: ['Document expires within the warning window, or has expired'] },
    action: ['Remind the driver to upload a new document', 'On expiry: mark the document expired and stop new requests until a new one is accepted', 'Add the driver to the onboarding review queue'],
    execution: 'server',
    financial: false,
    idempotencyKey: 'driver id + document + expiry date + stage',
    retry: slowRetry,
    timeoutMs: 5 * MIN,
    escalation: { afterFailures: 2, toRoles: ['onboarding'], channel: 'admin_alert', note: 'Expired documents may not be enforced.' },
    ownerRole: 'onboarding',
    params: [{ key: 'warnDays', label: 'Warn this many days before', kind: 'days', value: 14, min: 1, max: 60, confirmed: false }],
    manualRetry: 'allowed',
    runtime: 'not_connected',
    rules: ['Never suspends an account outright; only pauses new requests until a valid document is accepted.'],
  },
  {
    id: 'bookings.search.expire',
    name: 'Expire unmatched bookings',
    purpose: 'Close a booking that found no driver in time and tell the passenger.',
    area: 'bookings',
    trigger: { type: 'condition', source: 'Booking timer', conditions: ['Booking still searching when the timeout is reached'] },
    action: ['Mark the booking "no driver found"', 'Release any wallet hold', 'Tell the passenger and offer to try again'],
    execution: 'server',
    financial: false,
    idempotencyKey: 'booking id',
    retry: quickRetry,
    timeoutMs: 15_000,
    escalation: { afterFailures: 5, toRoles: ['operations', 'developer'], channel: 'admin_alert', note: 'Bookings may hang in "searching".' },
    ownerRole: 'operations',
    params: [{ key: 'searchMinutes', label: 'Search for a driver for up to', kind: 'minutes', value: 5, min: 1, max: 15, confirmed: false }],
    manualRetry: 'allowed',
    runtime: 'not_connected',
    rules: ['A driver acceptance arriving after expiry is refused.'],
  },
  {
    id: 'bookings.negotiation.expire',
    name: 'Expire fare offers',
    purpose: 'End a negotiation offer, counteroffer or driver response when its time is up.',
    area: 'bookings',
    trigger: { type: 'condition', source: 'Offer timer', conditions: ['Offer or response not answered before its expiry'] },
    action: ['Mark the offer or response expired', 'Withdraw it from the other side’s screen', 'Keep the agreed fare only if one was selected before expiry'],
    execution: 'server',
    financial: false,
    idempotencyKey: 'offer id + round',
    retry: quickRetry,
    timeoutMs: 10_000,
    escalation: { afterFailures: 5, toRoles: ['operations', 'developer'], channel: 'admin_alert', note: 'Expired offers may still be selectable.' },
    ownerRole: 'operations',
    params: [{ key: 'offerMinutes', label: 'An offer stays open for (minutes)', kind: 'minutes', value: 2, min: 1, max: 10, confirmed: false }],
    manualRetry: 'not_allowed',
    runtime: 'not_connected',
    rules: ['The server clock decides expiry; the app timer is only a display.'],
  },
  {
    id: 'support.escalate',
    name: 'Support case escalation',
    purpose: 'Escalate support cases nobody has answered within the response target.',
    area: 'support',
    trigger: { type: 'schedule', source: 'Scheduler', schedule: 'Every 5 minutes', conditions: ['Case new or waiting on GoBye past its response target'] },
    action: ['Mark the case overdue', 'Move it to the top of the queue', 'Alert the care lead; urgent cases also alert operations'],
    execution: 'server',
    financial: false,
    idempotencyKey: 'case id + escalation level',
    retry: quickRetry,
    timeoutMs: 30_000,
    escalation: { afterFailures: 3, toRoles: ['care'], channel: 'admin_alert', note: 'Overdue cases are not being flagged.' },
    ownerRole: 'care',
    params: [
      { key: 'urgentMinutes', label: 'Urgent: respond within', kind: 'minutes', value: 15, min: 5, max: 60, confirmed: false },
      { key: 'highMinutes', label: 'High: respond within', kind: 'minutes', value: 60, min: 15, max: 480, confirmed: false },
    ],
    manualRetry: 'allowed',
    runtime: 'not_connected',
    rules: ['Escalation never closes or answers a case.'],
  },
  {
    id: 'safety.event.escalate',
    name: 'Safety event escalation',
    purpose: 'Make sure every safety report is acknowledged by a person quickly.',
    area: 'safety',
    trigger: { type: 'event', source: 'safety.reported (SOS, report, unusual stop)', conditions: ['Not acknowledged within the window'] },
    action: ['Alert the safety team at once', 'Re-alert every few minutes until acknowledged', 'After the window, alert operations and the owner'],
    execution: 'server',
    financial: false,
    idempotencyKey: 'safety case id + alert level',
    retry: { maxAttempts: 10, baseDelayMs: 10_000, maxDelayMs: 60_000, retryOn: transient },
    timeoutMs: 10_000,
    escalation: { afterFailures: 1, immediate: true, toRoles: ['safety', 'operations', 'owner'], channel: 'admin_alert_and_email', note: 'Safety alerts must never fail silently.' },
    ownerRole: 'safety',
    params: [{ key: 'ackMinutes', label: 'Escalate if not acknowledged within', kind: 'minutes', value: 2, min: 1, max: 10, confirmed: false }],
    manualRetry: 'allowed',
    runtime: 'not_connected',
    rules: ['GoBye is not an emergency service: the app always shows how to call emergency services directly.'],
  },
  {
    id: 'infra.alerts',
    name: 'Infrastructure alerts',
    purpose: 'Tell the technical team when a service, provider or job stops working.',
    area: 'infrastructure',
    trigger: { type: 'condition', source: 'Health checks and error rates (MONITORING_OBSERVABILITY.md)', conditions: ['Health check failing', 'Error rate above threshold', 'A job’s escalation fired'] },
    action: ['Open an alert with the evidence', 'Notify the on-call developer', 'Close it automatically when healthy again'],
    execution: 'server',
    financial: false,
    idempotencyKey: 'alert rule + incident window',
    retry: quickRetry,
    timeoutMs: 15_000,
    escalation: { afterFailures: 1, immediate: true, toRoles: ['developer'], channel: 'admin_alert_and_email', note: 'Alerting itself is failing.' },
    ownerRole: 'developer',
    params: [{ key: 'errorRatePct', label: 'Alert when errors exceed (%)', kind: 'count', value: 5, min: 1, max: 50, confirmed: false }],
    manualRetry: 'allowed',
    runtime: 'not_connected',
    rules: ['Thresholds are provisional until monitoring is chosen (MONITORING_OBSERVABILITY.md).'],
  },
];

// Appended separately so the list above stays grouped by the brief's order.
(AUTOMATIONS as AutomationDefinition[]).push({
  id: 'costs.sync',
  name: 'Expense synchronisation',
  purpose: 'Pull usage and invoices from providers that offer billing APIs, so costs don’t rely on manual entry alone.',
  area: 'infrastructure',
  trigger: { type: 'schedule', source: 'Scheduler', schedule: 'Daily at 07:00 Lagos time', conditions: ['Provider has a connected billing API'] },
  action: ['Fetch usage and invoices for the month', 'Create draft expenses for finance to review (never approved automatically)', 'Flag usage approaching a budget'],
  execution: 'server',
  financial: false,
  idempotencyKey: 'provider + invoice id',
  retry: slowRetry,
  timeoutMs: 5 * MIN,
  escalation: { afterFailures: 3, toRoles: ['finance', 'developer'], channel: 'admin_alert', note: 'Costs may be missing from the dashboard.' },
  ownerRole: 'finance',
  params: [],
  manualRetry: 'allowed',
  runtime: 'not_connected',
  rules: ['No billing API is connected yet; costs are entered by hand with an invoice.', 'Synced costs arrive as drafts and still need approval.'],
});

export const AREA_LABEL: Record<AutomationArea, string> = {
  subscriptions: 'Driver packages',
  wallet: 'Wallet',
  payments: 'Payments',
  reconciliation: 'Reconciliation',
  drivers: 'Drivers',
  bookings: 'Bookings',
  support: 'Support',
  safety: 'Safety',
  infrastructure: 'Infrastructure',
};

export const automationById = (id: string) => AUTOMATIONS.find((a) => a.id === id);

/** Checks a proposed parameter change against the definition's bounds. */
export function validateParamChange(def: AutomationDefinition, key: string, value: number | boolean): string | null {
  const p = def.params.find((x) => x.key === key);
  if (!p) return 'This setting can’t be changed.';
  if (p.kind === 'boolean') return typeof value === 'boolean' ? null : 'Choose on or off.';
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'Enter a whole number.';
  if (p.min !== undefined && value < p.min) return `The lowest allowed is ${p.min}.`;
  if (p.max !== undefined && value > p.max) return `The highest allowed is ${p.max}.`;
  return null;
}
