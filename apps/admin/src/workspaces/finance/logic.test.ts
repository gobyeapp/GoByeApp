import { describe, expect, it } from 'vitest';
import { balanceOf, createPlatformDataset, naira, withdrawable, type Actor, type Kobo, type PlatformDataset, type StaffMember } from '@gobye/core';
import {
  accountBalances,
  applyRefundAction,
  applyWithdrawalAction,
  canReverseJournal,
  collectionTotals,
  earningsSummary,
  journals,
  postCollectionJournal,
  reconcile,
  refundActions,
  reportData,
  requestLedgerAdjustment,
  unmatchedItems,
  validateCorrection,
  verifyCollection,
  walletLiability,
  walletSummaries,
  withdrawalActions,
} from './logic';

const fresh = (): PlatformDataset => structuredClone(createPlatformDataset());
const staffOf = (d: PlatformDataset, id: string): StaffMember => d.staff.find((s) => s.id === id)!;
const actorOf = (s: StaffMember): Actor => ({ kind: 'staff', id: s.id, name: s.name });
const T = Date.UTC(2026, 9, 21, 21, 0);
const all = () => true;

describe('collections', () => {
  it('totals successful, pending and failed amounts separately', () => {
    const d = fresh();
    const t = collectionTotals(d.collections);
    expect(t.pending.count).toBe(2);
    expect(t.pending.amount).toBe(naira(20000));
    expect(t.successful.count).toBe(d.collections.filter((c) => c.status === 'successful').length);
    expect(t.failed.count).toBeGreaterThanOrEqual(0);
  });

  it('verifying a pending wallet funding credits the wallet once', () => {
    const d = fresh();
    const c = d.collections.find((x) => x.status === 'pending')!;
    const before = balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: c.payerId });
    const r = verifyCollection(d, c.id, { now: T, result: 'successful' });
    expect(r.ok).toBe(true);
    expect(c.status).toBe('successful');
    expect(c.verifiedAt).toBe(T);
    expect(balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: c.payerId })).toBe(before + c.amount);
  });

  it('duplicate verification does not double credit', () => {
    const d = fresh();
    const c = d.collections.find((x) => x.status === 'pending')!;
    const before = balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: c.payerId });
    verifyCollection(d, c.id, { now: T, result: 'successful' });
    const lines = d.ledger.length;
    const again = verifyCollection(d, c.id, { now: T + 1000, result: 'successful' });
    expect(again.ok && again.duplicate).toBe(true);
    expect(d.ledger.length).toBe(lines);
    expect(balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: c.payerId })).toBe(before + c.amount);
    expect(c.events.at(-1)?.duplicate).toBe(true);
  });

  it('a failed provider answer credits nothing', () => {
    const d = fresh();
    const c = d.collections.find((x) => x.status === 'pending')!;
    const lines = d.ledger.length;
    expect(verifyCollection(d, c.id, { now: T, result: 'failed' }).ok).toBe(true);
    expect(c.status).toBe('failed');
    expect(d.ledger.length).toBe(lines);
  });
});

describe('wallets', () => {
  it('wallet summaries add up to the ledger balance and the liability', () => {
    const d = fresh();
    const ws = walletSummaries(d.ledger);
    for (const w of ws.values()) {
      expect(w.balance).toBe(balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: w.passengerId }));
      expect(w.deposits - w.charges + w.refunds + w.rewards + w.corrections).toBe(w.balance);
    }
    expect(walletLiability(ws.values())).toBe(accountBalances(d.ledger).passengerWallets);
  });

  it('a correction becomes an approval request and never changes the balance', () => {
    const d = fresh();
    const p = d.passengers[0]!;
    const before = balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: p.id });
    const fin = staffOf(d, 'stf-fin');
    const r = requestLedgerAdjustment(d, { now: T, actor: actorOf(fin), title: 'Credit ₦500 to wallet', target: { type: 'passenger', id: p.id, label: p.name }, amount: naira(500), reason: 'Missed reward' });
    expect(r.ok).toBe(true);
    expect(d.approvals[0]).toMatchObject({ kind: 'ledger_adjustment', status: 'pending', approverRoles: ['owner'] });
    expect(balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: p.id })).toBe(before);
    expect(validateCorrection({ amount: 0, direction: 'credit', reason: 'x' })).not.toBeNull();
    expect(validateCorrection({ amount: 100, direction: 'debit', reason: 'x', balance: 50 })).not.toBeNull();
    expect(validateCorrection({ amount: 100, direction: 'credit', reason: ' ' })).not.toBeNull();
  });
});

