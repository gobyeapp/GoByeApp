import {
  APPROVAL_RULES,
  COLLECTION_FLOW,
  REFUND_FLOW,
  WITHDRAWAL_FLOW,
  accountKey,
  balanceOf,
  canDecide,
  canTransition,
  creditWalletFunding,
  needsApproval,
  postJournal,
  releaseWithdrawal,
  settleWithdrawal,
  withdrawable,
  type Actor,
  type ApprovalRequest,
  type AuditEvent,
  type CityId,
  type CollectionRecord,
  type CollectionStatus,
  type Kobo,
  type LedgerAccount,
  type LedgerEntry,
  type LedgerEntryKind,
  type Permission,
  type PlatformDataset,
  type RecordType,
  type RefundRecord,
  type SettlementRecord,
  type StaffMember,
  type WithdrawalRecord,
  type WithdrawalStatus,
} from '@gobye/core';

/**
 * Finance workspace logic. Pure functions over the shared dataset so the screens stay thin and every
 * money rule is tested (logic.test.ts). Mutating helpers (`verifyCollection`, `applyWithdrawalAction`,
 * `applyRefundAction`, `requestLedgerAdjustment`) change a DRAFT copy only, exactly like `act().apply`,
 * and never edit a balance: they post journals through the ledger helpers in @gobye/core.
 */

export const PROVIDER = 'Paystack (test)';
export type Result = { ok: true; note?: string } | { ok: false; error: string };
type Ctx = { now: number; actor: Actor };

let seq = 0;
const newId = (p: string, now: number) => `${p}-${now.toString(36)}-${(seq++).toString(36)}`;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const nf = (k: number) => `₦${Math.round(Math.abs(k) / 100).toLocaleString('en-NG')}`;

/* ------------------------------------------------------------------ Cities */

export interface CityIndex {
  passenger: Map<string, CityId>;
  driver: Map<string, CityId>;
  trip: Map<string, CityId>;
  collectionByRef: Map<string, CollectionRecord>;
}

export function cityIndex(d: Pick<PlatformDataset, 'passengers' | 'drivers' | 'trips' | 'collections'>): CityIndex {
  return {
    passenger: new Map(d.passengers.map((p) => [p.id, p.city])),
    driver: new Map(d.drivers.map((x) => [x.id, x.city])),
    trip: new Map(d.trips.map((t) => [t.id, t.city])),
    collectionByRef: new Map(d.collections.map((c) => [c.reference, c])),
  };
}

export const payerCity = (ix: CityIndex, c: Pick<CollectionRecord, 'payerType' | 'payerId'>): CityId | undefined =>
  (c.payerType === 'passenger' ? ix.passenger : ix.driver).get(c.payerId);

/** City a ledger entry belongs to: its owner, its trip, or the payer of its collection. Company accounts have none. */
export function entryCity(ix: CityIndex, e: LedgerEntry): CityId | undefined {
  if ('ownerId' in e.account) return (e.account.kind === 'passenger_wallet' ? ix.passenger : ix.driver).get(e.account.ownerId);
  if (e.links?.tripId) return ix.trip.get(e.links.tripId);
  if (e.reference) {
    const c = ix.collectionByRef.get(e.reference.replace(/-fee$/, ''));
    if (c) return payerCity(ix, c);
  }
  return undefined;
}

/* ------------------------------------------------------------------ Collections */

export type CollectionBucket = 'successful' | 'pending' | 'failed' | 'other';
export function collectionBucket(s: CollectionStatus): CollectionBucket {
  if (s === 'successful') return 'successful';
  if (s === 'initiated' || s === 'pending') return 'pending';
  if (s === 'failed' || s === 'abandoned') return 'failed';
  return 'other';
}

export function collectionTotals(rows: readonly CollectionRecord[]) {
  const t = { successful: { amount: 0, fees: 0, count: 0 }, pending: { amount: 0, fees: 0, count: 0 }, failed: { amount: 0, fees: 0, count: 0 }, other: { amount: 0, fees: 0, count: 0 } };
  for (const c of rows) {
    const b = t[collectionBucket(c.status)];
    b.amount += c.amount;
    b.fees += c.fee;
    b.count += 1;
  }
  return t;
}

/** Journals posted for a collection (the payment itself and, for packages, the provider fee). */
export function collectionEntries(ledger: readonly LedgerEntry[], c: Pick<CollectionRecord, 'reference'>): LedgerEntry[] {
  return ledger.filter((e) => e.reference === c.reference || e.reference === `${c.reference}-fee`);
}

/** Package plan from the price in force (config `packages`), for descriptions and revenue by plan. */
export function planForAmount(d: Pick<PlatformDataset, 'configVersions'>, amount: number): 'Daily' | 'Monthly' | 'Other' {
  const cfg = d.configVersions.find((v) => v.key === 'packages' && v.status === 'active')?.value as { daily?: number; monthly?: number } | undefined;
  if (cfg?.monthly && amount === cfg.monthly * 100) return 'Monthly';
  if (cfg?.daily && amount === cfg.daily * 100) return 'Daily';
  return 'Other';
}

