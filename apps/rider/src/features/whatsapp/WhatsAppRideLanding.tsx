import { useEffect } from 'react';
import { isActive } from '@gobye/core';
import { EmptyState, Screen, ScreenHeader } from '@gobye/ui';
import { liveRoute, resetTo } from '@/features/navigation/reset';
import { useBooking } from '@/state/booking';

/**
 * Where "Open GoBye" in a WhatsApp booking lands (D-064): gobye://open/ride/<id>, opened by the
 * https://gobye.app/open/ride/<id> page. A rider has at most one open ride, so an active ride in the app
 * is the one to show. This preview runs on simulated services, so a ride created on the server through
 * WhatsApp only appears once the app talks to the real ride API; until then the screen says so.
 */
export function WhatsAppRideLanding({ rideId }: { rideId: string }) {
  const { booking } = useBooking();
  const live = booking && isActive(booking.status) ? booking.status : null;

  useEffect(() => {
    if (live) resetTo(liveRoute(live));
  }, [live]);

  if (live) return null;
  return (
    <Screen header={<ScreenHeader title="Ride booked on WhatsApp" onBack={() => resetTo('/(tabs)')} />}>
      <EmptyState
        icon="chat"
        title="We can't show this ride here yet"
        body={`Your ride (${rideId.slice(0, 8)}) was booked on WhatsApp. This version of the app uses simulated rides, so WhatsApp bookings appear here once GoBye's ride service is connected. To cancel before a driver is assigned, reply CANCEL in the WhatsApp chat.`}
        actionLabel="Back to Home"
        onAction={() => resetTo('/(tabs)')}
      />
    </Screen>
  );
}
