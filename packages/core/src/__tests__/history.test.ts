import { receiptReference, chargedAmount, dayLabel, filterHistory, groupByDay, needsAttention, periodStart, summariseHistory } from '../booking/history';
import { MOCK_PLACES } from '../mocks/data';
import { kobo, naira } from '../money';
import type { PaymentStatus, TripReceipt } from '../types';

// Thursday 22 Oct 2026, 15:00 local.
const NOW = new Date(2026, 9, 22, 15, 0, 0).getTime();
const H = 3_600_000;

function receipt(id: string, at: number, opts: { status?: PaymentStatus; method?: 'wallet' | 'bank_transfer'; fare?: number; fee?: number } = {}): TripReceipt {
  const fare = naira(opts.fare ?? 2500);
  const fee = naira(opts.fee ?? 0);
  return {
    bookingId: id,
    fare,
    processingFee: fee,
    totalPaid: kobo(fare + fee),
    breakdown: { base: fare, distance: kobo(0), time: kobo(0), total: fare } as unknown as TripReceipt['breakdown'],
    paymentMethod: { id: 'pm', type: opts.method ?? 'wallet', label: 'x' },
    paymentStatus: opts.status ?? 'paid',
    pickup: MOCK_PLACES[0],
    destination: MOCK_PLACES[1],
    startedAt: at - 20 * 60_000,
    completedAt: at,
    distanceMeters: 8000,
    durationSeconds: 1200,
    isSimulated: true,
  };
}

const list = [
  receipt('a', NOW - 2 * H), // today
  receipt('b', NOW - 26 * H, { method: 'bank_transfer', status: 'pending', fee: 50 }), // yesterday
  receipt('c', new Date(2026, 9, 19, 9).getTime(), { status: 'failed' }), // Monday this week
  receipt('d', new Date(2026, 9, 5, 9).getTime(), { method: 'bank_transfer' }), // this month
  receipt('e', new Date(2026, 8, 28, 9).getTime()), // last month
];

describe('rider trip history', () => {
  it('starts weeks on Monday and months on the 1st', () => {
    expect(new Date(periodStart('week', NOW)).getDate()).toBe(19);
    expect(new Date(periodStart('month', NOW)).getDate()).toBe(1);
    expect(periodStart('all', NOW)).toBe(0);
  });

  it('filters by period, newest first', () => {
    expect(filterHistory(list, { period: 'week', filter: 'all', now: NOW }).map((r) => r.bookingId)).toEqual(['a', 'b', 'c']);
    expect(filterHistory(list, { period: 'month', filter: 'all', now: NOW })).toHaveLength(4);
    expect(filterHistory([...list].reverse(), { period: 'all', filter: 'all', now: NOW })[0].bookingId).toBe('a');
  });

  it('filters by payment method and by trips that need attention', () => {
    expect(filterHistory(list, { period: 'all', filter: 'bank_transfer', now: NOW }).map((r) => r.bookingId)).toEqual(['b', 'd']);
    expect(filterHistory(list, { period: 'all', filter: 'attention', now: NOW }).map((r) => r.bookingId)).toEqual(['b', 'c']);
    expect(needsAttention(list[0])).toBe(false);
  });

  it('summarises spend without failed payments and includes fees', () => {
    const s = summariseHistory(filterHistory(list, { period: 'week', filter: 'all', now: NOW }));
    expect(s.trips).toBe(3);
    expect(s.spent).toBe(naira(2500) + naira(2550));
    expect(s.average).toBe(naira(2525));
    expect(summariseHistory([receipt('x', NOW, { fare: 1000 }), receipt('y', NOW, { fare: 1001 })]).average).toBe(naira(1001)); // ₦1,000.50 → whole naira
    expect(summariseHistory([receipt('z', NOW, { status: 'refunded' })]).spent).toBe(0);
    expect(s.attention).toBe(2);
    expect(s.distanceMeters).toBe(24000);
    expect(chargedAmount(list[1])).toBe(naira(2550));
    expect(summariseHistory([]).average).toBe(0);
  });

  it('groups by day with readable titles', () => {
    const groups = groupByDay(filterHistory(list, { period: 'week', filter: 'all', now: NOW }), NOW);
    expect(groups.map((g) => g.title.slice(0, 3))).toEqual(['Tod', 'Yes', 'Mon']);
    expect(dayLabel(NOW, NOW)).toBe('Today');
  });
});

describe('receipt reference', () => {
  it('is short, upper case and stable', () => {
    expect(receiptReference('bk-lz3x9a-4f7q2m')).toBe('GB-9A4F7Q2M');
    expect(receiptReference('bk-1')).toBe('GB-00000BK1');
    expect(receiptReference('bk-lz3x9a-4f7q2m')).toBe(receiptReference('bk-lz3x9a-4f7q2m'));
  });
});
