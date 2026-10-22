import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MOCK_PLACES, createMockServices, seededRandom, type GoByeServices } from '@gobye/core';
import { ToastProvider } from '@gobye/ui';
import TripComplete from '@/app/trip-complete';
import { AccountProvider, useAccount } from '@/state/account';
import { BookingProvider, useBooking } from '@/state/booking';
import { ServiceConfigProvider } from '@/state/config';
import { ServicesProvider } from '@/state/services';
import { WalletProvider } from '@/state/wallet';

/**
 * Screen-level checks for the payment confirmation states on "Trip completed" (2026-10-21 audit):
 * a transfer the passenger says they sent is never presented as unpaid, its details stay reachable,
 * and switching method asks first (double-payment guard).
 */
const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, canDismiss: () => false, dismissAll: jest.fn() };
jest.mock('expo-router', () => ({ router: mockRouter, useFocusEffect: () => undefined }));

type Api = { booking: ReturnType<typeof useBooking>; account: ReturnType<typeof useAccount> };
let api: Api;
function Probe() {
  api = { booking: useBooking(), account: useAccount() };
  return null;
}

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
/** Shows the screen once the trip has reached the payment stage (providers stay mounted). */
let showScreen: (v: boolean) => void = () => undefined;
function Gate() {
  const [show, setShow] = useState(false);
  showScreen = setShow;
  return show ? <TripComplete /> : null;
}

function Shell({ services }: { services: GoByeServices }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ServicesProvider services={services}>
        <ServiceConfigProvider>
          <WalletProvider>
            <AccountProvider>
              <BookingProvider>
                <ToastProvider>
                  <Probe />
                  <Gate />
                </ToastProvider>
              </BookingProvider>
            </AccountProvider>
          </WalletProvider>
        </ServiceConfigProvider>
      </ServicesProvider>
    </SafeAreaProvider>
  );
}

async function flush(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}
async function advanceUntil(done: () => boolean, maxMs: number, step = 500) {
  for (let t = 0; t < maxMs && !done(); t += step) await flush(step);
}

/** Books and completes a trip paid by bank transfer, ending on the payment stage. */
async function toPaymentStage(services: GoByeServices) {
  await render(<Shell services={services} />);
  await advanceUntil(() => api.booking.hydrated, 5000, 50);
  expect(api.booking.booking).toBeNull();
  await act(async () => {
    api.booking.setPickup(MOCK_PLACES[12]);
    api.booking.setDestination(MOCK_PLACES[4]);
  });
  const routeP = services.maps.getRoute(MOCK_PLACES[12].coordinate, MOCK_PLACES[4].coordinate);
  await flush(2000);
  const route = await routeP;
  const quotesP = services.pricing.quoteAll(route);
  await flush(2000);
  const quote = (await quotesP).find((q) => q.category === 'go')!;
  await act(async () => api.booking.start({ route, quote, mode: 'quick_match', paymentMethod: api.account.paymentMethods.find((m) => m.type === 'bank_transfer')! }));
  await act(async () => void api.booking.submitQuickMatch());
  await advanceUntil(() => api.booking.booking?.status === 'payment_pending', 150_000);
  expect(api.booking.booking?.status).toBe('payment_pending');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
  Object.values(mockRouter).forEach((f) => typeof f === 'function' && 'mockClear' in f && (f as jest.Mock).mockClear());
});
afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await AsyncStorage.clear();
});

describe('Trip completed: payment confirmation states', () => {
  it('transfer not received: Check again, details reachable, "Check later", and switching method asks first', async () => {
    const services = createMockServices({ random: seededRandom(11), flags: { noDriversRate: 0, transferNotReceivedRate: 1, locationGapRate: 0 } });
    await toPaymentStage(services);
    await act(async () => showScreen(true));
    await flush(500);

    // Before paying: one amount-led action and "Pay later".
    expect(screen.getByTestId('open-transfer')).toBeTruthy();
    expect(screen.getByText('Pay later')).toBeTruthy();

    // "I've transferred" starts a check; the simulated bank hasn't seen it.
    await act(async () => void api.booking.confirmPayment());
    await flush(5000);
    expect(api.booking.booking?.paymentStatus).toBe('pending');
    expect(api.booking.booking?.paymentNotice).toBe('transfer_not_received');

    // Never "Pay" again (that invites a second transfer): Check again, with the details one tap away.
    expect(screen.queryByTestId('open-transfer')).toBeNull();
    expect(screen.getByTestId('check-transfer')).toBeTruthy();
    expect(screen.getByTestId('transfer-details')).toBeTruthy();
    expect(screen.getByText('Check later')).toBeTruthy();

    // Switching to the wallet now could double-charge: it asks, and "Keep" leaves the method alone.
    fireEvent.press(screen.getByTestId('change-method'));
    await flush(300);
    fireEvent.press(screen.getByTestId('method-wallet'));
    expect(await screen.findByText('Already sent the transfer?')).toBeTruthy();
    fireEvent.press(screen.getByTestId('switch-keep'));
    await flush(300);
    expect(api.booking.booking?.paymentMethod.type).toBe('bank_transfer');
  }, 60_000);
});
