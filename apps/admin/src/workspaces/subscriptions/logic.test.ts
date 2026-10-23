import { describe, expect, it } from 'vitest';
import { createPlatformDataset, type CollectionRecord, type Kobo } from '@gobye/core';
import { currentAccess, eligibility, planForAmount, subscriptionRecords, subscriptionRevenue } from './logic';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 21, 20);
const N = (n: number) => (n * 100) as Kobo;
const pay = (over: Partial<CollectionRecord>): CollectionRecord => ({
  id: 'c', purpose: 'package_purchase', payerType: 'driver', payerId: 'drv-1', amount: N(2000), fee: 0 as Kobo, provider: 'Paystack (test)', reference: 'r', status: 'successful', createdAt: NOW - DAY, verifiedAt: NOW - DAY, events: [], ...over,
});

describe('driver subscriptions derivation', () => {
  it('reads the plan from the confirmed prices and flags anything else', () => {
    expect(planForAmount(N(2000))).toBe('daily');
    expect(planForAmount(N(60000))).toBe('monthly');
    expect(planForAmount(N(2500))).toBeNull();
    const [r] = subscriptionRecords([pay({ amount: N(2500) })], NOW);
    expect(r!.status).toBe('needs_review');
  });

  it('daily lasts 24 hours from verification; monthly 30 days', () => {
    const [d] = subscriptionRecords([pay({ verifiedAt: NOW - 2 * 3_600_000 })], NOW);
    expect(d!.expiresAt! - d!.startsAt!).toBe(DAY);
    expect(d!.status).toBe('active');
    const [old] = subscriptionRecords([pay({ verifiedAt: NOW - 2 * DAY })], NOW);
    expect(old!.status).toBe('expired');
    const [m] = subscriptionRecords([pay({ amount: N(60000), verifiedAt: NOW - 10 * DAY })], NOW);
    expect(m!.expiresAt! - m!.startsAt!).toBe(30 * DAY);
    expect(m!.status).toBe('active');
  });

  it('each pass runs from its own activation (stacking is Q-043, not assumed here)', () => {
    const rs = subscriptionRecords([pay({ id: 'a', verifiedAt: NOW - 3_600_000 }), pay({ id: 'b', verifiedAt: NOW - 1_800_000 })], NOW);
    const b = rs.find((r) => r.id === 'b')!;
    expect(b.startsAt).toBe(NOW - 1_800_000);
    expect(b.status).toBe('active');
  });

  it('only verified payments activate access and count as revenue', () => {
    const rs = subscriptionRecords([pay({ id: 'ok' }), pay({ id: 'p', status: 'pending', verifiedAt: undefined }), pay({ id: 'f', status: 'failed', verifiedAt: undefined })], NOW);
    expect(rs.find((r) => r.id === 'p')!.status).toBe('pending_payment');
    expect(rs.find((r) => r.id === 'f')!.status).toBe('failed');
    expect(rs.find((r) => r.id === 'f')!.expiresAt).toBeUndefined();
    const rev = subscriptionRevenue(rs, () => true);
    expect(rev).toEqual({ total: N(2000), daily: N(2000), monthly: 0, count: 1 });
  });

  it('eligibility needs approval and active access', () => {
    expect(eligibility({ verification: 'approved', access: { packageId: 'daily', expiresAt: NOW + 1 } }, NOW).eligible).toBe(true);
    expect(eligibility({ verification: 'approved', access: { packageId: 'daily', expiresAt: NOW - 1 } }, NOW)).toEqual({ eligible: false, reason: 'Access expired' });
    expect(eligibility({ verification: 'in_review', access: { packageId: 'monthly', expiresAt: NOW + DAY } }, NOW).eligible).toBe(false);
    expect(eligibility({ verification: 'approved', access: null }, NOW).reason).toBe('No access bought');
  });

  it('works on the test dataset', () => {
    const d = createPlatformDataset();
    const rs = subscriptionRecords(d.collections, d.generatedAt);
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every((r) => r.plan !== null)).toBe(true);
    const a = currentAccess(d.drivers, d.generatedAt);
    expect(a.daily + a.monthly).toBe(a.active);
    expect(a.expiring24h).toBeLessThanOrEqual(a.expiring3d);
  });
});
