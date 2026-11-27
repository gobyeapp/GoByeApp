import { router } from 'expo-router';
import type { Place, TripReceipt } from '@gobye/core';
import { useToast } from '@gobye/ui';
import { useBooking } from '@/state/booking';

/**
 * Book a past trip again (D-096): the same pickup and destination, or the way back. It only fills in the
 * two places and opens the ride options, so the fare is always a fresh quote, never the old price.
 * One trip at a time: a ride in progress or an unpaid trip comes first.
 */
export function useBookAgain() {
  const { booking, setPickup, setDestination, finish } = useBooking();
  const toast = useToast();
  return (trip: Pick<TripReceipt, 'pickup' | 'destination'>, opts: { reverse?: boolean } = {}) => {
    const live = booking && booking.status !== 'quoted' && booking.status !== 'cancelled' && booking.status !== 'failed' ? booking : null;
    if (live?.status === 'payment_pending') {
      toast('Pay for your last trip first.', 'info');
      router.push('/trip-complete');
      return;
    }
    if (live && live.status !== 'completed') {
      toast('You already have a ride in progress.', 'info');
      return;
    }
    // A paid trip whose summary was never closed is recorded before the next booking starts.
    if (live?.status === 'completed') finish();
    const from: Place = opts.reverse ? trip.destination : trip.pickup;
    const to: Place = opts.reverse ? trip.pickup : trip.destination;
    setPickup(from);
    setDestination(to);
    router.push('/booking/options');
  };
}
