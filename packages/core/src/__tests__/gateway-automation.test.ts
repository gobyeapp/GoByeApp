import {
  AUTOMATIONS,
  REQUIRED_CAPABILITIES,
  activateDueSchedules,
  afterFailure,
  approveFeeSchedule,
  classifyFailure,
  computeFee,
  consecutiveFailures,
  createPlatformDataset,
  createSimulatedGateway,
  decideFundingCredit,
  decideSettingChange,
  fundingJournalLines,
  manualActionCheck,
  missingCapabilities,
  paramValue,
  payoutGuard,
  postVerifiedFunding,
  quoteFee,
  retryDelay,
  scheduleInForce,
  shouldEscalate,
  switchReadiness,
  unsetFeeRules,
  validateParamChange,
  validateSchedule,
  webhookIntake,
  type AutomationRun,
  type FeeRule,
  type FeeSchedule,
  type Kobo,
  type Permission,
} from '../index';

const N = (n: number) => (n * 100) as Kobo;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 23, 10);
const who = { id: 'stf-owner', name: 'Owner' };
const fin = { id: 'stf-fin', name: 'Finance' };

const rule = (over: Partial<FeeRule> = {}): FeeRule => ({
  operation: 'wallet_funding',
  provider: '*',
  gobyeFee: { fixed: N(50), percentBps: 0 },
  providerChargeEstimate: { fixed: N(0), percentBps: 150, cap: N(2000) },
  providerChargeBearer: 'customer',
  collection: 'add',
  limits: { min: N(100), max: N(500_000), dailyMax: N(1_000_000) },
  exemptions: [],
  ...over,
});
const schedule = (rules: FeeRule[], over: Partial<FeeSchedule> = {}): FeeSchedule => ({
  id: 'fee-t',
  version: 2,
  status: 'active',
  effectiveFrom: NOW - DAY,
  rules,
  note: 'test values only',
  createdBy: fin,
  createdAt: NOW - 2 * DAY,
  approvedBy: who,
  ...over,
});