/** Trip id from a trip payment reference (`GB-TRIP-<tripId>`). */
export const tripIdFromReference = (ref: string) => (ref.startsWith('GB-TRIP-') ? ref.slice('GB-TRIP-'.length) : undefined);

/**
 * Post the journal(s) a verified collection creates. Idempotent by provider reference: a repeated
 * verification or duplicate webhook returns `duplicate: true` and posts nothing.
 */
export function postCollectionJournal(d: PlatformDataset, c: CollectionRecord, now: number): { ok: true; entries: LedgerEntry[]; duplicate: boolean } | { ok: false; error: string } {
  const by: Actor = { kind: 'provider', name: c.provider };
  const clearing: LedgerAccount = { kind: 'provider_clearing', provider: c.provider };
  if (c.purpose === 'wallet_funding') {
    const r = creditWalletFunding(d.ledger, { passengerId: c.payerId, amount: c.amount, provider: c.provider, reference: c.reference, now });
    return r.ok ? { ok: true, entries: r.entries, duplicate: r.duplicate } : { ok: false, error: r.error };
  }
  if (c.purpose === 'package_purchase') {
    const r = postJournal(d.ledger, { lines: [{ account: { kind: 'company_revenue' }, amount: c.amount }, { account: clearing, amount: -c.amount as Kobo }], kind: 'package_purchase', description: `${planForAmount(d, c.amount)} access package`, by, now, reference: c.reference, provider: c.provider });
    if (!r.ok) return { ok: false, error: r.error };
    if (!c.fee) return { ok: true, entries: r.entries, duplicate: r.duplicate };
    const f = postJournal(r.entries, { lines: [{ account: { kind: 'processing_costs' }, amount: -c.fee as Kobo }, { account: clearing, amount: c.fee }], kind: 'processing_fee', description: 'Provider fee on package purchase', by, now, reference: `${c.reference}-fee`, provider: c.provider });
    return f.ok ? { ok: true, entries: f.entries, duplicate: r.duplicate && f.duplicate } : { ok: false, error: f.error };
  }
  const tripId = tripIdFromReference(c.reference);
  const trip = tripId ? d.trips.find((t) => t.id === tripId) : undefined;
  if (!trip?.driverId) return { ok: false, error: 'Trip for this payment not found' };
  // A direct payment to the driver's own account is recorded only; it never becomes withdrawable earnings.
  if (trip.directToDriver) return { ok: false, error: 'This trip was paid directly to the driver. It is recorded only and never credited to earnings.' };
  const r = postJournal(d.ledger, { lines: [{ account: { kind: 'driver_earnings', ownerId: trip.driverId }, amount: c.amount }, { account: clearing, amount: -c.amount as Kobo }], kind: 'driver_trip_earning', description: 'Trip paid by transfer (collection account)', by, now, reference: c.reference, provider: c.provider, links: { tripId: trip.id } });
  return r.ok ? { ok: true, entries: r.entries, duplicate: r.duplicate } : { ok: false, error: r.error };
}

/**
 * SIMULATED "verify with provider": in the real system the backend asks the provider for the
 * transaction status. Here the provider answers `result`. Crediting happens once; checking a
 * collection that is already successful records the answer as a duplicate and credits nothing.
 */
export function verifyCollection(draft: PlatformDataset, id: string, p: { now: number; result: 'successful' | 'failed' }): Result & { duplicate?: boolean } {
  const c = draft.collections.find((x) => x.id === id);
  if (!c) return { ok: false, error: 'Collection not found' };
  if (p.result === 'failed') {
    if (!canTransition(COLLECTION_FLOW, c.status, 'failed')) return { ok: false, error: `Can’t mark as failed from ${c.status}` };
    c.status = 'failed';
    c.events.push({ at: p.now, event: 'charge.failed (simulated check)' });
    return { ok: true, note: 'Provider says failed. Nothing was credited.' };
  }
  const already = c.status === 'successful';
  if (!already && c.status !== 'pending' && c.status !== 'initiated') return { ok: false, error: `Can’t verify a ${c.status} collection` };
  const r = postCollectionJournal(draft, c, p.now);
  if (!r.ok) return r;
  draft.ledger = r.entries;
  c.events.push({ at: p.now, event: 'charge.success (simulated check)', ...(r.duplicate ? { duplicate: true } : {}) });
  if (!already) {
    c.status = 'successful';
    c.verifiedAt = p.now;
  }
  return r.duplicate ? { ok: true, duplicate: true, note: 'Already verified. Nothing was credited again.' } : { ok: true, duplicate: false, note: 'Verified. Credited once.' };
}

/* ------------------------------------------------------------------ Wallets */

export interface WalletSummary {
  passengerId: string;
  balance: number;
  deposits: number;
  charges: number;
  refunds: number;
  rewards: number;
  corrections: number;
  lines: number;
  lastAt?: number;
}

