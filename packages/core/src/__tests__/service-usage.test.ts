import { ROLE_PERMISSIONS, createPlatformDataset, isReadOnly, naira, payPerUseServices, usageSummary, type Kobo, type ServiceUsage } from '../index';

const base: ServiceUsage = {
  billing: 'prepaid',
  source: 'our_records',
  pricesConfirmed: true,
  asOf: 0,
  lowBalanceAt: naira(1_000),
  toppedUp: naira(10_000),
  unitPrices: [{ item: 'a', label: 'A', price: naira(100) }, { item: 'b', label: 'B', price: naira(400) }],
  used: [{ item: 'a', total: 10, thisMonth: 2 }, { item: 'b', total: 5, thisMonth: 1 }],
  bundle: { label: 'one of each', items: ['a', 'b'] },
};

describe('pay per use balances (D-068)', () => {
  it('works out spend, balance and how many more uses are possible', () => {
    const s = usageSummary(base);
    expect(s.spent).toBe(naira(3_000));
    expect(s.spentThisMonth).toBe(naira(600));
    expect(s.usesThisMonth).toBe(3);
    expect(s.balance).toBe(naira(7_000));
    expect(s.left).toEqual([{ item: 'a', label: 'A', count: 70 }, { item: 'b', label: 'B', count: 17 }]);
    expect(s.bundleCost).toBe(naira(500));
    expect(s.bundlesLeft).toBe(14);
    expect(s.low).toBe(false);
  });

  it('warns when the balance is low and never shows a negative balance', () => {
    const s = usageSummary({ ...base, toppedUp: naira(2_000) as Kobo });
    expect(s.balance).toBe(0);
    expect(s.low).toBe(true);
    expect(s.bundlesLeft).toBe(0);
  });

  it('QoreID and SMS carry usage; low balances sort first', () => {
    const list = payPerUseServices(createPlatformDataset().integrations);
    expect(list.map((x) => x.integration.id).sort()).toEqual(['int-idv', 'int-sms']);
    expect(list[0].summary.low).toBe(true);
  });
});

describe('stakeholder role (D-068)', () => {
  it('is view only and has no technical, personal or safety access', () => {
    expect(isReadOnly(['stakeholder'])).toBe(true);
    for (const p of ['integrations.view', 'logs.view', 'drivers.view', 'passengers.view', 'safety.view', 'audit.view', 'finance.view']) {
      expect(ROLE_PERMISSIONS.stakeholder).not.toContain(p);
    }
    expect(ROLE_PERMISSIONS.stakeholder).toContain('summary.view');
  });
});