describe('fee schedules (test values only, not GoBye prices)', () => {
  it('computes fixed + basis points with min and cap, in whole kobo', () => {
    expect(computeFee({ fixed: N(0), percentBps: 150 }, N(10_000))).toBe(N(150));
    expect(computeFee({ fixed: N(0), percentBps: 150, cap: N(100) }, N(10_000))).toBe(N(100));
    expect(computeFee({ fixed: N(0), percentBps: 150, min: N(20) }, N(100))).toBe(N(20));
    expect(Number.isInteger(computeFee({ fixed: 0 as Kobo, percentBps: 33 }, 12_345 as Kobo))).toBe(true);
  });

  it('refuses to quote when fees are not set: the starting schedule blocks every operation', () => {
    const s = schedule(unsetFeeRules());
    const q = quoteFee([s], 'wallet_funding', N(5000), NOW, { provider: 'paystack' });
    expect(q).toMatchObject({ ok: false, block: 'fee_not_set' });
    expect(quoteFee([s], 'withdrawal', N(5000), NOW, { provider: 'paystack' })).toMatchObject({ ok: false, block: 'fee_not_set' });
  });

  it('refuses without a provider, without an approved schedule, and outside limits', () => {
    const s = schedule([rule()]);
    expect(quoteFee([s], 'wallet_funding', N(5000), NOW, { provider: null })).toMatchObject({ ok: false, block: 'provider_not_selected' });
    expect(quoteFee([{ ...s, approvedBy: undefined, status: 'draft' }], 'wallet_funding', N(5000), NOW, { provider: 'p' })).toMatchObject({ ok: false, block: 'no_schedule' });
    expect(quoteFee([s], 'wallet_funding', N(50), NOW, { provider: 'p' })).toMatchObject({ ok: false, block: 'below_minimum' });
    expect(quoteFee([s], 'wallet_funding', N(600_000), NOW, { provider: 'p' })).toMatchObject({ ok: false, block: 'above_maximum' });
    expect(quoteFee([s], 'wallet_funding', N(10_000), NOW, { provider: 'p', todayTotal: N(995_000) })).toMatchObject({ ok: false, block: 'over_daily_limit' });
  });

  it('adds customer-borne fees on top and discloses each one before confirmation', () => {
    const q = quoteFee([schedule([rule()])], 'wallet_funding', N(10_000), NOW, { provider: 'p' });
    if (!q.ok) throw new Error(q.message);
    expect(q.quote).toMatchObject({ gobyeFee: N(50), providerChargeEstimate: N(150), customerPays: N(10_200), recipientGets: N(10_000) });
    expect(q.quote.disclosure.join('\n')).toMatch(/GoBye fee: ₦50/);
    expect(q.quote.disclosure.join('\n')).toMatch(/You pay: ₦10,200/);
  });

  it('deducts fees from a withdrawal and applies exemptions', () => {
    const w = rule({ operation: 'withdrawal', collection: 'deduct', providerChargeBearer: 'gobye', exemptions: [{ kind: 'free_per_month', count: 2 }] });
    const first = quoteFee([schedule([w])], 'withdrawal', N(10_000), NOW, { provider: 'p', monthCount: 0 });
    const third = quoteFee([schedule([w])], 'withdrawal', N(10_000), NOW, { provider: 'p', monthCount: 2 });
    if (!first.ok || !third.ok) throw new Error('quote failed');
    expect(first.quote).toMatchObject({ gobyeFee: 0, customerPays: N(10_000), recipientGets: N(10_000) });
    expect(third.quote).toMatchObject({ gobyeFee: N(50), recipientGets: N(9_950) });
  });

  it('a provider-specific rule wins over the any-provider rule', () => {
    const q = quoteFee([schedule([rule(), rule({ provider: 'flw', gobyeFee: { fixed: N(10), percentBps: 0 } })])], 'wallet_funding', N(1000), NOW, { provider: 'flw' });
    expect(q.ok && q.quote.gobyeFee).toBe(N(10));
  });

  it('uses the version in force on the date: a future version never applies early', () => {
    const v2 = schedule([rule()], { id: 'v2', version: 2, effectiveFrom: NOW - DAY });
    const v3 = schedule([rule({ gobyeFee: { fixed: N(80), percentBps: 0 } })], { id: 'v3', version: 3, status: 'scheduled', effectiveFrom: NOW + DAY });
    expect(scheduleInForce([v2, v3], NOW)?.id).toBe('v2');
    expect(scheduleInForce([v2, v3], NOW + 2 * DAY)?.id).toBe('v3');
  });

  it('validates drafts: future start, no duplicates, sane limits', () => {
    expect(validateSchedule({ rules: [rule()], effectiveFrom: NOW + DAY }, NOW)).toEqual([]);
    const bad = validateSchedule({ rules: [rule(), rule({ limits: { min: N(10), max: N(5) } })], effectiveFrom: NOW - 1 }, NOW).map((p) => p.message).join('\n');
    expect(bad).toMatch(/Start date must be in the future/);
    expect(bad).toMatch(/listed twice/);
    expect(bad).toMatch(/maximum is below the minimum/);
  });

  it('approval: two people, future date only, then activates on its date', () => {
    const xs = [schedule([rule()], { id: 'old', status: 'active', effectiveFrom: NOW - 5 * DAY }), schedule([rule()], { id: 'new', status: 'pending_approval', approvedBy: undefined, effectiveFrom: NOW + DAY, version: 3 })];
    expect(approveFeeSchedule(xs, 'new', fin, NOW)).toMatchObject({ ok: false });
    expect(approveFeeSchedule(xs, 'new', who, NOW)).toEqual({ ok: true });
    expect(xs[1]!.status).toBe('scheduled');
    activateDueSchedules(xs, NOW + 2 * DAY);
    expect(xs.map((x) => x.status)).toEqual(['superseded', 'active']);
  });
});