export function walletSummaries(ledger: readonly LedgerEntry[]): Map<string, WalletSummary> {
  const m = new Map<string, WalletSummary>();
  for (const e of ledger) {
    if (e.account.kind !== 'passenger_wallet') continue;
    const id = e.account.ownerId;
    const w = m.get(id) ?? { passengerId: id, balance: 0, deposits: 0, charges: 0, refunds: 0, rewards: 0, corrections: 0, lines: 0 };
    w.balance += e.amount;
    w.lines += 1;
    w.lastAt = Math.max(w.lastAt ?? 0, e.at);
    if (e.kind === 'wallet_funding') w.deposits += e.amount;
    else if (e.kind === 'trip_charge') w.charges += -e.amount;
    else if (e.kind === 'refund') w.refunds += e.amount;
    else if (e.kind === 'referral_reward') w.rewards += e.amount;
    else w.corrections += e.amount;
    m.set(id, w);
  }
  return m;
}

/** Total held for passengers: a liability (money received for future use), never revenue. */
export const walletLiability = (ws: Iterable<WalletSummary>) => sum([...ws].map((w) => w.balance));

export function validateCorrection(p: { amount: number; direction: 'credit' | 'debit'; reason: string; balance?: number }): string | null {
  if (!Number.isInteger(p.amount) || p.amount <= 0) return 'Enter an amount above zero';
  if (!p.reason.trim()) return 'Add a reason';
  if (p.direction === 'debit' && p.balance !== undefined && p.amount > p.balance) return 'A debit can’t take the balance below zero';
  return null;
}

/** Corrections never apply directly: they become an approval request for the owner (four eyes). */
export function requestLedgerAdjustment(
  draft: PlatformDataset,
  p: Ctx & { title: string; target: { type: RecordType; id: string; label: string }; amount: number; reason: string; adjustment?: ApprovalRequest['adjustment'] },
): Result & { approvalId?: string } {
  if (!p.reason.trim()) return { ok: false, error: 'Add a reason' };
  if (p.amount <= 0) return { ok: false, error: 'Enter an amount above zero' };
  const dup = draft.approvals.find((a) => a.kind === 'ledger_adjustment' && a.status === 'pending' && a.target.id === p.target.id && a.title === p.title);
  if (dup) return { ok: false, error: 'The same correction is already waiting for approval' };
  const approval: ApprovalRequest = {
    id: newId('apr', p.now),
    kind: 'ledger_adjustment',
    title: p.title,
    requestedBy: p.actor,
    requestedAt: p.now,
    target: p.target,
    amount: p.amount as Kobo,
    status: 'pending',
    note: p.reason.trim(),
    approverRoles: [...APPROVAL_RULES.ledger_adjustment.approverRoles],
    adjustment: p.adjustment,
  };
  draft.approvals = [approval, ...draft.approvals];
  return { ok: true, approvalId: approval.id };
}

export const pendingAdjustments = (approvals: readonly ApprovalRequest[], targetId: string) => approvals.filter((a) => a.kind === 'ledger_adjustment' && a.status === 'pending' && a.target.id === targetId);

/* ------------------------------------------------------------------ Driver earnings */

export interface EarningsSummary {
  driverId: string;
  tripEarnings: number;
  adjustments: number;
  reserved: number;
  withdrawable: number;
  paidOut: number;
  returnedAfterReversal: number;
  directCount: number;
  directValue: number;
}

export function earningsSummary(d: Pick<PlatformDataset, 'ledger' | 'trips'>, driverId: string): EarningsSummary {
  let tripEarnings = 0;
  let adjustments = 0;
  let paid = 0;
  let returned = 0;
  for (const e of d.ledger) {
    if (!('ownerId' in e.account) || e.account.ownerId !== driverId) continue;
    if (e.account.kind === 'driver_earnings') {
      if (e.kind === 'trip_charge' || e.kind === 'driver_trip_earning') tripEarnings += e.amount;
      else if (e.kind === 'reversal' && e.links?.withdrawalId) returned += e.amount;
      else if (e.kind === 'adjustment' || e.kind === 'reversal') adjustments += e.amount;
    }
    if (e.account.kind === 'driver_withdrawal_reserve' && e.kind === 'withdrawal_payout') paid += -e.amount;
  }
  const direct = d.trips.filter((t) => t.driverId === driverId && t.status === 'completed' && t.directToDriver);
  return {
    driverId,
    tripEarnings,
    adjustments,
    reserved: balanceOf(d.ledger, { kind: 'driver_withdrawal_reserve', ownerId: driverId }),
    withdrawable: withdrawable(d.ledger, driverId),
    paidOut: paid - returned,
    returnedAfterReversal: returned,
    directCount: direct.length,
    directValue: sum(direct.map((t) => t.agreedFare ?? 0)),
  };
}

/* ------------------------------------------------------------------ Withdrawals */

export type WithdrawalAction = 'start_review' | 'approve_submit' | 'reject' | 'sim_success' | 'sim_failure' | 'sim_reversal';
export interface ActionOption<A extends string> {
  action: A;
  label: string;
  /** Simulated provider event (no real provider is connected). */
  simulated: boolean;
  needsReason: boolean;
  danger?: boolean;
  disabledReason?: string;
}

