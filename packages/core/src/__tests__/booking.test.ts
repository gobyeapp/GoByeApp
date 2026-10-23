import { bookingReducer, initialBookingState, type BookingState } from '../booking/machine';
import { naira } from '../money';
import { createOffer } from '../negotiation';
import { MOCK_PRICING_CONFIG as C } from '../pricing/config';
import { createQuote } from '../pricing/fare';
import { MOCK_PAYMENT_METHODS, MOCK_PLACES, makeMockDriver, seededRandom } from '../mocks/data';
import type { Booking, DriverResponse } from '../types';

const route = { distanceMeters: 10_000, durationSeconds: 1_800, polyline: [MOCK_PLACES[0].coordinate, MOCK_PLACES[1].coordinate], isSimulated: true };
const rand = seededRandom(42);

function draft(mode: Booking['mode'] = 'quick_match', now = 0): Booking {
  return {
    id: 'b1',
    mode,
    status: 'quoted',
    pickup: MOCK_PLACES[0],
    destination: MOCK_PLACES[1],
    route,
    quote: createQuote({ id: 'q1', route, category: 'go', config: C, now }),
    paymentMethod: MOCK_PAYMENT_METHODS[0],
    responses: [],
    createdAt: now,
    updatedAt: now,
  };
}

const start = (b: Booking): BookingState => bookingReducer(initialBookingState, { type: 'START', booking: b });
const driver = makeMockDriver(1, 'go', MOCK_PLACES[0].coordinate, rand);

describe('Quick Match lifecycle', () => {
  it('runs quoted → submitting → searching → matched → en route → arrived → in progress → payment → completed', () => {
    let s = start(draft());
    s = bookingReducer(s, { type: 'SUBMIT', now: 1 });
    expect(s.booking?.status).toBe('submitting');
    s = bookingReducer(s, { type: 'SEARCH_STARTED', now: 2 });
    expect(s.booking?.status).toBe('searching');
    expect(s.booking?.agreedFare).toBe(s.booking?.quote.suggested); // fare locked (BR-031)
    expect(s.booking?.fareLockedAt).toBe(2);
    s = bookingReducer(s, { type: 'DRIVER_MATCHED', driver, now: 3 });
    s = bookingReducer(s, { type: 'DRIVER_EN_ROUTE', now: 4 });
    s = bookingReducer(s, { type: 'DRIVER_ARRIVED', now: 5 });
    s = bookingReducer(s, { type: 'TRIP_STARTED', now: 6 });
    expect(s.booking?.status).toBe('in_progress');
    s = bookingReducer(s, { type: 'TRIP_COMPLETED', now: 7 });
    expect(s.booking?.status).toBe('payment_pending');
    expect(s.booking?.awaitingPaymentAction).toBe(true); // payment is a separate, later stage
    expect(bookingReducer(s, { type: 'PAYMENT_RESULT', status: 'paid', now: 8 }).error).toBe('invalid_transition'); // nothing in flight
    s = bookingReducer(s, { type: 'PAYMENT_STARTED', now: 8 });
    expect(s.booking?.paymentStatus).toBe('processing');
    expect(bookingReducer(s, { type: 'PAYMENT_STARTED', now: 8 }).error).toBe('invalid_transition'); // duplicate blocked
    // The method can't change while a payment is being confirmed.
    expect(bookingReducer(s, { type: 'SET_PAYMENT', method: MOCK_PAYMENT_METHODS[1], now: 8 }).error).toBe('invalid_transition');
    s = bookingReducer(s, { type: 'PAYMENT_RESULT', status: 'failed', now: 8 });
    expect(s.booking?.status).toBe('payment_pending');
    expect(s.booking?.paymentStatus).toBe('failed');
    s = bookingReducer(s, { type: 'SET_PAYMENT', method: MOCK_PAYMENT_METHODS[0], now: 9 });
    s = bookingReducer(s, { type: 'PAYMENT_STARTED', now: 10 });
    expect(s.booking?.paymentAttempts).toBe(2);
    s = bookingReducer(s, { type: 'PAYMENT_RESULT', status: 'paid', now: 10 });
    expect(s.booking?.status).toBe('completed');
    expect(s.error).toBeUndefined();
    // ...nor after it succeeded.
    expect(bookingReducer(s, { type: 'SET_PAYMENT', method: MOCK_PAYMENT_METHODS[1], now: 11 }).error).toBe('invalid_transition');
  });

  it('refuses to submit an expired quote (BR-022)', () => {
    const s = bookingReducer(start(draft()), { type: 'SUBMIT', now: C.quoteTtlSeconds * 1000 + 1 });
    expect(s.error).toBe('quote_expired');
    expect(s.booking?.status).toBe('quoted');
  });

  it('prevents duplicate submission (BR-033)', () => {
    let s = bookingReducer(start(draft()), { type: 'SUBMIT', now: 1 });
    s = bookingReducer(s, { type: 'SUBMIT', now: 2 });
    expect(s.error).toBe('invalid_transition');
  });

  it('handles no drivers → retry', () => {
    let s = bookingReducer(start(draft()), { type: 'SUBMIT', now: 1 });
    s = bookingReducer(s, { type: 'SEARCH_STARTED', now: 2 });
    s = bookingReducer(s, { type: 'NO_DRIVERS', now: 3 });
    expect(s.booking?.status).toBe('no_drivers');
    expect(s.booking?.agreedFare).toBeUndefined();
    s = bookingReducer(s, { type: 'RETRY', now: 4 });
    expect(s.booking?.status).toBe('quoted');
  });

  it('does not allow Quick Match counteroffers (BR-030)', () => {
    const offer = createOffer({ id: 'o', amount: naira(3000), config: C, now: 0 });
    const s = bookingReducer(start(draft('quick_match')), { type: 'OFFER_SENT', offer, now: 1 });
    expect(s.error).toBe('invalid_transition');
  });
});