describe('payment safety', () => {
  const quote = { customerPays: N(10_200), recipientGets: N(10_000), gobyeFee: N(50) };

  it('credits only after a matching server lookup, and only once', () => {
    const base = { reference: 'GB-1', quote, ledger: [], providerChargeAbsorbedByGobye: false };
    expect(decideFundingCredit({ ...base, verification: null }).action).toBe('wait');
    expect(decideFundingCredit({ ...base, verification: { reference: 'GB-1', status: 'pending', amountReceived: 0 as Kobo, currency: 'NGN', providerCharge: null } }).action).toBe('wait');
    expect(decideFundingCredit({ ...base, verification: { reference: 'GB-1', status: 'successful', amountReceived: N(10_000), currency: 'NGN', providerCharge: N(150) } })).toMatchObject({ action: 'investigate', reason: 'amount_mismatch' });
    const ok = decideFundingCredit({ ...base, verification: { reference: 'GB-1', status: 'successful', amountReceived: N(10_200), currency: 'NGN', providerCharge: N(150) } });
    expect(ok.action).toBe('credit');
    if (ok.action !== 'credit') return;
    const posted = postVerifiedFunding([], { passengerId: 'p1', provider: 'sim', reference: 'GB-1', breakdown: ok.breakdown, now: NOW });
    if (!posted.ok) throw new Error('post failed');
    expect(decideFundingCredit({ ...base, ledger: posted.entries, verification: null }).action).toBe('already_credited');
    const again = postVerifiedFunding(posted.entries, { passengerId: 'p1', provider: 'sim', reference: 'GB-1', breakdown: ok.breakdown, now: NOW + 1 });
    expect(again.ok && again.duplicate).toBe(true);
  });

  it('records gross, provider charge, GoBye fee, wallet and settlement separately and balanced', () => {
    const b = { gross: N(10_200), providerCharge: N(150), providerChargeAbsorbed: 0 as Kobo, gobyeFee: N(50), walletMovement: N(10_000), settlement: N(10_050) };
    const lines = fundingJournalLines('p1', 'sim', b);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(lines.find((l) => l.account.kind === 'fee_income')?.amount).toBe(N(50));
    expect(lines.find((l) => l.account.kind === 'passenger_wallet')?.amount).toBe(N(10_000));
    expect(lines.find((l) => l.account.kind === 'provider_clearing')?.amount).toBe(-N(10_050));
    expect(lines.some((l) => l.account.kind === 'suspense')).toBe(false);
    // GoBye absorbs the provider charge: it shows as a processing cost.
    const absorbed = fundingJournalLines('p1', 'sim', { gross: N(10_050), providerCharge: N(150), providerChargeAbsorbed: N(150), gobyeFee: N(50), walletMovement: N(10_000), settlement: N(9_900) });
    expect(absorbed.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(absorbed.find((l) => l.account.kind === 'processing_costs')?.amount).toBe(-N(150));
    // Provider charged more than the estimate the customer paid: the gap goes to suspense, never hidden.
    const gap = fundingJournalLines('p1', 'sim', { gross: N(10_200), providerCharge: N(160), providerChargeAbsorbed: 0 as Kobo, gobyeFee: N(50), walletMovement: N(10_000), settlement: N(10_040) });
    expect(gap.find((l) => l.account.kind === 'suspense')?.amount).toBe(-N(10)); // a shortfall: debit side, like a cost
    expect(gap.reduce((s, l) => s + l.amount, 0)).toBe(0);
  });

  it('never submits a payout twice; an unknown outcome must be looked up', () => {
    expect(payoutGuard({ approved: false })).toMatchObject({ allowed: false, reason: 'not_approved' });
    expect(payoutGuard({ approved: true })).toEqual({ allowed: true });
    expect(payoutGuard({ approved: true, lastAttempt: { reference: 'w1', outcome: 'unknown' } })).toMatchObject({ allowed: false, reason: 'outcome_unknown' });
    expect(payoutGuard({ approved: true, providerStatus: { reference: 'w1', status: 'successful', amount: N(1), providerCharge: null } })).toMatchObject({ allowed: false, reason: 'already_paid' });
    expect(payoutGuard({ approved: true, lastAttempt: { reference: 'w1', outcome: 'failed_transient' }, providerStatus: { reference: 'w1', status: 'failed', amount: N(1), providerCharge: null } })).toEqual({ allowed: true });
  });

  it('webhooks: duplicates dropped by event id; an event only triggers a lookup', () => {
    const e = { eventId: 'e1', type: 'collection.successful' as const, reference: 'GB-1', receivedAt: NOW };
    expect(webhookIntake(new Set(), e)).toEqual({ action: 'verify', reference: 'GB-1', kind: 'collection' });
    expect(webhookIntake(new Set(['e1']), e)).toEqual({ action: 'ignore_duplicate' });
  });

  it('switching providers: blocked until live, capable, reconciled and approved; in-flight money drains on the old one', () => {
    const r = switchReadiness({ target: { key: 'b', state: 'tested', missingCapabilities: ['payout_bank_transfer'] }, current: { key: 'a', pendingCollections: 2, processingTransfers: 1, unreconciledDays: 1 }, approved: false });
    expect(r.canSwitch).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/not live/);
    expect(r.blockers.join(' ')).toMatch(/Reconcile/);
    expect(r.drain).toHaveLength(2);
    expect(switchReadiness({ target: { key: 'b', state: 'live', missingCapabilities: [] }, current: { key: 'a', pendingCollections: 0, processingTransfers: 0, unreconciledDays: 0 }, approved: true }).canSwitch).toBe(true);
  });
});