const WD_TARGET: Record<WithdrawalAction, WithdrawalStatus> = {
  start_review: 'under_review',
  approve_submit: 'processing',
  reject: 'rejected',
  sim_success: 'successful',
  sim_failure: 'failed',
  sim_reversal: 'reversed',
};
const WD_PERMISSION: Record<WithdrawalAction, Permission> = {
  start_review: 'withdrawals.review',
  approve_submit: 'withdrawals.process',
  reject: 'withdrawals.review',
  sim_success: 'withdrawals.process',
  sim_failure: 'withdrawals.process',
  sim_reversal: 'withdrawals.process',
};
const WD_LABEL: Record<WithdrawalAction, string> = {
  start_review: 'Start review',
  approve_submit: 'Approve and submit transfer',
  reject: 'Reject',
  sim_success: 'Simulate transfer success',
  sim_failure: 'Simulate transfer failure',
  sim_reversal: 'Simulate reversal',
};

export const needsReviewNote = (w: Pick<WithdrawalRecord, 'status' | 'amount'>): string | null =>
  w.status === 'requested' && needsApproval('withdrawal', w.amount) ? 'Needs review before transfer' : null;

export const withdrawalApproval =(approvals: readonly ApprovalRequest[], withdrawalId: string) =>
  approvals.find((a) => a.kind === 'withdrawal' && a.target.id === withdrawalId);

/**
 * Actions offered for a withdrawal: allowed by WITHDRAWAL_FLOW and held permission. Actions the role
 * can't take are left out; rule blocks (review threshold, unverified account, own request) come back
 * disabled with the reason.
 */
export function withdrawalActions(
  w: WithdrawalRecord,
  p: { can: (perm: Permission) => boolean; staff?: Pick<StaffMember, 'id' | 'roles' | 'status'> | null; bankVerified?: boolean; approval?: ApprovalRequest },
): ActionOption<WithdrawalAction>[] {
  const out: ActionOption<WithdrawalAction>[] = [];
  for (const action of Object.keys(WD_TARGET) as WithdrawalAction[]) {
    if (!canTransition(WITHDRAWAL_FLOW, w.status, WD_TARGET[action]) || !p.can(WD_PERMISSION[action])) continue;
    const opt: ActionOption<WithdrawalAction> = { action, label: WD_LABEL[action], simulated: action.startsWith('sim_'), needsReason: action === 'reject' || action === 'sim_failure' || action === 'sim_reversal', danger: action === 'reject' || action === 'sim_failure' || action === 'sim_reversal' };
    if (action === 'approve_submit') {
      if (w.status === 'requested' && needsApproval('withdrawal', w.amount)) opt.disabledReason = `${nf(APPROVAL_RULES.withdrawal.thresholdKobo ?? 0)} or more: start review first`;
      else if (p.bankVerified === false) opt.disabledReason = 'Bank account not verified';
      else if (p.approval && p.staff && p.approval.status === 'pending' && !canDecide(p.approval, p.staff)) opt.disabledReason = 'You can’t decide this approval';
    }
    out.push(opt);
  }
  return out;
}

export function applyWithdrawalAction(draft: PlatformDataset, id: string, action: WithdrawalAction, p: Ctx & { reason?: string; staff?: Pick<StaffMember, 'id' | 'roles' | 'status'> }): Result {
  const w = draft.withdrawals.find((x) => x.id === id);
  if (!w) return { ok: false, error: 'Withdrawal not found' };
  const to = WD_TARGET[action];
  if (!canTransition(WITHDRAWAL_FLOW, w.status, to)) return { ok: false, error: `Can’t move a ${w.status.replace('_', ' ')} withdrawal to ${to.replace('_', ' ')}` };
  const reason = p.reason?.trim();
  const providerActor: Actor = { kind: 'provider', name: `${w.provider ?? PROVIDER} (simulated)` };
  const approval = withdrawalApproval(draft.approvals, w.id);
  const decide = (status: 'approved' | 'rejected') => {
    if (approval && approval.status === 'pending') {
      approval.status = status;
      approval.decidedBy = p.actor;
      approval.decidedAt = p.now;
    }
  };
  const release = (why: string, by: Actor) => {
    const r = releaseWithdrawal(draft.ledger, { driverId: w.driverId, withdrawalId: w.id, amount: w.amount, now: p.now, by, reason: why });
    if (!r.ok) return r.error;
    draft.ledger = r.entries;
    return null;
  };

  switch (action) {
    case 'start_review':
      w.reviewNote = reason || w.reviewNote;
      w.history.push({ at: p.now, status: to, by: p.actor, note: reason || 'Review started' });
      break;
    case 'approve_submit': {
      if (w.status === 'requested' && needsApproval('withdrawal', w.amount)) return { ok: false, error: 'At or above the review threshold: start review first' };
      const driver = draft.drivers.find((x) => x.id === w.driverId);
      if (driver?.bankAccount && !driver.bankAccount.verified) return { ok: false, error: 'Bank account not verified' };
      if (approval && approval.status === 'pending' && p.staff && !canDecide(approval, p.staff)) return { ok: false, error: 'You can’t decide this approval' };
      w.provider = w.provider ?? PROVIDER;
      w.transferReference = w.transferReference ?? `TRF_${w.id.toUpperCase()}`;
      w.history.push({ at: p.now, status: to, by: p.actor, note: 'Transfer submitted (simulated). Waiting for the final result.' });
      decide('approved');
      break;
    }
    case 'reject': {
      if (!reason) return { ok: false, error: 'Add a reason' };
      const err = release(reason, p.actor);
      if (err) return { ok: false, error: err };
      w.history.push({ at: p.now, status: to, by: p.actor, note: reason });
      decide('rejected');
      break;
    }
    case 'sim_success': {
      const r = settleWithdrawal(draft.ledger, { driverId: w.driverId, withdrawalId: w.id, amount: w.amount, provider: w.provider ?? PROVIDER, reference: w.transferReference ?? `TRF_${w.id.toUpperCase()}`, now: p.now });
      if (!r.ok) return { ok: false, error: r.error };
      draft.ledger = r.entries;
      w.history.push({ at: p.now, status: to, by: providerActor, note: 'transfer.success (simulated)' });
      break;
    }
    case 'sim_failure': {
      const err = release(`transfer.failed (simulated)${reason ? `: ${reason}` : ''}`, providerActor);
      if (err) return { ok: false, error: err };
      w.history.push({ at: p.now, status: to, by: providerActor, note: `transfer.failed (simulated)${reason ? `: ${reason}` : ''}` });
      break;
    }
    case 'sim_reversal': {
      const ref = `${w.transferReference ?? `TRF_${w.id.toUpperCase()}`}-rev`;
      const r = postJournal(draft.ledger, {
        lines: [{ account: { kind: 'driver_earnings', ownerId: w.driverId }, amount: w.amount }, { account: { kind: 'provider_clearing', provider: w.provider ?? PROVIDER }, amount: -w.amount as Kobo }],
        kind: 'reversal',
        description: 'Payout reversed by bank: earnings returned',
        by: providerActor,
        now: p.now,
        reference: ref,
        reason: `transfer.reversed (simulated)${reason ? `: ${reason}` : ''}`,
        links: { withdrawalId: w.id },
      });
      if (!r.ok) return { ok: false, error: r.error };
      draft.ledger = r.entries;
      w.history.push({ at: p.now, status: to, by: providerActor, note: `transfer.reversed (simulated)${reason ? `: ${reason}` : ''}` });
      break;
    }
  }
  w.status = to;
  return { ok: true };
}

