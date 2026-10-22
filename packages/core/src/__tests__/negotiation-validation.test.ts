import { createMockServices } from '../mocks/services';
import { formatCountdown, formatDistance, formatDuration } from '../geo';
import { naira } from '../money';
import { createOffer, offerErrorMessage, selectableResponses, stepOffer, validateOffer } from '../negotiation';
import { MOCK_PRICING_CONFIG as C } from '../pricing/config';
import { createQuote } from '../pricing/fare';
import { formatPhone, validateEmail, validateName, validateNigerianPhone, validateOtp, validateRatingComment } from '../validation';
import type { Scheduler } from '../services/types';
import type { Booking } from '../types';
import { MOCK_PAYMENT_METHODS, MOCK_PLACES, seededRandom } from '../mocks/data';

const route = { distanceMeters: 10_000, durationSeconds: 1_800, polyline: [], isSimulated: true };
const quote = createQuote({ id: 'q', route, category: 'go', config: C, now: 0 }); // suggested ₦3,050; range ₦2,300–₦4,550

describe('validateOffer', () => {
  it('accepts an in-range amount on the step', () => {
    expect(validateOffer(naira(2500), quote, C, 1)).toEqual({ ok: true, value: naira(2500) });
  });
  it.each([
    [naira(2000), 'below_min'],
    [naira(5000), 'above_max'],
    [naira(2525), 'not_on_step'],
    [2500.5, 'not_integer'],
  ])('rejects %p as %s', (amount, code) => {
    const r = validateOffer(amount, quote, C, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(code);
      expect(offerErrorMessage(r.error).length).toBeGreaterThan(5);
    }
  });
  it('requires a raise and enforces max rounds (BR-048, BR-049)', () => {
    const first = createOffer({ id: 'o1', amount: naira(2500), config: C, now: 0 });
    expect(validateOffer(naira(2500), quote, C, 1, first)).toMatchObject({ ok: false, error: { code: 'not_raised' } });
    const third = { ...first, round: C.negotiation.maxRounds };
    expect(validateOffer(naira(3000), quote, C, 1, third)).toMatchObject({ ok: false, error: { code: 'max_rounds' } });
  });
  it('rejects a first offer on an expired quote', () => {
    expect(validateOffer(naira(2500), quote, C, C.quoteTtlSeconds * 1000)).toMatchObject({ ok: false, error: { code: 'quote_expired' } });
  });
  it('steps within the range', () => {
    expect(stepOffer(quote.negotiationRange.max, 1, quote, C)).toBe(quote.negotiationRange.max);
    expect(stepOffer(quote.negotiationRange.min, -1, quote, C)).toBe(quote.negotiationRange.min);
    expect(stepOffer(naira(2500), 1, quote, C)).toBe(naira(2550));
  });
});

