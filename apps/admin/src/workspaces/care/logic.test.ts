import { describe, expect, it } from 'vitest';
import { createPlatformDataset, type Actor, type CaseRecord, type Kobo } from '@gobye/core';
import {
  allowedCaseActions,
  applyAssign,
  applyEscalate,
  applyLostItemStep,
  applyMessage,
  applyNewCase,
  applyRefundRequest,
  applyReopen,
  applyResolve,
  applyStatus,
  formatAge,
  inTab,
  lostItemDone,
  nextRef,
  overResponseTarget,
  parseNairaInput,
  refundBlockReason,
  refundableKobo,
  searchPeople,
  sortQueue,
  validateNewCase,
  validateRefund,
} from './logic';

const MIN = 60_000;
const care: Actor = { kind: 'staff', id: 'stf-care', name: 'Ruth Care' };
const fresh = () => {
  const d = createPlatformDataset();
  return { d, now: d.generatedAt };
};

describe('queue', () => {
  it('sorts by priority, then oldest first', () => {
    const rows = [
      { id: 'a', priority: 'normal', openedAt: 100 },
      { id: 'b', priority: 'urgent', openedAt: 300 },
      { id: 'c', priority: 'normal', openedAt: 50 },
      { id: 'd', priority: 'high', openedAt: 10 },
      { id: 'e', priority: 'urgent', openedAt: 200 },
    ] as const;
    expect(sortQueue(rows).map((r) => r.id)).toEqual(['e', 'b', 'd', 'c', 'a']);
  });

  it('puts cases in the right tabs', () => {
    const mine = { status: 'in_progress', ownerId: 'me' } as const;
    const fresh = { status: 'new', ownerId: undefined } as const;
    const done = { status: 'resolved', ownerId: 'me' } as const;
    expect(inTab(mine, 'mine', 'me')).toBe(true);
    expect(inTab(done, 'mine', 'me')).toBe(false);
    expect(inTab(fresh, 'unassigned', 'me')).toBe(true);
    expect(inTab(mine, 'unassigned', 'me')).toBe(false);
    expect(inTab(fresh, 'open', 'me') && inTab(mine, 'open', 'me')).toBe(true);
    expect(inTab(done, 'done', 'me')).toBe(true);
    expect(inTab({ status: 'closed' }, 'done', undefined)).toBe(true);
  });

  it('formats elapsed age without dashes', () => {
    expect(formatAge(20_000)).toBe('under 1 min');
    expect(formatAge(6 * MIN)).toBe('6 min');
    expect(formatAge(3 * 60 * MIN)).toBe('3 h');
    expect(formatAge(49 * 60 * MIN)).toBe('2 days');
    expect(formatAge(-5)).toBe('under 1 min');
  });

  it('flags only unassigned new cases past the response target', () => {
    const base = { status: 'new', priority: 'urgent', openedAt: 0 } as const;
    expect(overResponseTarget({ ...base, ownerId: undefined }, 16 * MIN)).toBe(true);
    expect(overResponseTarget({ ...base, ownerId: undefined }, 14 * MIN)).toBe(false);
    expect(overResponseTarget({ ...base, ownerId: 'x' }, 600 * MIN)).toBe(false);
  });
});

describe('allowed actions per status', () => {
  const opts = { canWork: true, canAssign: true, meId: 'me' };
  it('new case: assign, escalate, resolve; not close or reopen', () => {
    const a = allowedCaseActions({ status: 'new', ownerId: undefined }, opts);
    expect(a).toEqual(expect.arrayContaining(['assign_me', 'assign', 'escalate', 'resolve', 'reply']));
    expect(a).not.toContain('close');
    expect(a).not.toContain('reopen');
    expect(a).not.toContain('waiting');
  });
  it('resolved case: reopen or close only', () => {
    expect(allowedCaseActions({ status: 'resolved', ownerId: 'me' }, opts).sort()).toEqual(['close', 'reopen']);
  });
  it('closed case: nothing', () => {
    expect(allowedCaseActions({ status: 'closed', ownerId: 'me' }, opts)).toEqual([]);
  });
  it('waiting case can go back to in progress', () => {
    expect(allowedCaseActions({ status: 'waiting', ownerId: 'me' }, opts)).toContain('in_progress');
  });
  it('read only roles get no actions', () => {
    expect(allowedCaseActions({ status: 'new' }, { canWork: false, canAssign: false })).toEqual([]);
  });
});