/* ------------------------------------------------------------------ Refunds */

export type RefundAction = 'approve' | 'reject' | 'process' | 'sim_success' | 'sim_failure';
export const refundApproval = (approvals: readonly ApprovalRequest[], refundId: string) => approvals.find((a) => a.kind === 'refund' && a.target.id === refundId);

/**
 * Goodwill refunds are an expense: GoBye keeps no commission on trips (D-024), so the money comes from
 * company funds and is booked to promotions and goodwill. It never reduces driver earnings or package revenue.
 */
export const REFUND_EXPENSE_ACCOUNT: LedgerAccount = { kind: 'promotions_expense' };

function mayDecideRefund(r: RefundRecord, approval: ApprovalRequest | undefined, staff: Pick<StaffMember, 'id' | 'roles' | 'status'> | null | undefined): string | null {
  if (!staff) return 'Not signed in';
  if (r.requestedBy.kind === 'staff' && r.requestedBy.id === staff.id) return 'You requested this refund. Someone else must decide it.';
  if (approval && approval.status === 'pending' && !canDecide(approval, staff)) return 'You can’t decide this approval';
  return null;
}

export function refundActions(r: RefundRecord, p: { can: (perm: Permission) => boolean; staff?: Pick<StaffMember, 'id' | 'roles' | 'status'> | null; approval?: ApprovalRequest }): ActionOption<RefundAction>[] {
  if (!p.can('refunds.approve')) return [];
  const out: ActionOption<RefundAction>[] = [];
  if (r.status === 'requested') {
    const why = mayDecideRefund(r, p.approval, p.staff) ?? undefined;
    out.push({ action: 'approve', label: 'Approve', simulated: false, needsReason: false, disabledReason: why });
    out.push({ action: 'reject', label: 'Reject', simulated: false, needsReason: true, danger: true, disabledReason: why });
  }
  if (r.status === 'approved' || r.status === 'failed') out.push({ action: 'process', label: r.status === 'failed' ? 'Process again' : r.destination === 'wallet' ? 'Process: credit wallet' : 'Process: send to provider', simulated: r.destination === 'original_method', needsReason: false });
  if (r.status === 'processing' && r.destination === 'original_method') {
    out.push({ action: 'sim_success', label: 'Simulate refund success', simulated: true, needsReason: false });
    out.push({ action: 'sim_failure', label: 'Simulate refund failure', simulated: true, needsReason: true, danger: true });
  }
  return out;
}

