import { describe, expect, it } from 'vitest';
import { createPlatformDataset } from '@gobye/core';
import { dailyCompleted, integrationAlerts, ledgerCityResolver, needsAttention, overviewMetrics, type Keep } from './logic';

const d = createPlatformDataset();
const now = d.generatedAt;
const all: Keep = () => true;
const lagos: Keep = (c) => c === 'lagos';

describe('overviewMetrics', () => {
  const m = overviewMetrics(d, all, now);

  it('counts completed trips and matching success from requested trips', () => {
    expect(m.completedTrips).toBe(d.trips.filter((t) => t.status === 'completed').length);
    expect(m.matchingSuccess).toBeCloseTo(d.trips.filter((t) => t.driverId).length / d.trips.length);
    expect(m.cancellationRate).toBeCloseTo(d.trips.filter((t) => t.status === 'cancelled').length / d.trips.length);
  });

  it('keeps wallet deposits out of company revenue', () => {
    const pkg = d.ledger.filter((e) => e.account.kind === 'company_revenue').reduce((s, e) => s + e.amount, 0);
    expect(m.companyRevenue).toBe(pkg);
    expect(m.walletDeposits).toBeGreaterThan(0);
    expect(m.companyRevenue).not.toBe(m.companyRevenue + m.walletDeposits);
    const fundings = d.ledger.filter((e) => e.kind === 'wallet_funding' && e.account.kind === 'passenger_wallet').reduce((s, e) => s + e.amount, 0);
    expect(m.walletDeposits).toBe(fundings);
  });

  it('active drivers are approved with an unexpired access package', () => {
    expect(m.activeDrivers).toBe(d.drivers.filter((x) => x.verification === 'approved' && x.access && x.access.expiresAt > now).length);
  });

  it('repeat share is passengers with 2+ completed trips over active passengers', () => {
    expect(m.repeatPassengers).toBeLessThanOrEqual(m.activePassengers);
    expect(m.repeatShare).toBeCloseTo(m.repeatPassengers / m.activePassengers);
  });

  it('payouts, processing costs and promotions are positive amounts', () => {
    expect(m.payouts).toBeGreaterThan(0);
    expect(m.processingCosts).toBeGreaterThan(0);
    expect(m.promotions).toBe(6 * 500_00);
    expect(m.refunds).toBe(2000_00);
  });

  it('a city filter narrows every figure', () => {
    const l = overviewMetrics(d, lagos, now);
    expect(l.completedTrips).toBe(d.trips.filter((t) => t.status === 'completed' && t.city === 'lagos').length);
    expect(l.companyRevenue).toBeLessThan(m.companyRevenue);
  });
});

describe('ledgerCityResolver', () => {
  it('resolves package revenue to the paying driver city', () => {
    const cityOf = ledgerCityResolver(d);
    const e = d.ledger.find((x) => x.kind === 'package_purchase' && x.account.kind === 'company_revenue')!;
    const col = d.collections.find((c) => c.reference === e.reference)!;
    expect(cityOf(e)).toBe(d.drivers.find((x) => x.id === col.payerId)!.city);
  });
});

describe('dailyCompleted', () => {
  it('buckets completed trips by day with the right total', () => {
    const days = dailyCompleted(d, all, now, 30);
    expect(days).toHaveLength(30);
    const inWindow = d.trips.filter((t) => t.status === 'completed' && t.completedAt && t.completedAt >= days[0]!.day).length;
    expect(days.reduce((s, x) => s + x.count, 0)).toBe(inWindow);
  });
});

describe('needsAttention', () => {
  it('lists only non zero items, safety first', () => {
    const items = needsAttention(d, all);
    expect(items.every((i) => i.count > 0)).toBe(true);
    expect(items[0]!.key).toBe('safety');
    expect(items.find((i) => i.key === 'approvals')!.count).toBe(d.approvals.filter((a) => a.status === 'pending').length);
  });
});

describe('integrationAlerts', () => {
  it('reports nothing live in the test data', () => {
    const a = integrationAlerts(d);
    expect(a.notLive).toBe(a.total);
  });
});
