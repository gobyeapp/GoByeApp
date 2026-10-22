import {
  ANNOUNCEMENT_FLOW,
  CONNECTION_FLOW,
  WITHDRAWAL_FLOW,
  balanceOf,
  can,
  canDecide,
  canGoLive,
  canTransition,
  chargeTripFromWallet,
  creditWalletFunding,
  isReadOnly,
  needsApproval,
  postJournal,
  releaseWithdrawal,
  reserveWithdrawal,
  reverseJournal,
  settleWithdrawal,
  versionInForce,
  withdrawable,
  type ConfigVersion,
  type LedgerEntry,
} from '../index';
import { naira } from '../money';
import type { Kobo } from '../types';

const staff = { kind: 'staff' as const, id: 's-1', name: 'Ada' };

describe('permissions', () => {
  it('a staff member with several roles gets the union of their permissions, not more', () => {
    const m = { roles: ['care', 'onboarding'] as const, status: 'active' as const };
    expect(can({ ...m, roles: [...m.roles] }, 'cases.work')).toBe(true);
    expect(can({ ...m, roles: [...m.roles] }, 'drivers.verify')).toBe(true);
    expect(can({ ...m, roles: [...m.roles] }, 'refunds.approve')).toBe(false);
  });
  it('care can request a refund but not approve one', () => {
    expect(can({ roles: ['care'], status: 'active' }, 'refunds.request')).toBe(true);
    expect(can({ roles: ['care'], status: 'active' }, 'refunds.approve')).toBe(false);
  });
  it('the auditor role is read only and cannot see safety locations or contact details', () => {
    expect(isReadOnly(['auditor'])).toBe(true);
    expect(can({ roles: ['auditor'], status: 'active' }, 'safety.location')).toBe(false);
    expect(can({ roles: ['auditor'], status: 'active' }, 'passengers.contact_details')).toBe(false);
  });
  it('suspended or invited staff have no access', () => {
    expect(can({ roles: ['owner'], status: 'suspended' }, 'overview.view')).toBe(false);
    expect(can({ roles: ['owner'], status: 'invited' }, 'overview.view')).toBe(false);
  });
});

describe('approvals', () => {
  it('nobody approves their own request, even with an approving role', () => {
    const req = { approverRoles: ['finance' as const], requestedBy: staff, status: 'pending' as const };
    expect(canDecide(req, { id: 's-1', roles: ['finance'], status: 'active' })).toBe(false);
    expect(canDecide(req, { id: 's-2', roles: ['finance'], status: 'active' })).toBe(true);
    expect(canDecide(req, { id: 's-3', roles: ['care'], status: 'active' })).toBe(false);
  });
  it('withdrawals below the threshold do not need review', () => {
    expect(needsApproval('withdrawal', naira(20_000))).toBe(false);
    expect(needsApproval('withdrawal', naira(150_000))).toBe(true);
    expect(needsApproval('refund', naira(100))).toBe(true);
  });
});

