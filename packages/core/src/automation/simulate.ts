import type { FeeRule, FeeSchedule } from '../gateway/fees';
import type { CaseRecord, CollectionRecord, DriverRecord, WithdrawalRecord } from '../platform/types';
import type { Kobo } from '../types';
import { AUTOMATIONS } from './registry';
import type { AutomationRun, RunAttempt } from './runs';
import type { AutomationSettingChange } from './settings';

/**
 * SIMULATED data for the admin prototype: fee schedule drafts, automation run history and setting
 * change requests, derived from the existing test records. Nothing here ran on a server.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const naira = (n: number) => (n * 100) as Kobo;

/** A schedule with every fee "Not set": the honest starting point while the provider is undecided (Q-042). */
export function unsetFeeRules(): FeeRule[] {
  return [
    // Limits are placeholders for finance to confirm; fees are deliberately null (not decided).
    { operation: 'wallet_funding', provider: '*', gobyeFee: null, providerChargeEstimate: null, providerChargeBearer: 'gobye', collection: 'add', limits: { min: naira(100), max: naira(500_000) }, exemptions: [] },
    { operation: 'withdrawal', provider: '*', gobyeFee: null, providerChargeEstimate: null, providerChargeBearer: 'gobye', collection: 'deduct', limits: { min: naira(1_000), max: naira(1_000_000) }, exemptions: [] },
  ];
}

export function simulatedFeeSchedules(now: number, finance: { id: string; name: string }): FeeSchedule[] {
  return [
    {
      id: 'fee-v1',
      version: 1,
      status: 'draft',
      effectiveFrom: now + 14 * DAY,
      rules: unsetFeeRules(),
      note: 'Starting point. Fees stay "Not set" until the payment provider is chosen and its real charges are known (Q-042). Limits are placeholders.',
      createdBy: finance,
      createdAt: now - 2 * DAY,
    },
  ];
}