describe('simulated gateway adapter', () => {
  it('declares every capability GoBye needs and is labelled simulated', () => {
    const g = createSimulatedGateway();
    expect(g.simulated).toBe(true);
    expect(missingCapabilities(g)).toEqual([]);
    expect(missingCapabilities({ capabilities: ['collect_card'] })).toEqual([...REQUIRED_CAPABILITIES]);
  });

  it('is idempotent by reference: a second transfer call returns the first', async () => {
    const g = createSimulatedGateway();
    const req = { reference: 'w1', amount: N(5000), bankAccount: { bankCode: '000', accountNumber: '0', accountName: 'x' }, narration: 'GoBye' };
    await g.createTransfer(req);
    const again = await g.createTransfer(req);
    expect(again.ok).toBe(true);
    expect((await g.getTransfer('w1')).ok).toBe(true);
  });

  it('an unknown-outcome failure still registers the transfer, so a lookup finds it', async () => {
    const g = createSimulatedGateway({ failNext: ['unknown_outcome'] });
    const r = await g.createTransfer({ reference: 'w2', amount: N(1), bankAccount: { bankCode: '0', accountNumber: '0', accountName: 'x' }, narration: '' });
    expect(r.ok).toBe(false);
    const look = await g.getTransfer('w2');
    expect(look.ok && look.value.status).toBe('processing');
  });

  it('rejects unsigned webhooks and verifies a paid collection', async () => {
    const g = createSimulatedGateway({ chargeBps: 150 });
    expect(g.parseWebhook({ rawBody: '{}', headers: {} }).ok).toBe(false);
    const w = g.signedWebhook({ eventId: 'e', type: 'collection.successful', reference: 'c1' });
    expect(g.parseWebhook(w).ok).toBe(true);
    await g.initializeCollection({ reference: 'c1', purpose: 'wallet_funding', amount: N(1000), customer: { id: 'p', name: 'P' }, quoteId: 'q' });
    g.simulatePayment('c1', N(1000));
    const v = await g.verifyCollection('c1');
    expect(v.ok && v.value).toMatchObject({ status: 'successful', amountReceived: N(1000), providerCharge: N(15) });
  });
});