describe('selectableResponses', () => {
  it('filters expired and sorts by price then ETA', () => {
    const offer = createOffer({ id: 'o1', amount: naira(2500), config: C, now: 0 });
    const base = { offerId: 'o1', kind: 'counter' as const, createdAt: 0, driver: {} as never };
    const list = [
      { ...base, id: 'a', amount: naira(2700), etaSeconds: 100, expiresAt: 10_000 },
      { ...base, id: 'b', amount: naira(2600), etaSeconds: 400, expiresAt: 10_000 },
      { ...base, id: 'c', amount: naira(2600), etaSeconds: 200, expiresAt: 10_000 },
      { ...base, id: 'd', amount: naira(2500), etaSeconds: 50, expiresAt: 4_000 },
    ];
    expect(selectableResponses(list, offer, 5_000).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('validators', () => {
  it.each(['08031234567', '0803 123 4567', '+2348031234567', '2348031234567', '8031234567', '0905-123-4567'])('accepts %s', (p) => {
    expect(validateNigerianPhone(p).ok).toBe(true);
  });
  it.each(['12345', '0603 123 4567', '+447700900123', ''])('rejects %s', (p) => {
    expect(validateNigerianPhone(p).ok).toBe(false);
  });
  it('normalises and formats', () => {
    const r = validateNigerianPhone('0803 123 4567');
    expect(r).toEqual({ ok: true, value: '+2348031234567' });
    expect(formatPhone('+2348031234567')).toBe('+234 803 123 4567');
  });
  it('validates OTP, names, email, comments', () => {
    expect(validateOtp('123456').ok).toBe(true);
    expect(validateOtp('12345').ok).toBe(false);
    expect(validateName('  Adaeze  ').ok).toBe(true);
    expect(validateName("O'Neil-Okafor").ok).toBe(true);
    expect(validateName('A').ok).toBe(false);
    expect(validateName('R2D2').ok).toBe(false);
    expect(validateEmail('').ok).toBe(true);
    expect(validateEmail('a@b.co')).toEqual({ ok: true, value: 'a@b.co' });
    expect(validateEmail('nope').ok).toBe(false);
    expect(validateRatingComment('x'.repeat(301)).ok).toBe(false);
  });
  it('formats distance, duration, countdown', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(12_400)).toBe('12 km');
    expect(formatDistance(3_450)).toBe('3.5 km');
    expect(formatDuration(30)).toBe('1 min');
    expect(formatDuration(4_000)).toBe('1 h 7 min');
    expect(formatCountdown(65_001)).toBe('1:06');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

/** Manual scheduler so mock services run deterministically in tests. */
function fakeScheduler(): Scheduler & { advance(ms: number): void } {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout(id) {
      timers = timers.filter((t) => t.id !== id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.fn();
      }
      now = end;
    },
  };
}

describe('mock services', () => {
  const booking = (): Booking => ({
    id: 'b',
    mode: 'negotiate',
    status: 'negotiating',
    pickup: MOCK_PLACES[0],
    destination: MOCK_PLACES[1],
    route,
    quote,
    paymentMethod: MOCK_PAYMENT_METHODS[0],
    responses: [],
    createdAt: 0,
    updatedAt: 0,
  });

  it('emits valid negotiation responses within the range', () => {
    const scheduler = fakeScheduler();
    const services = createMockServices({ scheduler, random: seededRandom(7) });
    const offer = createOffer({ id: 'o1', amount: naira(3050), config: C, now: 0 });
    const received: number[] = [];
    services.matching.openNegotiation(booking(), offer, (e) => {
      if (e.type === 'response') {
        expect(e.response.amount).toBeGreaterThanOrEqual(offer.amount);
        expect(e.response.amount).toBeLessThanOrEqual(quote.negotiationRange.max);
        received.push(e.response.amount);
      }
    });
    scheduler.advance(60_000);
    expect(received.length).toBe(4);
  });

  it('never reports the same driver available twice (no duplicate assignment)', () => {
    const services = createMockServices({ scheduler: fakeScheduler(), random: () => 0.99 });
    expect(services.matching.isDriverAvailable('d1')).toBe(true);
    expect(services.matching.isDriverAvailable('d1')).toBe(false);
    services.matching.releaseDriver('d1');
    expect(services.matching.isDriverAvailable('d1')).toBe(true);
  });

  it('unsubscribing stops further events', () => {
    const scheduler = fakeScheduler();
    const services = createMockServices({ scheduler, random: seededRandom(3) });
    const listener = jest.fn();
    const off = services.matching.startQuickMatch(booking(), listener);
    off();
    scheduler.advance(60_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('marks simulated results', async () => {
    const scheduler = fakeScheduler();
    const services = createMockServices({ scheduler, random: seededRandom(1) });
    const p = services.maps.getRoute(MOCK_PLACES[0].coordinate, MOCK_PLACES[1].coordinate);
    scheduler.advance(5_000);
    const r = await p;
    expect(r.isSimulated).toBe(true);
    expect(r.distanceMeters).toBeGreaterThan(0);
  });
});