describe('driver earnings', () => {
  it('direct to driver trips never appear in withdrawable earnings', () => {
    const d = fresh();
    const direct = d.trips.filter((t) => t.directToDriver && t.status === 'completed');
    expect(direct.length).toBeGreaterThan(0);
    const directIds = new Set(direct.map((t) => t.id));
    expect(d.ledger.some((e) => e.links?.tripId && directIds.has(e.links.tripId))).toBe(false);
    const t = direct[0]!;
    const s = earningsSummary(d, t.driverId!);
    expect(s.directCount).toBeGreaterThan(0);
    expect(s.withdrawable).toBe(withdrawable(d.ledger, t.driverId!));
    // Even a collection pointing at a direct trip is refused rather than credited.
    const fake = { id: 'col-x', purpose: 'trip_payment' as const, payerType: 'passenger' as const, payerId: t.passengerId, amount: t.agreedFare!, fee: 0 as Kobo, provider: 'Paystack (test)', reference: `GB-TRIP-${t.id}`, status: 'pending' as const, createdAt: T, events: [] };
    expect(postCollectionJournal(d, fake, T).ok).toBe(false);
    expect(withdrawable(d.ledger, t.driverId!)).toBe(s.withdrawable);
  });

  it('withdrawable equals trip earnings plus adjustments minus what was reserved or paid', () => {
    const d = fresh();
    for (const dr of d.drivers) {
      const s = earningsSummary(d, dr.id);
      expect(s.withdrawable).toBeGreaterThanOrEqual(0);
      expect(s.reserved).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('withdrawals', () => {
  const can = () => true;

  it('rejecting a withdrawal returns the reserved earnings', () => {
    const d = fresh();
    const w = d.withdrawals.find((x) => x.status === 'requested' || x.status === 'under_review')!;
    const before = withdrawable(d.ledger, w.driverId);
    const reserved = balanceOf(d.ledger, { kind: 'driver_withdrawal_reserve', ownerId: w.driverId });
    const fin = staffOf(d, 'stf-fin');
    const r = applyWithdrawalAction(d, w.id, 'reject', { now: T, actor: actorOf(fin), staff: fin, reason: 'Name mismatch' });
    expect(r.ok).toBe(true);
    expect(w.status).toBe('rejected');
    expect(withdrawable(d.ledger, w.driverId)).toBe(before + w.amount);
    expect(balanceOf(d.ledger, { kind: 'driver_withdrawal_reserve', ownerId: w.driverId })).toBe(reserved - w.amount);
  });

  it('reject needs a reason', () => {
    const d = fresh();
    const w = d.withdrawals.find((x) => x.status === 'requested')!;
    expect(applyWithdrawalAction(d, w.id, 'reject', { now: T, actor: actorOf(staffOf(d, 'stf-fin')) }).ok).toBe(false);
  });

  it('large withdrawals need review before the transfer is submitted', () => {
    const d = fresh();
    const w = { ...d.withdrawals[0]!, status: 'requested' as const, amount: naira(150_000) };
    const opts = withdrawalActions(w, { can });
    expect(opts.find((o) => o.action === 'approve_submit')?.disabledReason).toMatch(/review first/);
    const small = withdrawalActions({ ...w, amount: naira(5_000) }, { can, bankVerified: true });
    expect(small.find((o) => o.action === 'approve_submit')?.disabledReason).toBeUndefined();
  });

  it('only offers actions the workflow and the role allow', () => {
    const d = fresh();
    const w = d.withdrawals.find((x) => x.status === 'processing')!;
    expect(withdrawalActions(w, { can }).map((o) => o.action)).toEqual(['sim_success', 'sim_failure']);
    expect(withdrawalActions(w, { can: () => false })).toEqual([]);
    const done = d.withdrawals.find((x) => x.status === 'successful')!;
    expect(withdrawalActions(done, { can }).map((o) => o.action)).toEqual(['sim_reversal']);
    const failed = d.withdrawals.find((x) => x.status === 'failed');
    if (failed) expect(withdrawalActions(failed, { can })).toEqual([]);
  });

  it('submitted is not paid: only the simulated success settles the reserve', () => {
    const d = fresh();
    const w = d.withdrawals.find((x) => x.status === 'processing')!;
    const reserve = () => balanceOf(d.ledger, { kind: 'driver_withdrawal_reserve', ownerId: w.driverId });
    const before = reserve();
    expect(applyWithdrawalAction(d, w.id, 'sim_success', { now: T, actor: actorOf(staffOf(d, 'stf-fin')) }).ok).toBe(true);
    expect(w.status).toBe('successful');
    expect(reserve()).toBe(before - w.amount);
    // A later reversal returns the money to withdrawable earnings.
    const earn = withdrawable(d.ledger, w.driverId);
    expect(applyWithdrawalAction(d, w.id, 'sim_reversal', { now: T + 1, actor: actorOf(staffOf(d, 'stf-fin')), reason: 'Bank returned it' }).ok).toBe(true);
    expect(withdrawable(d.ledger, w.driverId)).toBe(earn + w.amount);
    expect(w.status).toBe('reversed');
  });

  it('a simulated failure returns the reserve to earnings', () => {
    const d = fresh();
    const w = d.withdrawals.find((x) => x.status === 'processing')!;
    const earn = withdrawable(d.ledger, w.driverId);
    expect(applyWithdrawalAction(d, w.id, 'sim_failure', { now: T, actor: actorOf(staffOf(d, 'stf-fin')), reason: 'Account closed' }).ok).toBe(true);
    expect(withdrawable(d.ledger, w.driverId)).toBe(earn + w.amount);
  });
});

describe('refunds', () => {
  it('nobody approves their own refund request', () => {
    const d = fresh();
    const r = d.refunds.find((x) => x.status === 'requested')!;
    const requester = staffOf(d, (r.requestedBy as { id: string }).id);
    const asRequester = { ...requester, roles: ['finance' as const] };
    const opts = refundActions(r, { can: () => true, staff: asRequester });
    expect(opts.find((o) => o.action === 'approve')?.disabledReason).toBeTruthy();
    expect(applyRefundAction(d, r.id, 'approve', { now: T, actor: actorOf(asRequester), staff: asRequester }).ok).toBe(false);
  });

  it('approving marks the linked approval approved; processing to wallet credits once as a goodwill expense', () => {
    const d = fresh();
    const r = d.refunds.find((x) => x.status === 'requested' && x.destination === 'wallet')!;
    const fin = staffOf(d, 'stf-fin');
    expect(applyRefundAction(d, r.id, 'approve', { now: T, actor: actorOf(fin), staff: fin }).ok).toBe(true);
    expect(d.approvals.find((a) => a.target.id === r.id)?.status).toBe('approved');
    const wallet = () => balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: r.passengerId });
    const promo = () => balanceOf(d.ledger, { kind: 'promotions_expense' });
    const revenue = balanceOf(d.ledger, { kind: 'company_revenue' });
    const w0 = wallet();
    const p0 = promo();
    expect(applyRefundAction(d, r.id, 'process', { now: T, actor: actorOf(fin), staff: fin }).ok).toBe(true);
    expect(r.status).toBe('completed');
    expect(wallet()).toBe(w0 + r.amount);
    expect(promo()).toBe(p0 - r.amount);
    expect(balanceOf(d.ledger, { kind: 'company_revenue' })).toBe(revenue);
    // Processing again is refused and posts nothing.
    const lines = d.ledger.length;
    expect(applyRefundAction(d, r.id, 'process', { now: T, actor: actorOf(fin), staff: fin }).ok).toBe(false);
    expect(d.ledger.length).toBe(lines);
  });

  it('original method refunds wait for the simulated provider result', () => {
    const d = fresh();
    const r = d.refunds.find((x) => x.status === 'processing' && x.destination === 'original_method')!;
    const fin = staffOf(d, 'stf-fin');
    expect(refundActions(r, { can: () => true, staff: fin }).map((o) => o.action)).toEqual(['sim_success', 'sim_failure']);
    expect(applyRefundAction(d, r.id, 'sim_failure', { now: T, actor: actorOf(fin), reason: 'Card closed' }).ok).toBe(true);
    expect(r.status).toBe('failed');
    expect(applyRefundAction(d, r.id, 'process', { now: T, actor: actorOf(fin) }).ok).toBe(true);
    expect(applyRefundAction(d, r.id, 'sim_success', { now: T, actor: actorOf(fin) }).ok).toBe(true);
    expect(r.status).toBe('completed');
    expect(d.ledger.filter((e) => e.reference === `refund:${r.id}`)).toHaveLength(2);
  });
});

describe('reconciliation and ledger', () => {
  it('finds the seeded settlement difference and pending settlement', () => {
    const d = fresh();
    const rows = reconcile(d.settlements);
    expect(rows.find((r) => r.settlement.id === 'stl-1')?.providerVsLedger).toBe(naira(1500));
    expect(rows.find((r) => r.settlement.id === 'stl-0')?.state).toBe('pending');
    expect(rows.find((r) => r.settlement.id === 'stl-1')?.state).toBe('difference');
  });

  it('marks an investigated difference from the audit trail', () => {
    const d = fresh();
    const rows = reconcile(d.settlements, [{ id: 'a', at: T, actor: { kind: 'staff', id: 'stf-fin', name: 'Grace Finance' }, action: 'reconciliation.investigated', target: { type: 'ledger_entry', id: 'recon:stl-1', label: 'x' }, summary: 's', reason: 'Fee refund' }]);
    expect(rows.find((r) => r.settlement.id === 'stl-1')?.investigated?.note).toBe('Fee refund');
  });

  it('lists unmatched items: duplicates and collections without journals', () => {
    const d = fresh();
    const u = unmatchedItems(d);
    expect(u.duplicateEvents.length).toBeGreaterThan(0);
    expect(u.collectionsWithoutJournal).toHaveLength(0);
    const c = d.collections.find((x) => x.status === 'successful' && x.purpose === 'wallet_funding')!;
    d.ledger = d.ledger.filter((e) => e.reference !== c.reference);
    expect(unmatchedItems(d).collectionsWithoutJournal.map((x) => x.id)).toContain(c.id);
  });

  it('every journal balances to zero and a reversal links back', () => {
    const d = fresh();
    const js = journals(d.ledger);
    expect(js.every((j) => j.total === 0)).toBe(true);
    const j = js.find((x) => x.kind === 'wallet_funding')!;
    expect(canReverseJournal(j, d.approvals)).toBeNull();
    expect(canReverseJournal(js.find((x) => x.kind === 'reversal')!, d.approvals)).toMatch(/can’t be reversed/);
  });

  it('reports keep revenue, wallet deposits, trip value and payouts apart', () => {
    const d = fresh();
    const r = reportData(d, all);
    const bal = accountBalances(d.ledger);
    expect(r.revenueTotal).toBe(bal.companyRevenue);
    expect(r.outstanding.walletsHeld).toBe(bal.passengerWallets);
    expect(r.outstanding.earningsOwed).toBe(bal.driverEarnings);
    expect(r.walletDeposits).toBeGreaterThan(0);
    expect(r.revenueByPlan.every((p) => p.plan !== 'Other')).toBe(true);
    expect(r.trips.directValue).toBeLessThan(r.trips.value);
  });
});