describe('ledger', () => {
  const funding = (e: LedgerEntry[], ref = 'ps_ref_1') => creditWalletFunding(e, { passengerId: 'p-1', amount: naira(5000), provider: 'paystack', reference: ref, now: 1 });

  it('rejects unbalanced journals and corrections without a reason', () => {
    expect(postJournal([], { lines: [{ account: { kind: 'company_revenue' }, amount: naira(10) }], kind: 'adjustment', description: 'x', by: staff, now: 1, reason: 'r' })).toEqual({ ok: false, error: 'unbalanced' });
    const lines = [
      { account: { kind: 'company_revenue' as const }, amount: naira(10) },
      { account: { kind: 'promotions_expense' as const }, amount: -naira(10) as Kobo },
    ];
    expect(postJournal([], { lines, kind: 'adjustment', description: 'x', by: staff, now: 1 })).toEqual({ ok: false, error: 'reason_required' });
  });

  it('wallet funding credits the wallet once, even when the webhook arrives twice, and is not revenue', () => {
    const a = funding([]);
    if (!a.ok) throw new Error('post failed');
    const b = funding(a.entries);
    if (!b.ok) throw new Error('post failed');
    expect(b.duplicate).toBe(true);
    expect(balanceOf(b.entries, { kind: 'passenger_wallet', ownerId: 'p-1' })).toBe(naira(5000));
    expect(balanceOf(b.entries, { kind: 'company_revenue' })).toBe(0);
  });

  it('a trip charge needs enough wallet funds, is idempotent per trip, and credits the driver the fare', () => {
    const a = funding([]);
    if (!a.ok) throw new Error();
    expect(chargeTripFromWallet(a.entries, { passengerId: 'p-1', driverId: 'd-1', tripId: 't-1', fare: naira(6000), now: 2 })).toEqual({ ok: false, error: 'insufficient_funds' });
    const c = chargeTripFromWallet(a.entries, { passengerId: 'p-1', driverId: 'd-1', tripId: 't-1', fare: naira(4000), now: 2 });
    if (!c.ok) throw new Error();
    const again = chargeTripFromWallet(c.entries, { passengerId: 'p-1', driverId: 'd-1', tripId: 't-1', fare: naira(4000), now: 3 });
    if (!again.ok) throw new Error();
    expect(again.duplicate).toBe(true);
    expect(balanceOf(again.entries, { kind: 'passenger_wallet', ownerId: 'p-1' })).toBe(naira(1000));
    expect(withdrawable(again.entries, 'd-1')).toBe(naira(4000));
  });

  it('a journal can be reversed once, with a reason', () => {
    const a = funding([]);
    if (!a.ok) throw new Error();
    const r = reverseJournal(a.entries, a.posted[0].journalId, { by: staff, now: 5, reason: 'Duplicate charge at provider' });
    if (!r.ok) throw new Error();
    expect(balanceOf(r.entries, { kind: 'passenger_wallet', ownerId: 'p-1' })).toBe(0);
    expect(reverseJournal(r.entries, a.posted[0].journalId, { by: staff, now: 6, reason: 'again' })).toEqual({ ok: false, error: 'already_reversed' });
  });

  it('withdrawals reserve earnings; a failed payout returns them; a paid one leaves', () => {
    const f = funding([]);
    if (!f.ok) throw new Error();
    const c = chargeTripFromWallet(f.entries, { passengerId: 'p-1', driverId: 'd-1', tripId: 't-1', fare: naira(5000), now: 2 });
    if (!c.ok) throw new Error();
    expect(reserveWithdrawal(c.entries, { driverId: 'd-1', withdrawalId: 'w-1', amount: naira(6000), now: 3, by: staff })).toEqual({ ok: false, error: 'insufficient_funds' });
    const r = reserveWithdrawal(c.entries, { driverId: 'd-1', withdrawalId: 'w-1', amount: naira(3000), now: 3, by: staff });
    if (!r.ok) throw new Error();
    expect(withdrawable(r.entries, 'd-1')).toBe(naira(2000));
    // A second request can't spend the reserved part again.
    expect(reserveWithdrawal(r.entries, { driverId: 'd-1', withdrawalId: 'w-2', amount: naira(3000), now: 4, by: staff })).toEqual({ ok: false, error: 'insufficient_funds' });
    const failed = releaseWithdrawal(r.entries, { driverId: 'd-1', withdrawalId: 'w-1', amount: naira(3000), now: 5, by: { kind: 'provider', name: 'paystack' }, reason: 'transfer.failed' });
    if (!failed.ok) throw new Error();
    expect(withdrawable(failed.entries, 'd-1')).toBe(naira(5000));
    const r2 = reserveWithdrawal(failed.entries, { driverId: 'd-1', withdrawalId: 'w-3', amount: naira(5000), now: 6, by: staff });
    if (!r2.ok) throw new Error();
    const paid = settleWithdrawal(r2.entries, { driverId: 'd-1', withdrawalId: 'w-3', amount: naira(5000), provider: 'paystack', reference: 'TRF_1', now: 7 });
    if (!paid.ok) throw new Error();
    expect(withdrawable(paid.entries, 'd-1')).toBe(0);
    expect(balanceOf(paid.entries, { kind: 'driver_withdrawal_reserve', ownerId: 'd-1' })).toBe(0);
  });
});