export function applyRefundAction(draft: PlatformDataset, id: string, action: RefundAction, p: Ctx & { reason?: string; staff?: Pick<StaffMember, 'id' | 'roles' | 'status'> | null }): Result {
  const r = draft.refunds.find((x) => x.id === id);
  if (!r) return { ok: false, error: 'Refund not found' };
  const approval = refundApproval(draft.approvals, r.id);
  const reason = p.reason?.trim();
  const move = (to: RefundRecord['status']) => {
    if (!canTransition(REFUND_FLOW, r.status, to)) return `Can’t move a ${r.status} refund to ${to}`;
    r.status = to;
    return null;
  };
  const post = (lines: { account: LedgerAccount; amount: number }[], description: string) => {
    const res = postJournal(draft.ledger, { lines: lines.map((l) => ({ account: l.account, amount: l.amount as Kobo })), kind: 'refund', description, by: p.actor, now: p.now, reference: `refund:${r.id}`, links: { refundId: r.id, tripId: r.tripId, caseId: r.caseId } });
    if (!res.ok) return res.error;
    draft.ledger = res.entries;
    return null;
  };
  switch (action) {
    case 'approve':
    case 'reject': {
      const why = mayDecideRefund(r, approval, p.staff);
      if (why) return { ok: false, error: why };
      if (action === 'reject' && !reason) return { ok: false, error: 'Add a reason' };
      const err = move(action === 'approve' ? 'approved' : 'rejected');
      if (err) return { ok: false, error: err };
      if (action === 'approve') r.approvedBy = p.actor;
      if (approval && approval.status === 'pending') {
        approval.status = action === 'approve' ? 'approved' : 'rejected';
        approval.decidedBy = p.actor;
        approval.decidedAt = p.now;
        if (reason) approval.note = reason;
      }
      return { ok: true };
    }
    case 'process': {
      const err = move('processing');
      if (err) return { ok: false, error: err };
      if (r.destination === 'wallet') {
        // Posted once: the journal reference `refund:<id>` makes a repeat a no-op.
        const e = post([{ account: { kind: 'passenger_wallet', ownerId: r.passengerId }, amount: r.amount }, { account: REFUND_EXPENSE_ACCOUNT, amount: -r.amount }], 'Refund to wallet');
        if (e) return { ok: false, error: e };
        r.status = 'completed';
        r.providerResult = 'Credited to wallet';
      } else {
        r.providerResult = `Submitted to ${PROVIDER} (simulated). Waiting for the result.`;
      }
      return { ok: true };
    }
    case 'sim_success': {
      if (r.destination !== 'original_method') return { ok: false, error: 'Only refunds to the original method wait for the provider' };
      const err = move('completed');
      if (err) return { ok: false, error: err };
      const e = post([{ account: { kind: 'provider_clearing', provider: PROVIDER }, amount: r.amount }, { account: REFUND_EXPENSE_ACCOUNT, amount: -r.amount }], 'Refund to original payment method');
      if (e) return { ok: false, error: e };
      r.providerResult = 'refund.processed (simulated)';
      return { ok: true };
    }
    case 'sim_failure': {
      const err = move('failed');
      if (err) return { ok: false, error: err };
      r.providerResult = `refund.failed (simulated)${reason ? `: ${reason}` : ''}`;
      return { ok: true };
    }
  }
}

/* ------------------------------------------------------------------ Settlements and reconciliation */

export interface ReconRow {
  settlement: SettlementRecord;
  expectedSettled: number;
  /** Provider collected minus our ledger. */
  providerVsLedger: number;
  /** Bank settled minus (collected − fees). 0 while pending. */
  providerVsBank: number;
  state: 'matched' | 'difference' | 'pending';
  explanations: string[];
  investigated?: { note: string; by: string; at: number };
}

export const reconTargetId = (s: SettlementRecord) => `recon:${s.id}`;

export function reconcile(settlements: readonly SettlementRecord[], audit: readonly AuditEvent[] = []): ReconRow[] {
  return settlements.map((s) => {
    const expectedSettled = s.collected - s.fees;
    const providerVsLedger = s.collected - s.ledgerTotal;
    const pending = !s.settledAt;
    const providerVsBank = pending ? 0 : s.settled - expectedSettled;
    const explanations: string[] = [];
    if (providerVsLedger > 0) explanations.push(`Provider collected ${nf(providerVsLedger)} more than our ledger. A successful payment may be missing its journal.`);
    if (providerVsLedger < 0) explanations.push(`Our ledger has ${nf(providerVsLedger)} more than the provider collected. Check for entries posted without a confirmed payment.`);
    if (providerVsBank !== 0) explanations.push(`Bank settlement differs from collected minus fees by ${nf(providerVsBank)}. Check for a deduction or chargeback.`);
    if (pending) explanations.push('Not settled to the bank yet. Bank figures will be compared once the settlement arrives.');
    const inv = audit.find((a) => a.action === 'reconciliation.investigated' && a.target.id === reconTargetId(s));
    return {
      settlement: s,
      expectedSettled,
      providerVsLedger,
      providerVsBank,
      state: providerVsLedger !== 0 || providerVsBank !== 0 ? 'difference' : pending ? 'pending' : 'matched',
      explanations,
      investigated: inv ? { note: inv.reason ?? inv.summary, by: inv.actor.kind === 'staff' ? inv.actor.name : inv.actor.name, at: inv.at } : undefined,
    };
  });
}

const COLLECTION_KINDS: LedgerEntryKind[] = ['wallet_funding', 'package_purchase', 'driver_trip_earning', 'withdrawal_payout'];

