import { MOCK_SERVICE_CONFIG, enabledCategories, generatePickupPin, walletSummary } from '../config';
import { arrivalProgress, isDriverLocationStale, RIDER_LOCATION_STALE_MS } from '../booking/live';
import { bookingReducer, initialBookingState } from '../booking/machine';
import { createMockServices } from '../mocks/services';
import { MOCK_PAYMENT_METHODS, MOCK_PLACES, makeMockDriver, seededRandom } from '../mocks/data';
import { naira } from '../money';
import { MOCK_PRICING_CONFIG as C } from '../pricing/config';
import { createQuote } from '../pricing/fare';
import type { Booking, WalletTransaction } from '../types';

describe('admin service config (brief §5)', () => {
  it('launches with exactly one enabled car category and no Keke', () => {
    const enabled = enabledCategories(MOCK_SERVICE_CONFIG);
    expect(enabled.map((c) => c.id)).toEqual(['go']);
    expect(enabled.some((c) => c.id === 'keke')).toBe(false);
  });
  it('quotes only enabled categories, and follows the config when more are enabled', async () => {
    const quotes = await createMockServices({ flags: { latency: [0, 0] } }).pricing.quoteAll({ distanceMeters: 5000, durationSeconds: 900, polyline: [], isSimulated: true });
    expect(quotes.map((q) => q.category)).toEqual(['go']);
    const more = { ...MOCK_SERVICE_CONFIG, categories: MOCK_SERVICE_CONFIG.categories.map((c) => (c.id === 'xl' ? { ...c, enabled: true } : c)) };
    const q2 = await createMockServices({ serviceConfig: more, flags: { latency: [0, 0] } }).pricing.quoteAll({ distanceMeters: 5000, durationSeconds: 900, polyline: [], isSimulated: true });
    expect(q2.map((q) => q.category)).toEqual(['go', 'xl']);
  });
  it('never makes the referral reward depend on sign-up alone (brief §12)', () => {
    expect(MOCK_SERVICE_CONFIG.referral.qualifyingRule).toBe('first_completed_paid_trip');
  });
});

describe('pickup PIN, ETA and stale location (brief §7–8)', () => {
  const route = { distanceMeters: 10_000, durationSeconds: 1_800, polyline: [MOCK_PLACES[0].coordinate, MOCK_PLACES[1].coordinate], isSimulated: true };
  const draft: Booking = {
    id: 'b', mode: 'quick_match', status: 'searching', pickup: MOCK_PLACES[0], destination: MOCK_PLACES[1], route,
    quote: createQuote({ id: 'q', route, category: 'go', config: C, now: 0 }), paymentMethod: MOCK_PAYMENT_METHODS[0], responses: [], createdAt: 0, updatedAt: 0,
  };
  const driver = makeMockDriver(1, 'go', MOCK_PLACES[0].coordinate, seededRandom(1));

  it('generates a PIN of the configured length and stores it on match', () => {
    const pin = generatePickupPin(4, seededRandom(3));
    expect(pin).toMatch(/^\d{4}$/);
    const s = bookingReducer({ booking: draft }, { type: 'DRIVER_MATCHED', driver, now: 1, pickupPin: pin });
    expect(s.booking?.pickupPin).toBe(pin);
  });

  it('derives arrival progress from feed ETAs and flags stale positions', () => {
    let s = bookingReducer({ booking: draft }, { type: 'DRIVER_MATCHED', driver, now: 0, pickupPin: '1234' });
    expect(arrivalProgress(s.booking!)).toBeNull();
    s = bookingReducer(s, { type: 'DRIVER_LOCATION', coordinate: driver.coordinate, etaSeconds: 400, now: 1000 });
    s = bookingReducer(s, { type: 'DRIVER_LOCATION', coordinate: driver.coordinate, etaSeconds: 100, now: 2000 });
    expect(arrivalProgress(s.booking!)).toBeCloseTo(0.75);
    expect(isDriverLocationStale(s.booking!, 2000 + RIDER_LOCATION_STALE_MS - 1)).toBe(false);
    expect(isDriverLocationStale(s.booking!, 2000 + RIDER_LOCATION_STALE_MS + 1)).toBe(true);
  });

  it('every new booking starts empty', () => {
    expect(initialBookingState.booking).toBeNull();
  });
});

