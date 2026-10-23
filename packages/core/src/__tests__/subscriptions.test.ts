import {
  PASS_DURATION_MS,
  PASS_PRICE,
  accessUntil,
  buildTimeline,
  canAcceptRides,
  createSubscriptionService,
  driverEarnings,
  MOCK_PRICING_CONFIG,
  emptySubscriptionState,
  mayCompleteTrip,
  passAt,
  recordPassPayment,
  subscriptionTimelineResponse,
  voidPass,
  type Kobo,
  type PassPayment,
  type PassPlan,
  type SubscriptionState,
  subscriptionStateFromLegacy,
} from '../index';

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 9, 23, 8);
const pay = (ref: string, plan: PassPlan, at: number, driverId = 'drv-1'): PassPayment => ({ paymentRef: ref, driverId, plan, amount: PASS_PRICE[plan], confirmedAt: at });
function apply(...ps: PassPayment[]): SubscriptionState {
  let s = emptySubscriptionState('drv-1');
  for (const p of ps) {
    const r = recordPassPayment(s, p);
    if (!r.ok) throw new Error(r.message);
    s = r.state;
  }
  return s;
}
const span = (s: SubscriptionState) => s.passes.map((p) => [p.paymentRef, p.startsAt - T0, p.endsAt - T0]);

