import { describe, expect, it } from 'vitest';
import { createPlatformDataset, emptySubscriptionState, planForAmount as corePlan, recordPassPayment, subscriptionTimelineResponse, type CollectionRecord, type Kobo, type SubscriptionState } from '@gobye/core';
import { applyPassVoid, currentAccess, eligibility, planForAmount, subscriptionRecords, subscriptionRevenue, timelineFor } from './logic';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 21, 20);
const N = (n: number) => (n * 100) as Kobo;
const pay = (over: Partial<CollectionRecord>): CollectionRecord => ({
  id: 'c', purpose: 'package_purchase', payerType: 'driver', payerId: 'drv-1', amount: N(2000), fee: 0 as Kobo, provider: 'Paystack (test)', reference: 'r', status: 'successful', createdAt: NOW - DAY, verifiedAt: NOW - DAY, events: [], ...over,
});

/** Build the driver timelines from verified collections, the way the backend's verification job does. */
function statesFrom(cs: CollectionRecord[]): SubscriptionState[] {
  const m = new Map<string, SubscriptionState>();
  for (const c of cs) {
    const plan = corePlan(c.amount);
    if (c.status !== 'successful' || !c.verifiedAt || !plan) continue;
    const s = m.get(c.payerId) ?? emptySubscriptionState(c.payerId);
    const r = recordPassPayment(s, { paymentRef: c.reference, driverId: c.payerId, plan, amount: c.amount, confirmedAt: c.verifiedAt });
    if (r.ok) m.set(c.payerId, r.state);
  }
  return [...m.values()];
}
const records = (cs: CollectionRecord[], now = NOW) => subscriptionRecords(cs, statesFrom(cs), now);