describe('automation registry and runs', () => {
  it('covers every workflow in the brief, all server-side and not yet connected', () => {
    const ids = AUTOMATIONS.map((a) => a.id);
    for (const id of ['subscription.activate', 'subscription.expire', 'subscription.reminder', 'wallet.funding.credit', 'wallet.withdrawal.payout', 'payments.webhook.intake', 'payments.reconcile.daily', 'drivers.documents.expiry', 'bookings.search.expire', 'bookings.negotiation.expire', 'support.escalate', 'safety.event.escalate', 'infra.alerts'])
      expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of AUTOMATIONS) {
      expect(a.execution).toBe('server');
      expect(a.runtime).toBe('not_connected');
      expect(a.idempotencyKey.length).toBeGreaterThan(0);
      expect(a.timeoutMs).toBeGreaterThan(0);
      // Financial work is never replayed by a plain retry.
      if (a.financial) expect(a.manualRetry).not.toBe('allowed_blind' as never);
    }
  });

  it('settings change only within bounds', () => {
    const def = AUTOMATIONS.find((a) => a.id === 'subscription.reminder')!;
    expect(validateParamChange(def, 'dailyHoursBefore', 3)).toBeNull();
    expect(validateParamChange(def, 'dailyHoursBefore', 99)).toMatch(/highest/);
    expect(validateParamChange(def, 'nope', 1)).toMatch(/can’t be changed/);
  });

  it('a setting change needs a second person; the approved value is the one in force', () => {
    const def = AUTOMATIONS.find((a) => a.id === 'subscription.reminder')!;
    const c = { id: 'c', automationId: def.id, key: 'dailyHoursBefore', from: 2, to: 3, reason: 'r', status: 'pending_approval' as const, requestedBy: fin, requestedAt: NOW };
    expect(decideSettingChange(c, 'approved', fin, NOW)).toMatchObject({ ok: false });
    expect(paramValue(def, 'dailyHoursBefore', [c])).toBe(2);
    expect(decideSettingChange(c, 'approved', who, NOW)).toEqual({ ok: true });
    expect(paramValue(def, 'dailyHoursBefore', [c])).toBe(3);
  });

  it('classifies failures: anything that may have moved money is an unknown outcome', () => {
    expect(classifyFailure({ status: 503, sent: false }, true)).toBe('transient');
    expect(classifyFailure({ status: 503, sent: true }, true)).toBe('unknown_outcome');
    expect(classifyFailure({ status: 422 }, true)).toBe('permanent');
    expect(classifyFailure({ class: 'timeout' }, true)).toBe('unknown_outcome');
    expect(classifyFailure({ class: 'timeout' }, false)).toBe('timeout');
  });

  it('retries transient failures with capped exponential backoff, then fails', () => {
    const def = AUTOMATIONS.find((a) => a.id === 'payments.reconcile.daily')!;
    const d2 = retryDelay(def.retry, 2, () => 0.5);
    const d3 = retryDelay(def.retry, 3, () => 0.5);
    expect(d3).toBe(d2 * 2);
    expect(retryDelay(def.retry, 30, () => 0.5)).toBe(def.retry.maxDelayMs);
    expect(afterFailure(def, 1, 'transient', NOW).status).toBe('retry_scheduled');
    expect(afterFailure(def, def.retry.maxAttempts, 'transient', NOW).status).toBe('failed');
    expect(afterFailure(def, 1, 'permanent', NOW).status).toBe('failed');
    expect(afterFailure(def, 1, 'unknown_outcome', NOW).status).toBe('needs_lookup');
  });

  it('protected manual actions: never replay success, never retry an unknown outcome', () => {
    const can = (ps: Permission[]) => (p: Permission) => ps.includes(p);
    const yes = can(['automation.retry']);
    const run = (over: Partial<AutomationRun>): AutomationRun => ({ id: 'r', automationId: 'wallet.withdrawal.payout', triggeredBy: { kind: 'event', ref: 'x' }, idempotencyKey: 'w1', status: 'failed', queuedAt: NOW, attempts: [{ n: 1, startedAt: NOW, outcome: 'failed', failure: { class: 'permanent', code: 'x', message: 'x' } }], simulated: true, ...over });
    expect(manualActionCheck(run({ status: 'succeeded' }), 'retry', yes).allowed).toBe(false);
    expect(manualActionCheck(run({ status: 'needs_lookup' }), 'retry', yes).allowed).toBe(false);
    expect(manualActionCheck(run({ status: 'needs_lookup' }), 'lookup', yes).allowed).toBe(true);
    expect(manualActionCheck(run({}), 'retry', can([])).allowed).toBe(false);
    expect(manualActionCheck(run({ attempts: [{ n: 1, startedAt: NOW, outcome: 'failed', failure: { class: 'timeout', code: 't', message: 't' } }] }), 'retry', yes).allowed).toBe(false);
    expect(manualActionCheck(run({}), 'retry', yes).allowed).toBe(true);
    expect(manualActionCheck(run({ automationId: 'bookings.negotiation.expire' }), 'retry', yes).allowed).toBe(false);
  });

  it('escalates immediately for financial failures and after N in a row otherwise', () => {
    const pay = AUTOMATIONS.find((a) => a.id === 'wallet.withdrawal.payout')!;
    const docs = AUTOMATIONS.find((a) => a.id === 'drivers.documents.expiry')!;
    expect(shouldEscalate(pay, { status: 'needs_lookup' }, 1)).toBe(true);
    expect(shouldEscalate(docs, { status: 'failed' }, 1)).toBe(false);
    expect(shouldEscalate(docs, { status: 'failed' }, 2)).toBe(true);
    expect(shouldEscalate(docs, { status: 'succeeded' }, 5)).toBe(false);
  });

  it('the simulated dataset is labelled and consistent', () => {
    const d = createPlatformDataset();
    expect(d.automationRuns.length).toBeGreaterThan(20);
    expect(d.automationRuns.every((r) => r.simulated)).toBe(true);
    expect(d.automationRuns.some((r) => r.status === 'needs_lookup')).toBe(true);
    expect(consecutiveFailures(d.automationRuns, 'payments.reconcile.daily')).toBeGreaterThanOrEqual(1);
    // No fee amount is invented: every fee in the starting schedule is "Not set".
    expect(d.feeSchedules.every((s) => s.rules.every((r) => r.gobyeFee === null && r.providerChargeEstimate === null))).toBe(true);
    expect(d.feeSchedules.some((s) => s.approvedBy)).toBe(false);
  });
});