describe('subscription timeline: one authoritative calculation', () => {
  it('keeps the confirmed prices and exact durations, and trips stay 0% commission', () => {
    expect(PASS_PRICE).toEqual({ daily: 200_000, monthly: 6_000_000 });
    expect(PASS_DURATION_MS).toEqual({ daily: 24 * H, monthly: 30 * D });
    expect(driverEarnings(500_000 as Kobo, MOCK_PRICING_CONFIG)).toEqual({ commission: 0, earnings: 500_000 });
  });

  it('daily → daily: the second pass queues after the first, nothing lost', () => {
    const s = apply(pay('a', 'daily', T0), pay('b', 'daily', T0 + 3 * H));
    expect(span(s)).toEqual([['a', 0, D], ['b', D, 2 * D]]);
    expect(accessUntil(s.passes, T0 + 5 * H)).toBe(T0 + 2 * D);
  });

  it('daily → monthly: the monthly starts when the daily ends', () => {
    const s = apply(pay('a', 'daily', T0), pay('b', 'monthly', T0 + 10 * H));
    expect(span(s)).toEqual([['a', 0, D], ['b', D, D + 30 * D]]);
  });

  it('monthly → daily: the daily waits for the monthly', () => {
    const s = apply(pay('a', 'monthly', T0), pay('b', 'daily', T0 + 2 * D));
    expect(span(s)).toEqual([['a', 0, 30 * D], ['b', 30 * D, 31 * D]]);
  });

  it('multiple queued passes chain after the LAST scheduled end, not the current one', () => {
    const s = apply(pay('a', 'daily', T0), pay('b', 'daily', T0 + H), pay('c', 'monthly', T0 + 2 * H), pay('d', 'daily', T0 + 3 * H));
    expect(span(s)).toEqual([['a', 0, D], ['b', D, 2 * D], ['c', 2 * D, 32 * D], ['d', 32 * D, 33 * D]]);
    const r = subscriptionTimelineResponse(s, T0 + 4 * H);
    expect(r.access).toMatchObject({ active: true, currentPlan: 'daily', currentPassEndsAt: T0 + D, activeUntil: T0 + 33 * D });
    expect(r.summary).toMatchObject({ active: 1, scheduled: 3, nextStartsAt: T0 + D });
  });

  it('confirmation, start and end are separate fields', () => {
    const s = apply(pay('a', 'daily', T0), pay('b', 'daily', T0 + H));
    expect(s.passes[1]).toMatchObject({ confirmedAt: T0 + H, startsAt: T0 + D, endsAt: T0 + 2 * D });
  });

  it('access stays continuous across back-to-back passes, and queued passes activate on time with no job', () => {
    const s = apply(pay('a', 'daily', T0), pay('b', 'daily', T0 + H));
    for (const t of [T0, T0 + D - 1, T0 + D, T0 + 2 * D - 1]) expect(canAcceptRides(s.passes, t)).toBe(true);
    expect(subscriptionTimelineResponse(s, T0 + D + 1).access.currentPassId).toBe('pass:b');
    expect(canAcceptRides(s.passes, T0 + 2 * D)).toBe(false);
  });

  it('simultaneous payments give the same timeline whatever order they arrive in', () => {
    const x = pay('x', 'daily', T0);
    const y = pay('y', 'monthly', T0);
    expect(span(apply(x, y))).toEqual(span(apply(y, x)));
    // A late-arriving webhook for an earlier payment slots in by confirmation time.
    const late = apply(pay('b', 'daily', T0 + H), pay('a', 'daily', T0));
    expect(span(late)).toEqual([['a', 0, D], ['b', D, 2 * D]]);
  });

  it('simultaneous writes: a stale version is refused, and the service retries to the same result', () => {
    const s = apply(pay('a', 'daily', T0));
    const r = recordPassPayment(s, pay('b', 'daily', T0 + H), { expectedVersion: 0 });
    expect(r).toMatchObject({ ok: false, error: 'version_conflict' });
    const svc = createSubscriptionService();
    svc.recordVerifiedPayment(pay('a', 'daily', T0));
    svc.recordVerifiedPayment(pay('b', 'daily', T0 + H));
    expect(span(svc.state('drv-1'))).toEqual([['a', 0, D], ['b', D, 2 * D]]);
  });

  it('duplicate webhooks for one payment create one pass and never extend access', () => {
    const s = apply(pay('a', 'daily', T0));
    const again = recordPassPayment(s, pay('a', 'daily', T0 + 5 * H));
    expect(again).toMatchObject({ ok: true, duplicate: true });
    if (again.ok) expect(again.state).toBe(s);
    expect(s.passes).toHaveLength(1);
  });

  it('refuses a payment whose amount is not the pass price', () => {
    expect(recordPassPayment(emptySubscriptionState('drv-1'), { ...pay('a', 'daily', T0), amount: 150_000 as Kobo })).toMatchObject({ ok: false, error: 'amount_mismatch' });
  });

  it('expiration: no new requests after the end, but a trip accepted with access may be completed', () => {
    const s = apply(pay('a', 'daily', T0));
    expect(canAcceptRides(s.passes, T0 + D)).toBe(false);
    expect(mayCompleteTrip(s.passes, T0 + D - 10 * 60_000)).toBe(true);
    expect(mayCompleteTrip(s.passes, T0 + D + 1)).toBe(false);
    expect(subscriptionTimelineResponse(s, T0 + D).passes[0]!.status).toBe('expired');
  });

  it('renewal after expiry starts at confirmation (no back-dating); before expiry it queues', () => {
    const gap = apply(pay('a', 'daily', T0), pay('b', 'daily', T0 + 3 * D));
    expect(span(gap)).toEqual([['a', 0, D], ['b', 3 * D, 4 * D]]);
    expect(canAcceptRides(gap.passes, T0 + 2 * D)).toBe(false);
    const early = apply(pay('a', 'monthly', T0), pay('b', 'monthly', T0 + 29 * D));
    expect(span(early)).toEqual([['a', 0, 30 * D], ['b', 30 * D, 60 * D]]);
  });

  it('refund of a SCHEDULED pass: no access from it, later passes move up, history kept', () => {
    const s = apply(pay('a', 'daily', T0), pay('b', 'daily', T0 + H), pay('c', 'daily', T0 + 2 * H));
    const r = voidPass(s, { paymentRef: 'b', kind: 'refunded', at: T0 + 3 * H, reason: 'Bought by mistake', by: 'Grace Finance' });
    if (!r.ok) throw new Error(r.message);
    expect(r.state.passes).toHaveLength(3);
    const b = r.state.passes.find((p) => p.paymentRef === 'b')!;
    expect(b.accessEndsAt).toBe(b.startsAt);
    expect(r.state.passes.find((p) => p.paymentRef === 'c')!.startsAt).toBe(T0 + D);
    expect(accessUntil(r.state.passes, T0 + 4 * H)).toBe(T0 + 2 * D);
    expect(subscriptionTimelineResponse(r.state, T0 + 4 * H).passes.find((p) => p.paymentRef === 'b')!.status).toBe('refunded');
  });

  it('reversal of the ACTIVE pass ends its access now and never extends it; the next pass starts at once', () => {
    const s = apply(pay('a', 'monthly', T0), pay('b', 'daily', T0 + H));
    const r = voidPass(s, { paymentRef: 'a', kind: 'reversed', at: T0 + 5 * D, reason: 'Bank reversed the payment', by: 'provider' });
    if (!r.ok) throw new Error(r.message);
    const [a, b] = r.state.passes;
    expect(a!.accessEndsAt).toBe(T0 + 5 * D);
    expect(b!.startsAt).toBe(T0 + 5 * D);
    expect(accessUntil(r.state.passes, T0 + 5 * D)).toBe(T0 + 6 * D);
    expect(canAcceptRides(r.state.passes, T0 + 6 * D)).toBe(false);
  });

  it('cancelling a pass that already ran changes nothing (no retroactive loss); voids are idempotent', () => {
    const s = apply(pay('a', 'daily', T0), pay('b', 'daily', T0 + 2 * D));
    const v = { paymentRef: 'a', kind: 'cancelled' as const, at: T0 + 3 * D, reason: 'Account closed', by: 'owner' };
    const r = voidPass(s, v);
    if (!r.ok) throw new Error(r.message);
    expect(r.state.passes.map((p) => [p.startsAt, p.accessEndsAt])).toEqual(s.passes.map((p) => [p.startsAt, p.endsAt]));
    const again = voidPass(r.state, { ...v, at: T0 + 4 * D });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(voidPass(s, { ...v, paymentRef: 'nope' })).toMatchObject({ ok: false, error: 'unknown_payment' });
  });

  it('the stored timeline always equals the pure recalculation', () => {
    const s = apply(pay('a', 'daily', T0), pay('b', 'monthly', T0 + H), pay('c', 'daily', T0 + 40 * D));
    expect(s.passes).toEqual(buildTimeline(s.payments, s.voids));
    expect(passAt(s.passes, T0 + 35 * D)).toBeUndefined();
  });

  it('migrates an old single stored pass into the timeline, then queues new purchases after it', () => {
    const legacy = subscriptionStateFromLegacy('drv-1', { packageId: 'daily', startsAt: T0, expiresAt: T0 + D });
    expect(legacy.passes).toHaveLength(1);
    expect([legacy.passes[0]!.startsAt, legacy.passes[0]!.endsAt]).toEqual([T0, T0 + D]);
    const r = recordPassPayment(legacy, pay('m', 'monthly', T0 + H));
    expect(r.ok && r.state.passes[1]!.startsAt).toBe(T0 + D);
    expect(subscriptionStateFromLegacy('drv-1', null).passes).toHaveLength(0);
  });
});