describe('Negotiate lifecycle', () => {
  const offerAmount = naira(2800);
  const setup = () => {
    let s = start(draft('negotiate'));
    const offer = createOffer({ id: 'o1', amount: offerAmount, config: C, now: 1000 });
    s = bookingReducer(s, { type: 'OFFER_SENT', offer, now: 1000 });
    return { s, offer };
  };
  const response = (id: string, driverIdx: number, amount = offerAmount, at = 2000): DriverResponse => ({
    id,
    offerId: 'o1',
    driver: makeMockDriver(driverIdx, 'go', MOCK_PLACES[0].coordinate, seededRandom(driverIdx)),
    kind: amount === offerAmount ? 'accept' : 'counter',
    amount,
    etaSeconds: 300,
    createdAt: at,
    expiresAt: at + C.negotiation.responseTtlSeconds * 1000,
  });

  it('collects responses, one per driver (BR-045)', () => {
    let { s } = setup();
    const r1 = response('r1', 1);
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: r1, now: 2000 });
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: { ...response('r2', 1, naira(3000)), driver: r1.driver }, now: 2500 });
    expect(s.booking?.responses).toHaveLength(1);
    expect(s.booking?.responses[0].id).toBe('r2');
  });

  it('ignores invalid counteroffers (BR-043)', () => {
    let { s } = setup();
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('low', 2, naira(2500)), now: 2000 });
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('high', 3, naira(99999)), now: 2000 });
    expect(s.booking?.responses).toHaveLength(0);
  });

  it('rejects responses after the offer expires (BR-042)', () => {
    const { s } = setup();
    const after = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('r1', 1), now: 1000 + C.negotiation.offerTtlSeconds * 1000 });
    expect(after.error).toBe('offer_closed');
  });

  it('locks the agreed fare on selection and withdraws other responses (BR-046)', () => {
    let { s } = setup();
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('r1', 1), now: 2000 });
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('r2', 2, naira(3000)), now: 2100 });
    s = bookingReducer(s, { type: 'RESPONSE_SELECTED', responseId: 'r2', now: 3000, isDriverAvailable: () => true });
    expect(s.booking?.status).toBe('matched');
    expect(s.booking?.agreedFare).toBe(naira(3000));
    expect(s.booking?.fareLockedAt).toBe(3000);
    expect(s.booking?.responses.map((r) => r.id)).toEqual(['r2']);
  });

  it('cannot select an expired response (BR-044)', () => {
    let { s } = setup();
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('r1', 1), now: 2000 });
    s = bookingReducer(s, { type: 'RESPONSE_SELECTED', responseId: 'r1', now: 2000 + C.negotiation.responseTtlSeconds * 1000, isDriverAvailable: () => true });
    expect(s.error).toBe('expired');
    expect(s.booking?.status).toBe('negotiating');
  });

  it('removes an unavailable driver and prevents duplicate assignment (BR-047)', () => {
    let { s } = setup();
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('r1', 1), now: 2000 });
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('r2', 2), now: 2000 });
    s = bookingReducer(s, { type: 'RESPONSE_SELECTED', responseId: 'r1', now: 2500, isDriverAvailable: () => false });
    expect(s.error).toBe('driver_unavailable');
    expect(s.booking?.responses.map((r) => r.id)).toEqual(['r2']);
    expect(s.booking?.status).toBe('negotiating');
  });

  it('cannot select twice once locked', () => {
    let { s } = setup();
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('r1', 1), now: 2000 });
    s = bookingReducer(s, { type: 'RESPONSE_SELECTED', responseId: 'r1', now: 2500, isDriverAvailable: () => true });
    s = bookingReducer(s, { type: 'RESPONSE_SELECTED', responseId: 'r1', now: 2600, isDriverAvailable: () => true });
    expect(s.error).toBe('invalid_transition');
  });

  it('raising an offer withdraws responses to the previous offer', () => {
    const setupResult = setup();
    const { offer } = setupResult;
    let { s } = setupResult;
    s = bookingReducer(s, { type: 'RESPONSE_RECEIVED', response: response('r1', 1), now: 2000 });
    const raised = createOffer({ id: 'o2', amount: naira(3000), config: C, now: 5000, previous: offer });
    s = bookingReducer(s, { type: 'OFFER_SENT', offer: raised, now: 5000 });
    expect(s.booking?.responses).toHaveLength(0);
    expect(s.booking?.offer?.round).toBe(2);
  });

  it('can switch to Quick Match', () => {
    let { s } = setup();
    s = bookingReducer(s, { type: 'SWITCH_TO_QUICK_MATCH', now: 3000 });
    expect(s.booking?.mode).toBe('quick_match');
    expect(s.booking?.status).toBe('quoted');
    expect(s.booking?.offer).toBeUndefined();
  });
});

describe('cancellation (BR-080, D-019)', () => {
  it('can cancel while searching', () => {
    let s = bookingReducer(start(draft()), { type: 'SUBMIT', now: 1 });
    s = bookingReducer(s, { type: 'CANCEL', cancellation: { by: 'passenger', fee: naira(0), at: 2 } });
    expect(s.booking?.status).toBe('cancelled');
  });
  it('cannot cancel once in progress', () => {
    let s = start(draft());
    for (const e of [
      { type: 'SUBMIT', now: 1 },
      { type: 'SEARCH_STARTED', now: 2 },
      { type: 'DRIVER_MATCHED', driver, now: 3 },
      { type: 'DRIVER_ARRIVED', now: 4 },
      { type: 'TRIP_STARTED', now: 5 },
    ] as const) s = bookingReducer(s, e);
    s = bookingReducer(s, { type: 'CANCEL', cancellation: { by: 'passenger', fee: naira(0), at: 6 } });
    expect(s.error).toBe('not_cancellable');
    expect(s.booking?.status).toBe('in_progress');
  });
  it('rejects events with no booking', () => {
    expect(bookingReducer(initialBookingState, { type: 'SUBMIT', now: 1 }).error).toBe('invalid_transition');
  });
});
