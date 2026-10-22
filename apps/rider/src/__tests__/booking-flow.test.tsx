import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import { createMockServices, naira, seededRandom, type GoByeServices, type Kobo, type Place } from '@gobye/core';
import { AccountProvider, useAccount } from '@/state/account';
import { BookingProvider, PAYMENT_TIMEOUT_MS, useBooking } from '@/state/booking';
import { ServicesProvider } from '@/state/services';
import { MOCK_PLACES } from '@gobye/core';

/**
 * Integration: real providers + mock services under fake timers.
 * Verifies the provider wiring of the full Quick Match and Negotiate journeys.
 */
type Api = { booking: ReturnType<typeof useBooking>; account: ReturnType<typeof useAccount> };
let api: Api;
function Probe() {
  api = { booking: useBooking(), account: useAccount() };
  return null;
}

async function mount(services: GoByeServices) {
  await render(
    <ServicesProvider services={services}>
      <AccountProvider>
        <BookingProvider>
          <Probe />
        </BookingProvider>
      </AccountProvider>
    </ServicesProvider>,
  );
  await flush(10);
}

async function flush(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function advance(totalMs: number, step = 250) {
  for (let t = 0; t < totalMs; t += step) await flush(step);
}

/** Advance fake time in steps until `done()` holds (or `maxMs` passes) — tolerant of simulated latency. */
async function advanceUntil(done: () => boolean, maxMs: number, step = 250) {
  for (let t = 0; t < maxMs && !done(); t += step) await flush(step);
}

/** Top up the simulated wallet so tests don't depend on the seeded demo balance. */
async function fundWallet(services: GoByeServices, amount: Kobo) {
  const dep = services.wallet.requestDeposit(amount);
  await advance(2000);
  const { transactionId } = await dep;
  await advance(5000);
  const check = services.wallet.checkDeposit(transactionId);
  await advance(2000);
  expect(await check).toBe('successful');
}

async function prepare(services: GoByeServices, pickup: Place, destination: Place, mode: 'quick_match' | 'negotiate', method: 'wallet' | 'bank_transfer' = 'wallet') {
  await act(async () => {
    api.booking.setPickup(pickup);
    api.booking.setDestination(destination);
  });
  const routeP = services.maps.getRoute(pickup.coordinate, destination.coordinate);
  await advance(2000);
  const route = await routeP;
  const quotesP = services.pricing.quoteAll(route);
  await advance(2000);
  const quote = (await quotesP).find((q) => q.category === 'go')!;
  await act(async () => api.booking.start({ route, quote, mode, paymentMethod: api.account.paymentMethods.find((m) => m.type === method)! }));
  return quote;
}

beforeEach(async () => {
  // Each test starts with empty storage; otherwise state recovery restores the previous test's ride.
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('booking providers (mock services)', () => {
  it('runs a Quick Match ride from booking to receipt', async () => {
    const services = createMockServices({ random: seededRandom(11), flags: { noDriversRate: 0, transferNotReceivedRate: 0, locationGapRate: 0, depositFailureRate: 0 } });
    const charge = jest.spyOn(services.payments, 'charge');
    await mount(services);
    await fundWallet(services, naira(5000));
    const quote = await prepare(services, MOCK_PLACES[12], MOCK_PLACES[4], 'quick_match');

    let res: unknown;
    await act(async () => {
      res = api.booking.submitQuickMatch();
    });
    expect(res).toEqual({ ok: true, value: true });
    expect(api.booking.booking?.status).toBe('searching');
    expect(api.booking.booking?.agreedFare).toBe(quote.suggested);

    await advance(8000);
    expect(api.booking.booking?.driver).toBeDefined();
    expect(['driver_en_route', 'driver_arrived']).toContain(api.booking.booking?.status);

    // The trip feed drives arrival, boarding and completion.
    await advanceUntil(() => api.booking.booking?.status === 'driver_arrived', 40_000);
    expect(api.booking.booking?.status).toBe('driver_arrived');
    await advanceUntil(() => api.booking.booking?.status === 'in_progress', 20_000);
    expect(api.booking.booking?.status).toBe('in_progress');
    await advanceUntil(() => api.booking.booking?.status === 'payment_pending', 40_000);
    // Trip completion and payment are separate: nothing is charged until the passenger confirms.
    expect(api.booking.booking?.status).toBe('payment_pending');
    expect(api.booking.booking?.paymentStatus).toBe('pending');
    expect(api.booking.booking?.awaitingPaymentAction).toBe(true);
    expect(charge).not.toHaveBeenCalled();
    // finish() is refused while unpaid would lose the trip, so the UI only calls it once paid.

    let pay: ReturnType<Api['booking']['confirmPayment']> | undefined;
    await act(async () => {
      pay = api.booking.confirmPayment();
    });
    expect(pay).toEqual({ ok: true, value: true });
    expect(api.booking.booking?.paymentStatus).toBe('processing');
    await advance(3_000);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge.mock.calls[0][0].amount).toBe(quote.suggested);
    expect(api.booking.booking?.status).toBe('completed');
    expect(api.booking.booking?.paymentStatus).toBe('paid');

    let receipt: ReturnType<Api['booking']['finish']> = null;
    await act(async () => {
      receipt = api.booking.finish();
    });
    expect(receipt).not.toBeNull();
    expect(api.booking.booking).toBeNull();
    expect(api.account.history[0].fare).toBe(quote.suggested);
    expect(api.account.history[0].processingFee).toBe(0);
    expect(api.account.history[0].totalPaid).toBe(quote.suggested);
  }, 30_000);

  it('wallet too low: payment fails without debiting, and the passenger can switch to bank transfer', async () => {
    // A nearly empty wallet ledger (₦500), less than any trip fare.
    const lowWallet = { load: async () => [{ id: 'w-low', type: 'top_up' as const, status: 'successful' as const, amount: naira(500), createdAt: 0, description: 'Deposit' }], save: () => undefined };
    const services = createMockServices({ random: seededRandom(11), flags: { noDriversRate: 0, transferNotReceivedRate: 0, locationGapRate: 0 }, walletStore: lowWallet });
    await mount(services);
    await prepare(services, MOCK_PLACES[12], MOCK_PLACES[4], 'quick_match');
    await act(async () => void api.booking.submitQuickMatch());
    await advanceUntil(() => api.booking.booking?.status === 'payment_pending', 120_000, 500);
    await act(async () => void api.booking.confirmPayment());
    await advance(3_000);
    expect(api.booking.booking?.paymentStatus).toBe('failed');
    expect(api.booking.booking?.status).toBe('payment_pending');

    await act(async () => api.booking.choosePaymentMethod(api.account.paymentMethods.find((m) => m.type === 'bank_transfer')!));
    expect(api.booking.booking?.paymentMethod.type).toBe('bank_transfer');
    await act(async () => void api.booking.confirmPayment());
    await advance(5_000);
    expect(api.booking.booking?.status).toBe('completed');
  }, 30_000);

  it('negotiates: rejects out-of-range offers, collects responses and locks the selected fare', async () => {
    const services = createMockServices({ random: seededRandom(5), flags: { driverUnavailableRate: 0 } });
    await mount(services);
    const quote = await prepare(services, MOCK_PLACES[12], MOCK_PLACES[0], 'negotiate');

    let r: ReturnType<Api['booking']['sendOffer']> | undefined;
    await act(async () => {
      r = api.booking.sendOffer(quote.negotiationRange.max + naira(1000));
    });
    expect(r?.ok).toBe(false);

    await act(async () => {
      r = api.booking.sendOffer(quote.suggested);
    });
    expect(r).toEqual({ ok: true, value: true });
    expect(api.booking.booking?.status).toBe('negotiating');

    await advance(6000);
    const responses = api.booking.booking?.responses ?? [];
    expect(responses.length).toBeGreaterThan(0);
    const pick = responses[0];

    let sel: ReturnType<Api['booking']['selectResponse']> | undefined;
    await act(async () => {
      sel = api.booking.selectResponse(pick.id);
    });
    expect(sel).toEqual({ ok: true, value: true });
    expect(api.booking.booking?.agreedFare).toBe(pick.amount);
    expect(api.booking.booking?.driver?.id).toBe(pick.driver.id);
    expect(api.booking.booking?.fareLockedAt).toBeDefined();
  }, 30_000);

  it('cancels before match without a fee and clears the booking', async () => {
    const services = createMockServices({ random: seededRandom(2), flags: { noDriversRate: 0 } });
    await mount(services);
    await prepare(services, MOCK_PLACES[12], MOCK_PLACES[4], 'quick_match');
    await act(async () => void api.booking.submitQuickMatch());
    expect(api.booking.cancelFee()).toBe(0);
    let c: ReturnType<Api['booking']['cancel']> | undefined;
    await act(async () => {
      c = api.booking.cancel('Changed my mind');
    });
    expect(c).toEqual({ ok: true, value: true });
    expect(api.booking.booking).toBeNull();
  }, 30_000);

  it('retries after "no drivers" with a refreshed quote when the old one expired (BR-022)', async () => {
    const services = createMockServices({ random: seededRandom(9), flags: { noDriversRate: 1 } });
    await mount(services);
    const quote = await prepare(services, MOCK_PLACES[12], MOCK_PLACES[4], 'quick_match');
    await act(async () => void api.booking.submitQuickMatch());
    await advance(8000);
    expect(api.booking.booking?.status).toBe('no_drivers');

    await advance(5 * 60 * 1000, 5000); // let the quote expire
    let r: Awaited<ReturnType<Api['booking']['rebook']>> | undefined;
    await act(async () => {
      const p = api.booking.rebook('quick_match');
      jest.advanceTimersByTime(3000);
      r = await p;
    });
    expect(r).toEqual({ ok: true, value: true });
    expect(api.booking.booking?.status).toBe('searching');
    expect(api.booking.booking?.quote.id).not.toBe(quote.id);
  }, 30_000);

  it('bank transfer: "I\'ve sent the transfer" only starts verification; paid once confirmed, no fee added', async () => {
    // A nearly empty wallet ledger (₦500), less than any trip fare.
    const lowWallet = { load: async () => [{ id: 'w-low', type: 'top_up' as const, status: 'successful' as const, amount: naira(500), createdAt: 0, description: 'Deposit' }], save: () => undefined };
    const services = createMockServices({ random: seededRandom(11), flags: { noDriversRate: 0, transferNotReceivedRate: 0, locationGapRate: 0 }, walletStore: lowWallet });
    const charge = jest.spyOn(services.payments, 'charge');
    await mount(services);
    const quote = await prepare(services, MOCK_PLACES[12], MOCK_PLACES[4], 'quick_match', 'bank_transfer');
    await act(async () => void api.booking.submitQuickMatch());
    await advanceUntil(() => api.booking.booking?.status === 'payment_pending', 120_000, 500);
    expect(api.booking.booking?.status).toBe('payment_pending');
    expect(api.booking.booking?.awaitingPaymentAction).toBe(true);
    expect(charge).not.toHaveBeenCalled();

    await act(async () => void api.booking.confirmPayment());
    // Verification is in flight: never "paid" yet.
    expect(api.booking.booking?.paymentStatus).toBe('processing');
    expect(api.booking.booking?.status).toBe('payment_pending');
    await advance(5_000);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge.mock.calls[0][0].amount).toBe(quote.suggested);
    expect(api.booking.booking?.status).toBe('completed');

    let receipt: ReturnType<Api['booking']['finish']> = null;
    await act(async () => {
      receipt = api.booking.finish();
    });
    expect(receipt!.fare).toBe(quote.suggested);
    expect(receipt!.processingFee).toBe(0);
    expect(receipt!.totalPaid).toBe(quote.suggested);
    expect(receipt!.paymentStatus).toBe('paid');
  }, 30_000);

  it('bank transfer not received: stays pending (not failed), can be checked again, and a duplicate confirm while processing is rejected', async () => {
    const services = createMockServices({ random: seededRandom(11), flags: { noDriversRate: 0, transferNotReceivedRate: 1, locationGapRate: 0 } });
    const charge = jest.spyOn(services.payments, 'charge');
    await mount(services);
    await prepare(services, MOCK_PLACES[12], MOCK_PLACES[4], 'quick_match', 'bank_transfer');
    await act(async () => void api.booking.submitQuickMatch());
    await advanceUntil(() => api.booking.booking?.status === 'payment_pending', 120_000, 500);
    expect(api.booking.booking?.status).toBe('payment_pending');

    let first: ReturnType<Api['booking']['confirmPayment']> | undefined;
    let second: ReturnType<Api['booking']['confirmPayment']> | undefined;
    await act(async () => {
      first = api.booking.confirmPayment();
      second = api.booking.confirmPayment();
    });
    expect(first).toEqual({ ok: true, value: true });
    expect(second?.ok).toBe(false);
    expect(api.booking.booking?.paymentAttempts).toBe(1);

    await advance(5_000);
    expect(charge).toHaveBeenCalledTimes(1);
    // Not seen yet is pending, never "failed" or "paid" (brief §9).
    expect(api.booking.booking?.paymentStatus).toBe('pending');
    expect(api.booking.booking?.paymentNotice).toBe('transfer_not_received');
    expect(api.booking.booking?.status).toBe('payment_pending');

    // Checking again is allowed and uses a new attempt.
    let retry: ReturnType<Api['booking']['confirmPayment']> | undefined;
    await act(async () => {
      retry = api.booking.confirmPayment();
    });
    expect(retry).toEqual({ ok: true, value: true });
    expect(api.booking.booking?.paymentAttempts).toBe(2);
    await advance(5_000);
    expect(charge).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('a payment request that never answers becomes "pending, not confirmed" (not failed) and can be checked again', async () => {
    const services = createMockServices({ random: seededRandom(11), flags: { noDriversRate: 0, locationGapRate: 0 } });
    await mount(services);
    await prepare(services, MOCK_PLACES[12], MOCK_PLACES[4], 'quick_match', 'bank_transfer');
    await act(async () => void api.booking.submitQuickMatch());
    await advanceUntil(() => api.booking.booking?.status === 'payment_pending', 120_000, 500);
    const charge = jest.spyOn(services.payments, 'charge').mockImplementationOnce(() => new Promise(() => undefined));
    await act(async () => void api.booking.confirmPayment());
    await advance(PAYMENT_TIMEOUT_MS + 500, 500);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(api.booking.booking?.status).toBe('payment_pending');
    expect(api.booking.booking?.paymentStatus).toBe('pending');
    expect(api.booking.booking?.paymentNotice).toBe('not_confirmed');
    let retry: ReturnType<Api['booking']['confirmPayment']> | undefined;
    await act(async () => {
      retry = api.booking.confirmPayment();
    });
    expect(retry).toEqual({ ok: true, value: true });
    await advance(5_000);
    expect(charge).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('restores an active ride after the app restarts (state recovery)', async () => {
    const services = createMockServices({ random: seededRandom(4), flags: { noDriversRate: 0 } });
    await mount(services);
    await prepare(services, MOCK_PLACES[12], MOCK_PLACES[4], 'quick_match');
    await act(async () => void api.booking.submitQuickMatch());
    await flush(50);
    const id = api.booking.booking?.id;
    expect(api.booking.booking?.status).toBe('searching');

    // Simulate a cold start: fresh providers reading persisted storage.
    await mount(createMockServices({ random: seededRandom(5), flags: { noDriversRate: 0 } }));
    await flush(50);
    expect(api.booking.hydrated).toBe(true);
    expect(api.booking.booking?.id).toBe(id);
    expect(api.booking.booking?.status).toBe('searching');
    // The search resumes and matches.
    await advance(8000);
    expect(api.booking.booking?.driver).toBeDefined();
  }, 30_000);
});