describe('refunds', () => {
  it('parses naira input to integer kobo', () => {
    expect(parseNairaInput('1500')).toBe(150_000);
    expect(parseNairaInput('₦1,500.5')).toBe(150_050);
    expect(parseNairaInput('0.01')).toBe(1);
    expect(parseNairaInput('12.345')).toBeNull();
    expect(parseNairaInput('-5')).toBeNull();
    expect(parseNairaInput('abc')).toBeNull();
    expect(parseNairaInput('')).toBeNull();
  });

  const trip = { id: 't1', agreedFare: 300_000 as Kobo };
  it('caps at the agreed fare less earlier refunds that still hold money', () => {
    const refunds = [
      { tripId: 't1', amount: 100_000 as Kobo, status: 'completed' as const },
      { tripId: 't1', amount: 50_000 as Kobo, status: 'rejected' as const },
      { tripId: 't2', amount: 999_000 as Kobo, status: 'requested' as const },
    ];
    expect(refundableKobo(trip, refunds)).toBe(200_000);
    expect(validateRefund({ amountText: '2000', reason: 'Double charge' }, trip, refunds)).toEqual({ ok: true, amount: 200_000 });
    const over = validateRefund({ amountText: '2000.01', reason: 'x' }, trip, refunds);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.field).toBe('amount');
  });

  it('needs an amount above zero and a reason', () => {
    expect(validateRefund({ amountText: '0', reason: 'x' }, trip, []).ok).toBe(false);
    const r = validateRefund({ amountText: '100', reason: '  ' }, trip, []);
    expect(!r.ok && r.field).toBe('reason');
  });

  it('explains why a refund is blocked', () => {
    const c = { id: 'c1', category: 'payment' as const, status: 'in_progress' as const };
    const paid = { ...trip, payment: 'paid' as const };
    expect(refundBlockReason(c, paid, [], false)).toMatch(/role/);
    expect(refundBlockReason({ ...c, category: 'lost_item' }, paid, [], true)).toMatch(/payment or fare/);
    expect(refundBlockReason(c, undefined, [], true)).toMatch(/Link a trip/);
    expect(refundBlockReason(c, { ...paid, payment: 'pending' }, [], true)).toMatch(/no confirmed payment/);
    expect(refundBlockReason(c, paid, [{ caseId: 'c1', tripId: 't1', amount: 1 as Kobo, status: 'requested' }], true)).toMatch(/already waiting/);
    expect(refundBlockReason(c, paid, [{ tripId: 't1', amount: 300_000 as Kobo, status: 'completed' }], true)).toMatch(/fully refunded/);
    expect(refundBlockReason(c, paid, [], true)).toBeUndefined();
  });

  it('a request creates a requested refund and a finance approval, and moves no money', () => {
    const { d, now } = fresh();
    const c = d.cases.find((x) => x.category === 'payment' && x.status === 'new')!;
    d.refunds = d.refunds.filter((r) => r.caseId !== c.id && r.tripId !== c.links.tripId);
    const trip = d.trips.find((t) => t.id === c.links.tripId)!;
    trip.payment = 'paid';
    trip.agreedFare = 500_000 as Kobo;
    const ledgerBefore = d.ledger.length;
    const r = applyRefundRequest(d, c.id, { amountText: '1500', reason: 'Charged twice', destination: 'wallet' }, care, now);
    expect(r.ok).toBe(true);
    const refund = d.refunds.find((x) => x.id === r.refundId)!;
    expect(refund).toMatchObject({ status: 'requested', amount: 150_000, caseId: c.id, tripId: trip.id, destination: 'wallet' });
    const apr = d.approvals.find((a) => a.target.id === refund.id)!;
    expect(apr).toMatchObject({ kind: 'refund', status: 'pending', amount: 150_000, approverRoles: ['finance', 'owner'] });
    expect(d.ledger.length).toBe(ledgerBefore);
    expect(c.links.refundId).toBe(refund.id);
    // A second request while the first waits is refused.
    expect(applyRefundRequest(d, c.id, { amountText: '100', reason: 'x', destination: 'wallet' }, care, now).ok).toBe(false);
  });

  it('refuses a refund above the agreed fare', () => {
    const { d, now } = fresh();
    const c = d.cases.find((x) => x.category === 'fare' && x.status === 'in_progress') ?? d.cases.find((x) => x.category === 'fare')!;
    c.status = 'in_progress';
    const trip = d.trips.find((t) => t.id === c.links.tripId)!;
    trip.payment = 'paid';
    trip.agreedFare = 100_000 as Kobo;
    const r = applyRefundRequest(d, c.id, { amountText: '1000.01', reason: 'x', destination: 'original_method' }, care, now);
    expect(r.ok).toBe(false);
  });
});