export function unmatchedItems(d: Pick<PlatformDataset, 'collections' | 'ledger'>) {
  const refs = new Set(d.ledger.map((e) => e.reference).filter(Boolean));
  const collectionRefs = new Set(d.collections.map((c) => c.reference));
  const collectionsWithoutJournal = d.collections.filter((c) => c.status === 'successful' && !refs.has(c.reference));
  const duplicateEvents = d.collections.flatMap((c) => c.events.filter((e) => e.duplicate).map((e) => ({ collection: c, event: e })));
  const entriesWithoutReference = d.ledger.filter((e) => {
    if (!COLLECTION_KINDS.includes(e.kind) || e.account.kind === 'provider_clearing') return false;
    if (!e.reference || !e.provider) return true;
    // Collection journals must match a provider collection record; payouts match a transfer reference.
    return e.kind !== 'withdrawal_payout' && !collectionRefs.has(e.reference);
  });
  return { collectionsWithoutJournal, duplicateEvents, entriesWithoutReference };
}

/* ------------------------------------------------------------------ Ledger */

export interface Journal {
  id: string;
  at: number;
  kind: LedgerEntryKind;
  description: string;
  reference?: string;
  provider?: string;
  reason?: string;
  reverses?: string;
  createdBy: Actor;
  lines: LedgerEntry[];
  total: number;
  /** Journal id of the reversal that undid this journal, if any. */
  reversedBy?: string;
}

export function journals(ledger: readonly LedgerEntry[]): Journal[] {
  const m = new Map<string, Journal>();
  for (const e of ledger) {
    const j = m.get(e.journalId);
    if (j) {
      j.lines.push(e);
      j.total += e.amount;
    } else {
      m.set(e.journalId, { id: e.journalId, at: e.at, kind: e.kind, description: e.description, reference: e.reference, provider: e.provider, reason: e.reason, reverses: e.reverses, createdBy: e.createdBy, lines: [e], total: e.amount });
    }
  }
  const lineToJournal = new Map(ledger.map((e) => [e.id, e.journalId]));
  for (const j of m.values()) {
    if (j.reverses) {
      const target = m.get(lineToJournal.get(j.reverses) ?? '');
      if (target) target.reversedBy = j.id;
    }
  }
  return [...m.values()].sort((a, b) => b.at - a.at);
}

export const ACCOUNT_LABEL: Record<LedgerAccount['kind'], string> = {
  passenger_wallet: 'Passenger wallet',
  driver_earnings: 'Driver earnings',
  driver_withdrawal_reserve: 'Withdrawal reserve',
  company_revenue: 'Company revenue',
  provider_clearing: 'Provider clearing',
  promotions_expense: 'Promotions and goodwill',
  processing_costs: 'Processing costs',
  fee_income: 'GoBye fee income',
  suspense: 'Unexplained differences',
};

export const KIND_LABEL: Record<LedgerEntryKind, string> = {
  wallet_funding: 'Wallet funding',
  trip_charge: 'Trip paid from wallet',
  driver_trip_earning: 'Trip paid by transfer',
  package_purchase: 'Package purchase',
  refund: 'Refund',
  withdrawal_reserve: 'Withdrawal reserved',
  withdrawal_release: 'Withdrawal released',
  withdrawal_payout: 'Withdrawal paid out',
  referral_reward: 'Referral reward',
  processing_fee: 'Processing fee',
  adjustment: 'Adjustment',
  reversal: 'Reversal',
};

export function journalMatches(j: Journal, q: { text?: string; kind?: LedgerEntryKind | 'all'; account?: LedgerAccount['kind'] | 'all' }): boolean {
  if (q.kind && q.kind !== 'all' && j.kind !== q.kind) return false;
  if (q.account && q.account !== 'all' && !j.lines.some((l) => l.account.kind === q.account)) return false;
  const t = q.text?.trim().toLowerCase();
  if (!t) return true;
  return [j.id, j.description, j.reference ?? '', j.reason ?? '', KIND_LABEL[j.kind], ...j.lines.map((l) => accountKey(l.account))].some((s) => s.toLowerCase().includes(t));
}

export function canReverseJournal(j: Journal, approvals: readonly ApprovalRequest[]): string | null {
  if (j.kind === 'reversal') return 'A reversal can’t be reversed again. Request an adjustment instead.';
  if (j.reversedBy) return 'Already reversed';
  if (approvals.some((a) => a.kind === 'ledger_adjustment' && a.status === 'pending' && a.target.id === j.id)) return 'A reversal is already waiting for approval';
  if (j.total !== 0) return 'Journal does not balance';
  return null;
}

/**
 * Account balances across the ledger, presented with the sign a reader expects: costs and spend
 * as positive amounts. (Promotions are posted as negative entries, processing costs as positive.)
 */
export function accountBalances(ledger: readonly LedgerEntry[]) {
  const by = (k: LedgerAccount['kind']) => sum(ledger.filter((e) => e.account.kind === k).map((e) => e.amount));
  return {
    companyRevenue: by('company_revenue'),
    promotionsSpend: -by('promotions_expense'),
    // Expense accounts carry negative balances (debits); shown as a positive cost.
    processingCosts: -by('processing_costs'),
    passengerWallets: by('passenger_wallet'),
    driverEarnings: by('driver_earnings'),
    withdrawalReserves: by('driver_withdrawal_reserve'),
    providerClearing: by('provider_clearing'),
  };
}