describe('wallet (brief §10)', () => {
  const tx = (amount: number, status: WalletTransaction['status']): WalletTransaction => ({ id: Math.random().toString(), type: amount > 0 ? 'top_up' : 'ride_payment', status, amount: amount as never, createdAt: 0, description: '' });
  it('separates available, reserved and pending deposits; ignores failed and reversed', () => {
    const s = walletSummary([tx(naira(5000), 'successful'), tx(naira(-1000), 'successful'), tx(naira(-800), 'pending'), tx(naira(2000), 'pending'), tx(naira(3000), 'failed'), tx(naira(-1500), 'reversed')]);
    expect(s).toEqual({ settled: naira(4000), reserved: naira(800), available: naira(3200), pendingIn: naira(2000) });
  });

  it('keeps deposits pending until confirmed and debits the wallet only on a paid trip', async () => {
    let now = 0;
    const scheduler = { now: () => now, setTimeout: (fn: () => void) => { fn(); return 0; }, clearTimeout: () => undefined };
    const s = createMockServices({ scheduler, random: () => 0.5, flags: { depositFailureRate: 0, latency: [0, 0] } });
    const dep = await s.wallet.requestDeposit(naira(2000));
    expect(await s.wallet.checkDeposit(dep.transactionId)).toBe('pending');
    now = 10_000;
    expect(await s.wallet.checkDeposit(dep.transactionId)).toBe('successful');
    const before = walletSummary(await s.wallet.listTransactions()).available;
    const r = await s.payments.charge({ bookingId: 'b1', method: MOCK_PAYMENT_METHODS[0], amount: naira(1000), idempotencyKey: 'b1-1' });
    expect(r.status).toBe('paid');
    expect(walletSummary(await s.wallet.listTransactions()).available).toBe(before - naira(1000));
    const tooMuch = await s.payments.charge({ bookingId: 'b2', method: MOCK_PAYMENT_METHODS[0], amount: naira(999999), idempotencyKey: 'b2-1' });
    expect(tooMuch.status).toBe('failed');
  });

  it('never debits the wallet twice for the same trip (retry after a restart)', async () => {
    const scheduler = { now: () => 0, setTimeout: (fn: () => void) => { fn(); return 0; }, clearTimeout: () => undefined };
    const s = createMockServices({ scheduler, random: () => 0.5, flags: { latency: [0, 0] } });
    const before = walletSummary(await s.wallet.listTransactions()).available;
    await s.payments.charge({ bookingId: 'b9', method: MOCK_PAYMENT_METHODS[0], amount: naira(1000), idempotencyKey: 'b9-1' });
    const again = await s.payments.charge({ bookingId: 'b9', method: MOCK_PAYMENT_METHODS[0], amount: naira(1000), idempotencyKey: 'b9-1' });
    expect(again.status).toBe('paid');
    expect(walletSummary(await s.wallet.listTransactions()).available).toBe(before - naira(1000));
  });

  it('reports an unseen bank transfer as not received (pending), never failed or paid', async () => {
    const scheduler = { now: () => 0, setTimeout: (fn: () => void) => { fn(); return 0; }, clearTimeout: () => undefined };
    const s = createMockServices({ scheduler, flags: { transferNotReceivedRate: 1, latency: [0, 0] } });
    const transfer = MOCK_PAYMENT_METHODS.find((m) => m.type === 'bank_transfer')!;
    const r = await s.payments.charge({ bookingId: 'b3', method: transfer, amount: naira(1000), idempotencyKey: 'b3-1' });
    expect(r.status).toBe('not_received');
  });
});