describe('admin subscriptions read the shared pass timeline', () => {
  it('reads the plan from the confirmed prices and flags anything else', () => {
    expect(planForAmount(N(2000))).toBe('daily');
    expect(planForAmount(N(60000))).toBe('monthly');
    expect(planForAmount(N(2500))).toBeNull();
    expect(records([pay({ amount: N(2500) })])[0]!.status).toBe('needs_review');
  });

  it('daily lasts exactly 24 hours, monthly exactly 30 days', () => {
    const [d] = records([pay({ verifiedAt: NOW - 2 * HOUR })]);
    expect(d!.expiresAt! - d!.startsAt!).toBe(DAY);
    expect(d!.status).toBe('active');
    expect(records([pay({ verifiedAt: NOW - 2 * DAY })])[0]!.status).toBe('expired');
    const [m] = records([pay({ amount: N(60000), verifiedAt: NOW - 10 * DAY })]);
    expect(m!.expiresAt! - m!.startsAt!).toBe(30 * DAY);
    expect(m!.status).toBe('active');
  });

  it('a pass bought while one is active is queued after it (no overlap, no lost time)', () => {
    const rs = records([pay({ id: 'a', reference: 'a', verifiedAt: NOW - HOUR }), pay({ id: 'b', reference: 'b', verifiedAt: NOW - HOUR / 2 })]);
    const a = rs.find((r) => r.id === 'a')!;
    const b = rs.find((r) => r.id === 'b')!;
    expect(b.paidAt).toBe(NOW - HOUR / 2);
    expect(b.startsAt).toBe(a.expiresAt);
    expect(b.expiresAt).toBe(NOW - HOUR + 2 * DAY);
    expect(a.status).toBe('active');
    expect(b.status).toBe('scheduled');
  });

  it('admin rows and the driver-facing response agree', () => {
    const cs = [pay({ id: 'a', reference: 'a', verifiedAt: NOW - HOUR }), pay({ id: 'b', reference: 'b', amount: N(60000), verifiedAt: NOW - 10 * 60_000 })];
    const subs = statesFrom(cs);
    const tl = subscriptionTimelineResponse(subs[0]!, NOW);
    const rs = subscriptionRecords(cs, subs, NOW);
    for (const r of rs) {
      const v = tl.passes.find((p) => p.paymentRef === r.reference)!;
      expect([r.startsAt, r.expiresAt, r.status]).toEqual([v.startsAt, v.endsAt, v.status]);
    }
    expect(tl.access.activeUntil).toBe(NOW - HOUR + DAY + 30 * DAY);
  });

  it('only verified payments give access and count as revenue; refunds do not', () => {
    const rs = records([pay({ id: 'ok', reference: 'ok' }), pay({ id: 'p', reference: 'p', status: 'pending', verifiedAt: undefined }), pay({ id: 'f', reference: 'f', status: 'failed', verifiedAt: undefined })]);
    expect(rs.find((r) => r.id === 'p')!.status).toBe('pending_payment');
    expect(rs.find((r) => r.id === 'f')!.status).toBe('failed');
    expect(rs.find((r) => r.id === 'f')!.expiresAt).toBeUndefined();
    expect(subscriptionRevenue(rs, () => true)).toEqual({ total: N(2000), daily: N(2000), monthly: 0, count: 1 });
    const refunded = rs.map((r) => (r.id === 'ok' ? { ...r, status: 'refunded' as const } : r));
    expect(subscriptionRevenue(refunded, () => true).count).toBe(0);
  });

  it('eligibility needs approval and an active pass on the timeline', () => {
    const subs = statesFrom([pay({ verifiedAt: NOW - HOUR })]);
    expect(eligibility({ verification: 'approved' }, timelineFor(subs, 'drv-1', NOW)).eligible).toBe(true);
    expect(eligibility({ verification: 'approved' }, timelineFor(subs, 'drv-1', NOW + DAY))).toEqual({ eligible: false, reason: 'No active pass' });
    expect(eligibility({ verification: 'in_review' }, timelineFor(subs, 'drv-1', NOW)).eligible).toBe(false);
    expect(eligibility({ verification: 'approved' }, timelineFor([], 'drv-9', NOW)).reason).toBe('No pass bought');
  });

  it('refunding the active pass keeps history and moves the queued pass up', () => {
    const d = createPlatformDataset();
    const drv = d.drivers[0]!;
    drv.verification = 'approved';
    d.collections = [pay({ id: 'a', reference: 'a', payerId: drv.id, verifiedAt: NOW - HOUR }), pay({ id: 'b', reference: 'b', payerId: drv.id, verifiedAt: NOW - HOUR / 2 })];
    d.subscriptions = statesFrom(d.collections);
    const r = applyPassVoid(d, drv.id, { paymentRef: 'a', kind: 'refunded', at: NOW, reason: 'Test', by: 'Finance' }, NOW);
    expect(r.ok).toBe(true);
    const tl = timelineFor(d.subscriptions, drv.id, NOW);
    expect(tl.passes).toHaveLength(2);
    expect(tl.access.active).toBe(true);
    expect(tl.access.activeUntil).toBe(NOW + DAY);
    expect(drv.access).toEqual({ packageId: 'daily', expiresAt: NOW + DAY });
    const rs = subscriptionRecords(d.collections, d.subscriptions, NOW);
    expect(rs.find((x) => x.id === 'a')!.status).toBe('refunded');
    expect(rs.find((x) => x.id === 'a')!.accessEndsAt).toBe(NOW);
  });

  it('works on the test dataset', () => {
    const d = createPlatformDataset();
    const rs = subscriptionRecords(d.collections, d.subscriptions, d.generatedAt);
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every((r) => r.plan !== null)).toBe(true);
    expect(rs.some((r) => r.status === 'refunded')).toBe(true);
    const a = currentAccess(d.drivers, d.subscriptions, d.generatedAt);
    expect(a.daily + a.monthly).toBe(a.active);
    expect(a.expiring24h).toBeLessThanOrEqual(a.expiring3d);
    for (const drv of d.drivers) {
      const tl = timelineFor(d.subscriptions, drv.id, d.generatedAt);
      if (tl.access.active) expect(drv.access?.expiresAt).toBe(tl.access.activeUntil);
    }
    // Test data follows the stacking rule: nobody has months of passes piled up ahead.
    for (const st of d.subscriptions) for (const p of st.passes) expect(p.startsAt).toBeLessThanOrEqual(d.generatedAt + 31 * DAY);
  });
});