describe('status transitions', () => {
  it('a submitted payout is not complete: only the provider result moves it to successful or failed', () => {
    expect(canTransition(WITHDRAWAL_FLOW, 'requested', 'successful')).toBe(false);
    expect(canTransition(WITHDRAWAL_FLOW, 'processing', 'successful')).toBe(true);
    expect(canTransition(WITHDRAWAL_FLOW, 'successful', 'reversed')).toBe(true);
    expect(canTransition(WITHDRAWAL_FLOW, 'failed', 'successful')).toBe(false);
  });
  it('an integration goes live only from tested, and only when every check passed', () => {
    expect(canTransition(CONNECTION_FLOW, 'configured', 'live')).toBe(false);
    expect(canTransition(CONNECTION_FLOW, 'tested', 'live')).toBe(true);
    expect(canGoLive([{ passed: true }, { passed: false }])).toBe(false);
    expect(canGoLive([])).toBe(false);
  });
  it('a sent announcement cannot go back to draft', () => {
    expect(canTransition(ANNOUNCEMENT_FLOW, 'sent', 'draft')).toBe(false);
  });
  it('the configuration in force is the latest one whose effective date has passed', () => {
    const v = (version: number, effectiveFrom: number, status: ConfigVersion['status']): ConfigVersion<number> => ({
      id: `v${version}`, key: 'fares', version, value: version, status, effectiveFrom, createdBy: staff, createdAt: 0, note: '',
    });
    const versions = [v(1, 0, 'superseded'), v(2, 100, 'active'), v(3, 200, 'scheduled'), v(4, 50, 'draft')];
    expect(versionInForce(versions, 150)?.version).toBe(2);
    expect(versionInForce(versions, 250)?.version).toBe(3);
    expect(versionInForce(versions, 60)?.version).toBe(1);
  });
});

describe('test dataset', () => {
  it('is internally consistent: balanced ledger, shared ids resolve, no negative wallets', () => {
    const { createPlatformDataset } = jest.requireActual('../index');
    const d = createPlatformDataset();
    const sum = d.ledger.reduce((s: number, e: LedgerEntry) => s + e.amount, 0);
    expect(sum).toBe(0);
    const ids = new Set([...d.passengers.map((p: { id: string }) => p.id), ...d.drivers.map((x: { id: string }) => x.id), ...d.trips.map((t: { id: string }) => t.id)]);
    for (const c of d.cases) for (const v of Object.values(c.links)) if (v && !String(v).startsWith('ref-') && !String(v).startsWith('le')) expect(ids.has(v as string)).toBe(true);
    for (const p of d.passengers) expect(balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: p.id })).toBeGreaterThanOrEqual(0);
    for (const dr of d.drivers) expect(withdrawable(d.ledger, dr.id)).toBeGreaterThanOrEqual(0);
    // Wallet funding is never revenue: revenue comes only from packages.
    expect(d.ledger.filter((e: LedgerEntry) => e.account.kind === 'company_revenue').every((e: LedgerEntry) => e.kind === 'package_purchase')).toBe(true);
    expect(d.trips.length).toBeGreaterThan(100);
    expect(d.integrations.some((i: { state: string }) => i.state === 'live')).toBe(false);
  });
});

describe('approved ledger corrections', () => {
  it('post exactly the approved lines once, by approval id, and reversals reverse the whole journal', () => {
    const { postApprovedAdjustment } = jest.requireActual('../index');
    const f = creditWalletFunding([], { passengerId: 'p-9', amount: naira(1000), provider: 'paystack', reference: 'r9', now: 1 });
    if (!f.ok) throw new Error();
    const req = {
      id: 'apr-x', kind: 'ledger_adjustment', title: 'Credit ₦200', note: 'Goodwill',
      adjustment: { description: 'Wallet correction', lines: [{ account: { kind: 'passenger_wallet', ownerId: 'p-9' }, amount: naira(200) }, { account: { kind: 'promotions_expense' }, amount: -naira(200) }] },
    };
    const a = postApprovedAdjustment(f.entries, req, { by: staff, now: 2 });
    expect(a.ok).toBe(true);
    const again = postApprovedAdjustment(a.entries, req, { by: staff, now: 3 });
    expect(balanceOf(again.entries, { kind: 'passenger_wallet', ownerId: 'p-9' })).toBe(naira(1200));
    const rev = postApprovedAdjustment(again.entries, { id: 'apr-y', kind: 'ledger_adjustment', title: 'Reverse', note: 'Wrong', adjustment: { description: 'Reversal', reverseJournalId: f.posted[0].journalId } }, { by: staff, now: 4 });
    expect(rev.ok).toBe(true);
    expect(balanceOf(rev.entries, { kind: 'passenger_wallet', ownerId: 'p-9' })).toBe(naira(200));
    const missing = postApprovedAdjustment(rev.entries, { id: 'apr-z', kind: 'ledger_adjustment', title: 'x' }, { by: staff, now: 5 });
    expect(missing.ok).toBe(false);
  });
});