describe('case changes', () => {
  const pick = (d: ReturnType<typeof createPlatformDataset>, f: (c: CaseRecord) => boolean) => d.cases.find((c) => c.team === 'care' && f(c))!;

  it('assigning a new case moves it to in progress', () => {
    const { d, now } = fresh();
    const c = pick(d, (x) => x.status === 'new');
    expect(applyAssign(d, c.id, 'stf-care', care, now).ok).toBe(true);
    expect(c.ownerId).toBe('stf-care');
    expect(c.status).toBe('in_progress');
    expect(c.actions.at(-1)?.label).toBe('Assigned to Ruth Care');
    expect(applyAssign(d, c.id, 'stf-new', care, now).ok).toBe(false); // invited, not active
  });

  it('keeps customer replies and internal notes in separate channels', () => {
    const { d, now } = fresh();
    const c = pick(d, (x) => x.status === 'in_progress');
    const n = c.messages.length;
    applyMessage(d, c.id, 'internal', 'Checked provider log', care, now);
    applyMessage(d, c.id, 'customer', 'We are on it', care, now);
    expect(c.messages.slice(n).map((m) => m.channel)).toEqual(['internal', 'customer']);
    expect(c.actions.slice(-2).map((a) => a.label)).toEqual(['Added internal note', 'Replied to customer']);
    expect(applyMessage(d, c.id, 'customer', '   ', care, now).ok).toBe(false);
  });

  it('follows CASE_FLOW for status changes', () => {
    const { d, now } = fresh();
    const c = pick(d, (x) => x.status === 'new');
    expect(applyStatus(d, c.id, 'waiting', care, now).ok).toBe(false);
    expect(applyStatus(d, c.id, 'closed', care, now).ok).toBe(false);
    expect(applyStatus(d, c.id, 'in_progress', care, now).ok).toBe(true);
    expect(applyStatus(d, c.id, 'waiting', care, now).ok).toBe(true);
  });

  it('escalating to Safety opens a linked urgent safety case', () => {
    const { d, now } = fresh();
    const c = pick(d, (x) => x.status === 'in_progress');
    const before = d.cases.filter((x) => x.team === 'safety').length;
    expect(applyEscalate(d, c.id, 'safety', '', care, now).ok).toBe(false);
    const r = applyEscalate(d, c.id, 'safety', 'Passenger reports threats', care, now);
    expect(r.ok).toBe(true);
    expect(c.status).toBe('escalated');
    const s = d.cases.find((x) => x.ref === r.safetyRef)!;
    expect(d.cases.filter((x) => x.team === 'safety').length).toBe(before + 1);
    expect(s).toMatchObject({ team: 'safety', priority: 'urgent', status: 'new', links: { tripId: c.links.tripId, passengerId: c.links.passengerId } });
    expect(s.ownerId).toBeUndefined();
    expect(s.actions[0]!.label).toBe(`Created from care case ${c.ref}`);
  });

  it('resolves with a summary and an optional future follow up, then reopens', () => {
    const { d, now } = fresh();
    const c = pick(d, (x) => x.status === 'waiting');
    expect(applyResolve(d, c.id, '', undefined, care, now).ok).toBe(false);
    expect(applyResolve(d, c.id, 'Explained', now - 1, care, now).ok).toBe(false);
    expect(applyResolve(d, c.id, 'Explained the fee', now + 86_400_000, care, now).ok).toBe(true);
    expect(c.resolution).toMatchObject({ summary: 'Explained the fee', followUpAt: now + 86_400_000 });
    expect(applyReopen(d, c.id, 'Customer replied', care, now).ok).toBe(true);
    expect(c.status).toBe('in_progress');
    expect(c.resolution).toBeUndefined();
  });

  it('records lost item steps once each', () => {
    const { d, now } = fresh();
    const c = pick(d, (x) => x.category === 'lost_item' && x.status !== 'resolved' && x.status !== 'closed');
    expect(lostItemDone(c.actions).contact_driver).toBe(false);
    expect(applyLostItemStep(d, c.id, 'contact_driver', care, now).ok).toBe(true);
    expect(applyLostItemStep(d, c.id, 'contact_driver', care, now).ok).toBe(false);
    expect(lostItemDone(c.actions)).toEqual({ contact_driver: true, arrange_return: false, confirm_passenger: false });
  });
});

describe('new case', () => {
  it('validates the form', () => {
    expect(Object.keys(validateNewCase({}))).toEqual(['person', 'subject', 'firstMessage']);
    expect(validateNewCase({ person: { type: 'passenger', id: 'x' }, subject: 'a'.repeat(91), firstMessage: 'y' }).subject).toMatch(/90/);
  });

  it('creates a new unassigned case with the next ref and the trip links', () => {
    const { d, now } = fresh();
    const p = d.passengers[0]!;
    const trip = d.trips.find((t) => t.passengerId === p.id && t.driverId);
    expect(nextRef(d.cases, 'C-')).toBe('C-2410');
    const r = applyNewCase(d, { person: { type: 'passenger', id: p.id }, category: 'payment', priority: 'high', subject: 'Charged twice', firstMessage: 'I paid twice', tripId: trip?.id }, care, now);
    expect(r.ok).toBe(true);
    const c = d.cases.find((x) => x.id === r.caseId)!;
    expect(c).toMatchObject({ ref: 'C-2410', status: 'new', team: 'care', openedBy: care });
    expect(c.ownerId).toBeUndefined();
    expect(c.links.passengerId).toBe(p.id);
    if (trip) expect(c.links).toMatchObject({ tripId: trip.id, driverId: trip.driverId });
    expect(c.messages[0]).toMatchObject({ channel: 'customer', author: { kind: 'passenger', id: p.id } });
  });

  it('searches passengers and drivers by name', () => {
    const { d } = fresh();
    const name = d.drivers[0]!.name.split(' ')[0]!;
    expect(searchPeople(d.passengers, d.drivers, 'a')).toEqual([]);
    const res = searchPeople(d.passengers, d.drivers, name.toLowerCase(), 100);
    expect(res.some((r) => r.type === 'driver' && r.rec.id === d.drivers[0]!.id)).toBe(true);
  });
});
