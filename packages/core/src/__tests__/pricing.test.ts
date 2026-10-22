import { formatNaira, kobo, naira, nairaAccessibilityLabel, roundUpTo } from '../money';
import { MOCK_PRICING_CONFIG as C } from '../pricing/config';
import { calculateFare, createQuote, driverEarnings, isQuoteExpired, negotiationRange, passengerCancellationFee } from '../pricing/fare';

describe('money (BR-001 – BR-003)', () => {
  it('rejects non-integer kobo', () => {
    expect(() => kobo(1.5)).toThrow();
  });
  it('converts naira to kobo', () => {
    expect(naira(3450.5)).toBe(345050);
  });
  it('formats naira with grouping and optional decimals', () => {
    expect(formatNaira(naira(3450))).toBe('₦3,450');
    expect(formatNaira(naira(3450.5))).toBe('₦3,450.50');
    expect(formatNaira(naira(1250000))).toBe('₦1,250,000');
    expect(formatNaira(naira(-1800))).toBe('−₦1,800');
    expect(formatNaira(naira(500), { signed: true })).toBe('+₦500');
    expect(formatNaira(kobo(5))).toBe('₦0.05');
  });
  it('produces a spoken label', () => {
    expect(nairaAccessibilityLabel(naira(3450))).toBe('3,450 naira');
  });
  it('rounds up to the step', () => {
    expect(roundUpTo(naira(3401), naira(50))).toBe(naira(3450));
    expect(roundUpTo(naira(3450), naira(50))).toBe(naira(3450));
  });
});

describe('calculateFare (BR-020 – BR-023)', () => {
  const route = { distanceMeters: 10_000, durationSeconds: 1_800 };

  it('computes base + distance + time, rounded up to ₦50', () => {
    // go: 500 + 10 × 180 + 30 × 25 = 3,050
    const f = calculateFare(route, 'go', C);
    expect(f.base).toBe(naira(500));
    expect(f.distance).toBe(naira(1800));
    expect(f.time).toBe(naira(750));
    expect(f.total).toBe(naira(3050));
    expect(f.minimumApplied).toBe(false);
    expect(f.rounding).toBe(0);
  });

  it('parts plus rounding always equal the total', () => {
    const f = calculateFare({ distanceMeters: 7_333, durationSeconds: 1_111 }, 'comfort', C);
    expect(f.base + f.distance + f.time + f.rounding).toBe(f.total);
    expect(f.total % C.roundingStep).toBe(0);
  });

  it('applies the minimum fare for short trips', () => {
    const f = calculateFare({ distanceMeters: 500, durationSeconds: 120 }, 'go', C);
    expect(f.minimumApplied).toBe(true);
    expect(f.total).toBe(naira(1200));
  });

  it('applies a demand multiplier and rejects multipliers below 1', () => {
    const f = calculateFare(route, 'go', C, 1.2);
    expect(f.total).toBe(naira(3700)); // 3,050 × 1.2 = 3,660 → 3,700
    expect(() => calculateFare(route, 'go', C, 0.9)).toThrow();
  });

  it('keeps every category total a non-negative integer', () => {
    for (const cat of ['keke', 'go', 'comfort', 'xl'] as const) {
      const f = calculateFare({ distanceMeters: 12_345, durationSeconds: 2_222 }, cat, C);
      expect(Number.isInteger(f.total)).toBe(true);
      expect(f.total).toBeGreaterThanOrEqual(C.rates[cat].minimumFare);
    }
  });
});

describe('negotiationRange (BR-040)', () => {
  it('is 75%–150% of suggested, snapped to the step', () => {
    const r = negotiationRange(naira(3050), 'go', C);
    expect(r.min).toBe(naira(2300)); // 2,287.50 → 2,300
    expect(r.max).toBe(naira(4550)); // 4,575 → 4,550
  });
  it('never goes below the category minimum fare', () => {
    const r = negotiationRange(naira(1200), 'go', C);
    expect(r.min).toBe(naira(1200));
  });
});

describe('quotes, earnings and cancellation', () => {
  const route = { distanceMeters: 10_000, durationSeconds: 1_800, polyline: [], isSimulated: true };
  it('expires after the TTL (BR-022)', () => {
    const q = createQuote({ id: 'q', route, category: 'go', config: C, now: 0 });
    expect(isQuoteExpired(q, C.quoteTtlSeconds * 1000 - 1)).toBe(false);
    expect(isQuoteExpired(q, C.quoteTtlSeconds * 1000)).toBe(true);
    expect(q.isSimulated).toBe(true);
  });
  it('previews driver earnings with 0% commission (BR-060, Q-002)', () => {
    expect(driverEarnings(naira(3000), C)).toEqual({ commission: 0, earnings: naira(3000) });
    expect(driverEarnings(naira(3000), { ...C, commissionRate: 0.1 })).toEqual({ commission: naira(300), earnings: naira(2700) });
  });
  it('charges no fee before match or within the free window (BR-080)', () => {
    expect(passengerCancellationFee({ now: 10_000 }, C)).toBe(0);
    expect(passengerCancellationFee({ matchedAt: 0, now: 119_000 }, C)).toBe(0);
  });
  it('charges the fee after the free window or a long wait (BR-081)', () => {
    expect(passengerCancellationFee({ matchedAt: 0, now: 121_000 }, C)).toBe(C.cancellation.fee);
    expect(passengerCancellationFee({ matchedAt: 0, arrivedAt: 60_000, now: 60_000 + 300_000 }, C)).toBe(C.cancellation.fee);
  });
});
