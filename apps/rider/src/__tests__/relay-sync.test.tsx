import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import {
  MOCK_PLACES,
  claimRide,
  createMemoryRelay,
  createMockServices,
  createRelayMatching,
  createRelayTrips,
  seededRandom,
  type Booking,
  type DriverSummary,
  type GoByeServices,
  type RelayRide,
} from '@gobye/core';
import { applyRidePatches, remoteCancellation, ridePatches } from '@/features/relay/sync';
import { AccountProvider, useAccount } from '@/state/account';
import { BookingProvider, useBooking } from '@/state/booking';
import { ServicesProvider } from '@/state/services';

/** Demo relay (D-049): the rider's booking becomes a shared ride a driver in the driver app can take. */
type Api = { booking: ReturnType<typeof useBooking>; account: ReturnType<typeof useAccount> };
let api: Api;
function Probe() {
  api = { booking: useBooking(), account: useAccount() };
  return null;
}
const flush = async (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
async function advance(total: number, step = 250) {
  for (let t = 0; t < total; t += step) await flush(step);
}

const rider = { id: '+2348031234567', name: 'Ada Okafor', phone: '+2348031234567', rating: 5 };
const driver: DriverSummary = {
  id: '+2348030000001',
  firstName: 'Tunde',
  rating: 4.9,
  completedTrips: 12,
  vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', plate: 'KJA 123 AB', year: 2016, category: 'go' },
  coordinate: MOCK_PLACES[2].coordinate,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('rider app on the demo relay', () => {
  it('publishes a Quick Match ride; when a driver claims it the rider is matched and the PIN is shared', async () => {
    const relay = createMemoryRelay();
    const mock = createMockServices({ random: seededRandom(3), flags: { noDriversRate: 0 } });
    const services: GoByeServices = { ...mock, matching: createRelayMatching(relay, { rider: () => rider, pollMs: 1_000 }), trips: createRelayTrips(relay, { pollMs: 1_000 }) };
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
    await act(async () => {
      api.booking.setPickup(MOCK_PLACES[12]);
      api.booking.setDestination(MOCK_PLACES[4]);
    });
    const routeP = services.maps.getRoute(MOCK_PLACES[12].coordinate, MOCK_PLACES[4].coordinate);
    await advance(2000);
    const route = await routeP;
    const quotesP = services.pricing.quoteAll(route);
    await advance(2000);
    const quote = (await quotesP).find((q) => q.category === 'go')!;
    await act(async () => api.booking.start({ route, quote, mode: 'quick_match', paymentMethod: api.account.paymentMethods.find((m) => m.type === 'wallet')! }));
    await act(async () => void api.booking.submitQuickMatch());
    await advance(1_500);

    const id = api.booking.booking!.id;
    const [row] = await relay.select<RelayRide>('demo_rides', { where: { id } });
    expect(row).toMatchObject({ status: 'searching', kind: 'quick_match', rider_id: rider.id, fare: quote.suggested });

    expect(await claimRide(relay, id, driver, Date.now())).toBe(true);
    await advance(2_500);
    const b = api.booking.booking!;
    expect(b.driver?.id).toBe(driver.id);
    expect(['matched', 'driver_en_route']).toContain(b.status);

    // The PIN generated on the match goes to the shared ride (the driver checks it at pickup).
    const patches = ridePatches(null, b, Date.now());
    await applyRidePatches(relay, patches, rider, id);
    const [after] = await relay.select<RelayRide>('demo_rides', { where: { id } });
    if (b.pickupPin) expect(after.pickup_pin).toBe(b.pickupPin);
    expect(after.status).toBe('accepted');

    // The driver arriving shows up on the rider's trip.
    await relay.update<RelayRide>('demo_rides', { id }, { status: 'arrived', driver_location: { coordinate: MOCK_PLACES[12].coordinate, eta_seconds: 0, at: Date.now() + 1 } });
    await advance(2_500);
    expect(api.booking.booking!.status).toBe('driver_arrived');

    // Ended by the driver (or staff): the booking closes instead of leaving the rider waiting.
    await act(async () => api.booking.endRemotely('Driver cancelled'));
    expect(api.booking.booking).toBeNull();
  });

  it('sends the payment state and a negotiated choice once, and explains rides ended by others', () => {
    const base = { id: 'bk-1', mode: 'negotiate', status: 'matched', quote: { suggested: 300_000 }, agreedFare: 280_000, paymentMethod: { type: 'wallet', label: 'GoBye Wallet' } } as unknown as Booking;
    const chosen = { ...base, driver, pickupPin: '4821', matchedAt: 5 } as Booking;
    const first = ridePatches(base, chosen, 10);
    expect(first.map((p) => p.where)).toEqual([{ id: 'bk-1', status: 'negotiating' }, { id: 'bk-1' }]);
    expect(first[0].patch).toMatchObject({ status: 'accepted', driver_id: driver.id, agreed_fare: 280_000 });
    expect(first[1].patch).toMatchObject({ pickup_pin: '4821' });
    expect(ridePatches(chosen, chosen, 11)).toEqual([]);
    const paid = ridePatches(chosen, { ...chosen, paymentStatus: 'paid' }, 12);
    expect(paid).toHaveLength(1);
    expect(paid[0].patch.payment_status).toBe('paid');
    expect(paid[0].event?.type).toBe('ride.paid');

    expect(remoteCancellation({ status: 'cancelled', cancelled_by: 'rider', cancel_reason: null })).toBeNull();
    expect(remoteCancellation({ status: 'accepted', cancelled_by: null, cancel_reason: null })).toBeNull();
    expect(remoteCancellation({ status: 'cancelled', cancelled_by: 'driver', cancel_reason: 'Car broke down' })?.message).toContain('Your driver cancelled: Car broke down');
    expect(remoteCancellation({ status: 'cancelled', cancelled_by: 'admin', cancel_reason: null })?.by).toBe('admin');
  });
});