export function simulatedAutomationRuns(
  d: { collections: CollectionRecord[]; withdrawals: WithdrawalRecord[]; drivers: DriverRecord[]; cases: CaseRecord[] },
  now: number,
): AutomationRun[] {
  const runs: AutomationRun[] = [];
  let seq = 0;
  const id = () => `run-${String(++seq).padStart(4, '0')}`;
  const ok = (startedAt: number, ms = 800): RunAttempt => ({ n: 1, startedAt, finishedAt: startedAt + ms, outcome: 'succeeded' });
  const push = (r: Omit<AutomationRun, 'id' | 'simulated'>) => runs.push({ ...r, id: id(), simulated: true });

  // Webhook intake and wallet credit / package activation, from collections.
  for (const [ci, c] of d.collections.entries()) {
    const at = c.createdAt + 2 * MIN;
    // Webhook intake runs for the most recent 40 payments only, to keep the history readable.
    if (ci < 40) c.events.forEach((e, i) =>
      push({ automationId: 'payments.webhook.intake', triggeredBy: { kind: 'webhook', ref: `evt_${c.reference}_${i}` }, subject: { type: 'collection', id: c.id, label: c.reference }, idempotencyKey: `evt_${c.reference}_${i}`, status: 'succeeded', queuedAt: e.at, startedAt: e.at, finishedAt: e.at + 120, attempts: [{ ...ok(e.at, 120) }] }),
    );
    const autoId = c.purpose === 'package_purchase' ? 'subscription.activate' : c.purpose === 'wallet_funding' ? 'wallet.funding.credit' : null;
    if (!autoId) continue;
    if (c.status === 'successful') {
      push({ automationId: autoId, triggeredBy: { kind: 'event', ref: `payment.verified:${c.reference}` }, subject: { type: 'collection', id: c.id, label: c.reference }, idempotencyKey: c.reference, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 900, attempts: [ok(at, 900)] });
    } else if (c.status === 'pending') {
      push({ automationId: autoId, triggeredBy: { kind: 'schedule', ref: 'pending-payment poll' }, subject: { type: 'collection', id: c.id, label: c.reference }, idempotencyKey: c.reference, status: 'retry_scheduled', queuedAt: at, startedAt: at, nextAttemptAt: now + 4 * MIN, attempts: [{ n: 1, startedAt: at, finishedAt: at + 600, outcome: 'failed', failure: { class: 'transient', code: 'pending_at_provider', message: 'Provider still shows the payment as pending' } }] });
    }
  }

  // Payouts, from withdrawals.
  for (const w of d.withdrawals) {
    const sub = { type: 'withdrawal' as const, id: w.id, label: `Withdrawal ${w.id}` };
    const at = w.requestedAt + 3 * HOUR;
    if (w.status === 'successful') push({ automationId: 'wallet.withdrawal.payout', triggeredBy: { kind: 'event', ref: `withdrawal.approved:${w.id}` }, subject: sub, idempotencyKey: w.id, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 1500, attempts: [ok(at, 1500)] });
    if (w.status === 'failed')
      push({ automationId: 'wallet.withdrawal.payout', triggeredBy: { kind: 'event', ref: `withdrawal.approved:${w.id}` }, subject: sub, idempotencyKey: w.id, status: 'failed', queuedAt: at, startedAt: at, finishedAt: at + 180_000, attempts: [{ n: 1, startedAt: at, finishedAt: at + 180_000, outcome: 'failed', failure: { class: 'permanent', code: 'account_not_credited', message: 'Provider: account could not be credited. Earnings returned to the driver.' } }], escalated: { at: at + 181_000, toRoles: ['finance'] } });
    if (w.status === 'processing')
      push({ automationId: 'wallet.withdrawal.payout', triggeredBy: { kind: 'event', ref: `withdrawal.approved:${w.id}` }, subject: sub, idempotencyKey: w.id, status: 'needs_lookup', queuedAt: at, startedAt: at, finishedAt: at + 45_000, attempts: [{ n: 1, startedAt: at, finishedAt: at + 45_000, outcome: 'failed', failure: { class: 'unknown_outcome', code: 'timeout_after_send', message: 'No answer within 45 s after the transfer was sent. It may have gone through.' } }], escalated: { at: at + 46_000, toRoles: ['finance'] } });
  }

  // Daily reconciliation: last 7 days, one transient failure that recovered and one still failing today.
  for (let i = 7; i >= 1; i--) {
    const at = now - i * DAY + 2 * HOUR;
    const day = new Date(at).toISOString().slice(0, 10);
    const sub = { type: 'day' as const, id: day, label: day };
    if (i === 3)
      push({ automationId: 'payments.reconcile.daily', triggeredBy: { kind: 'schedule', ref: `daily ${day}` }, subject: sub, idempotencyKey: `paystack-test:${day}`, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 6 * MIN, attempts: [{ n: 1, startedAt: at, finishedAt: at + 30_000, outcome: 'failed', failure: { class: 'transient', code: 'report_not_ready', message: 'Provider settlement report not ready yet' } }, { n: 2, startedAt: at + 5 * MIN, finishedAt: at + 6 * MIN, outcome: 'succeeded' }] });
    else push({ automationId: 'payments.reconcile.daily', triggeredBy: { kind: 'schedule', ref: `daily ${day}` }, subject: sub, idempotencyKey: `paystack-test:${day}`, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 4 * MIN, attempts: [ok(at, 4 * MIN)] });
  }
  {
    const at = now - 18 * HOUR;
    const day = new Date(now - DAY).toISOString().slice(0, 10);
    push({ automationId: 'payments.reconcile.daily', triggeredBy: { kind: 'schedule', ref: `daily ${day}` }, subject: { type: 'day', id: `${day}-b`, label: `${day} (second provider report)` }, idempotencyKey: `paystack-test:${day}:b`, status: 'failed', queuedAt: at, startedAt: at, finishedAt: at + 2 * HOUR, attempts: [1, 2, 3, 4].map((n) => ({ n, startedAt: at + (n - 1) * 30 * MIN, finishedAt: at + (n - 1) * 30 * MIN + 20_000, outcome: 'failed' as const, failure: { class: 'transient' as const, code: 'provider_unavailable', message: 'Provider report endpoint returned 503' } })), escalated: { at: at + 2 * HOUR, toRoles: ['finance'] } });
  }

  // Document expiry: one run a day.
  const expiring = d.drivers.filter((x) => x.documents.some((doc) => doc.expiresAt !== undefined && doc.expiresAt < now + 14 * DAY)).length;
  for (let i = 5; i >= 0; i--) {
    const at = now - i * DAY - 14 * HOUR;
    push({ automationId: 'drivers.documents.expiry', triggeredBy: { kind: 'schedule', ref: 'daily 06:00' }, subject: { type: 'day', id: `docs-${i}`, label: `${expiring} drivers checked` }, idempotencyKey: `docs:${new Date(at).toISOString().slice(0, 10)}`, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 40_000, attempts: [ok(at, 40_000)] });
  }

  // Subscription expiry sweeps and reminders (recent ticks only).
  for (let i = 6; i >= 1; i--) {
    const at = now - i * 10 * MIN;
    push({ automationId: 'subscription.expire', triggeredBy: { kind: 'schedule', ref: 'every minute' }, idempotencyKey: `expire:${at}`, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 300, attempts: [ok(at, 300)] });
  }
  for (const drv of d.drivers.filter((x) => x.access && x.access.expiresAt > now && x.access.expiresAt < now + 2 * DAY).slice(0, 6)) {
    const at = now - 30 * MIN;
    push({ automationId: 'subscription.reminder', triggeredBy: { kind: 'schedule', ref: 'every 15 minutes' }, subject: { type: 'driver', id: drv.id, label: drv.name }, idempotencyKey: `remind:${drv.id}:${drv.access!.expiresAt}:1`, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 700, attempts: [ok(at, 700)] });
  }

  // Support and safety escalation.
  for (const c of d.cases.filter((x) => x.status === 'new').slice(0, 4)) {
    const at = c.openedAt + (c.team === 'safety' ? 2 : 60) * MIN;
    push({ automationId: c.team === 'safety' ? 'safety.event.escalate' : 'support.escalate', triggeredBy: { kind: c.team === 'safety' ? 'event' : 'schedule', ref: c.ref }, subject: { type: 'case', id: c.id, label: `${c.ref} · ${c.subject}` }, idempotencyKey: `${c.id}:1`, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 500, attempts: [ok(at, 500)] });
  }
  {
    const at = now - 40 * MIN;
    push({ automationId: 'support.escalate', triggeredBy: { kind: 'schedule', ref: 'every 5 minutes' }, idempotencyKey: `support-sweep:${at}`, status: 'failed', queuedAt: at, startedAt: at, finishedAt: at + 30_000, attempts: [{ n: 1, startedAt: at, finishedAt: at + 30_000, outcome: 'failed', failure: { class: 'permanent', code: 'template_missing', message: 'Alert template "care.overdue" not found' } }] });
  }

  // Bookings: a few expiries; infra alert.
  for (let i = 0; i < 4; i++) {
    const at = now - (i + 1) * 3 * HOUR;
    push({ automationId: i % 2 ? 'bookings.negotiation.expire' : 'bookings.search.expire', triggeredBy: { kind: 'condition', ref: 'timer' }, subject: { type: 'booking', id: `bk-${i}`, label: `Booking bk-${i}` }, idempotencyKey: `bk-${i}`, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 200, attempts: [ok(at, 200)] });
  }
  {
    const at = now - 5 * HOUR;
    push({ automationId: 'infra.alerts', triggeredBy: { kind: 'condition', ref: 'health: payments test webhook' }, subject: { type: 'provider', id: 'int-pay-test', label: 'Paystack (test)' }, idempotencyKey: `alert:webhook:${at}`, status: 'succeeded', queuedAt: at, startedAt: at, finishedAt: at + 900, attempts: [ok(at, 900)] });
    const q = now + 2 * MIN;
    push({ automationId: 'payments.reconcile.daily', triggeredBy: { kind: 'schedule', ref: 'daily 02:00' }, subject: { type: 'day', id: 'next', label: 'Next run' }, idempotencyKey: 'paystack-test:next', status: 'queued', queuedAt: q, attempts: [] });
  }

  // Keep ids stable, newest first.
  const known = new Set(AUTOMATIONS.map((a) => a.id));
  return runs.filter((r) => known.has(r.automationId)).sort((a, b) => (b.startedAt ?? b.queuedAt) - (a.startedAt ?? a.queuedAt));
}

export function simulatedSettingChanges(now: number, people: { mkt: { id: string; name: string }; owner: { id: string; name: string }; care: { id: string; name: string } }): AutomationSettingChange[] {
  return [
    { id: 'asc-0001', automationId: 'subscription.reminder', key: 'dailyHoursBefore', from: 2, to: 3, reason: 'Drivers asked for more notice before the daily pass ends', status: 'pending_approval', requestedBy: people.mkt, requestedAt: now - 5 * HOUR },
    { id: 'asc-0002', automationId: 'support.escalate', key: 'highMinutes', from: 120, to: 60, reason: 'Tighter response target for high priority', status: 'approved', requestedBy: people.care, requestedAt: now - 6 * DAY, decidedBy: people.owner, decidedAt: now - 5 * DAY },
  ];
}