/* ------------------------------------------------------------------ Reports */

export type Include = (city: CityId | undefined, at: number | undefined) => boolean;

export function reportData(d: PlatformDataset, include: Include) {
  const ix = cityIndex(d);
  const inc = (e: LedgerEntry) => include(entryCity(ix, e), e.at);
  // Revenue: driver access packages only. Wallet funding is a liability, trip value belongs to drivers.
  const revenue = new Map<string, { plan: string; count: number; amount: number }>();
  for (const e of d.ledger) {
    if (e.kind !== 'package_purchase' || e.account.kind !== 'company_revenue' || !inc(e)) continue;
    const plan = planForAmount(d, e.amount);
    const row = revenue.get(plan) ?? { plan, count: 0, amount: 0 };
    row.count += 1;
    row.amount += e.amount;
    revenue.set(plan, row);
  }
  const revenueByPlan = [...revenue.values()].sort((a, b) => b.amount - a.amount);

  const costs = {
    processing: -sum(d.ledger.filter((e) => e.account.kind === 'processing_costs' && inc(e)).map((e) => e.amount)),
    referralRewards: -sum(d.ledger.filter((e) => e.account.kind === 'promotions_expense' && e.kind === 'referral_reward' && inc(e)).map((e) => e.amount)),
    goodwillRefunds: -sum(d.ledger.filter((e) => e.account.kind === 'promotions_expense' && e.kind === 'refund' && inc(e)).map((e) => e.amount)),
    otherPromotions: -sum(d.ledger.filter((e) => e.account.kind === 'promotions_expense' && e.kind !== 'refund' && e.kind !== 'referral_reward' && inc(e)).map((e) => e.amount)),
  };

  // Outstanding balances are as of now (no date filter); the city filter applies via the owner.
  const owned = (k: LedgerAccount['kind']) => sum(d.ledger.filter((e) => e.account.kind === k && include(entryCity(ix, e), undefined)).map((e) => e.amount));
  const outstanding = { walletsHeld: owned('passenger_wallet'), earningsOwed: owned('driver_earnings'), reserves: owned('driver_withdrawal_reserve') };

  const walletDeposits = sum(d.ledger.filter((e) => e.kind === 'wallet_funding' && e.account.kind === 'passenger_wallet' && inc(e)).map((e) => e.amount));

  const completed = d.trips.filter((t) => t.status === 'completed' && include(t.city, t.completedAt));
  const trips = {
    count: completed.length,
    value: sum(completed.map((t) => t.agreedFare ?? 0)),
    directCount: completed.filter((t) => t.directToDriver).length,
    directValue: sum(completed.filter((t) => t.directToDriver).map((t) => t.agreedFare ?? 0)),
  };

  const refunds = d.refunds.filter((r) => include(ix.passenger.get(r.passengerId), r.requestedAt));
  const payouts = d.withdrawals.filter((w) => include(ix.driver.get(w.driverId), w.requestedAt));
  const payoutTotals = {
    successful: sum(payouts.filter((w) => w.status === 'successful').map((w) => w.amount)),
    inProgress: sum(payouts.filter((w) => w.status === 'requested' || w.status === 'under_review' || w.status === 'processing').map((w) => w.amount)),
    returned: sum(payouts.filter((w) => w.status === 'failed' || w.status === 'reversed' || w.status === 'rejected').map((w) => w.amount)),
  };
  return {
    revenueByPlan,
    revenueTotal: sum(revenueByPlan.map((r) => r.amount)),
    costs,
    costsTotal: costs.processing + costs.referralRewards + costs.goodwillRefunds + costs.otherPromotions,
    outstanding,
    walletDeposits,
    trips,
    refunds,
    refundsCompleted: sum(refunds.filter((r) => r.status === 'completed').map((r) => r.amount)),
    payouts,
    payoutTotals,
  };
}

/**
 * What an approved correction posts (balanced lines). Wallet corrections are funded by, or returned to,
 * company funds (promotions and goodwill). Reconciliation corrections move the unexplained difference
 * between provider clearing and the suspense account until it is investigated.
 */
export function walletCorrectionLines(passengerId: string, direction: 'credit' | 'debit', amount: number): NonNullable<ApprovalRequest['adjustment']> {
  const signed = (direction === 'credit' ? amount : -amount) as Kobo;
  return {
    description: `Wallet correction (${direction})`,
    lines: [
      { account: { kind: 'passenger_wallet', ownerId: passengerId }, amount: signed },
      { account: { kind: 'promotions_expense' }, amount: -signed as Kobo },
    ],
  };
}
export function reconciliationCorrectionLines(provider: string, direction: 'credit' | 'debit', amount: number): NonNullable<ApprovalRequest['adjustment']> {
  const signed = (direction === 'credit' ? amount : -amount) as Kobo;
  return {
    description: 'Reconciliation difference moved to suspense',
    lines: [
      { account: { kind: 'suspense' }, amount: signed },
      { account: { kind: 'provider_clearing', provider }, amount: -signed as Kobo },
    ],
  };
}
