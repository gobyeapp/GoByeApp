import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Share } from 'react-native';
import { formatNaira, QUICK_REPLIES } from '@gobye/core';
import { ChatSheet, useToast } from '@gobye/ui';
import { useRideChat } from '@/features/trip/useRideChat';
import { useCancelRide, useConfirmBeforeBack } from '@/features/booking/useCancelRide';
import { resetTo } from '@/features/navigation/reset';
import { ApproachView } from '@/features/trip/ApproachView';
import { HelpSheet } from '@/features/trip/HelpSheet';
import { InTripView } from '@/features/trip/InTripView';
import { useBooking } from '@/state/booking';
import { useCategoryName } from '@/state/config';
import { useHaptics } from '@/state/haptics';
import { useSession } from '@/state/session';
import { useNow } from '@/state/useNow';

/**
 * R13 — Driver found / approaching / arrived (brief 2026-10-21 §5, §7) → trip in progress (§6).
 * Layout lives in features/trip; this route owns navigation, feedback and the Help sheet.
 */
export default function Trip() {
  const toast = useToast();
  const haptic = useHaptics();
  const booking = useBooking();
  const catName = useCategoryName();
  const { user } = useSession();
  const b = booking.booking;
  const now = useNow(1000);
  const cancel = useCancelRide();
  const lastStatus = useRef(b?.status);
  const [helpOpen, setHelpOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatOpenRef = useRef(false);
  chatOpenRef.current = chatOpen;
  const driverName = b?.driver?.firstName ?? 'Driver';
  // A message that arrives while the conversation is closed shows as a notice; tapping Message opens it.
  const chat = useRideChat(b?.driver ? b.id : null, 'rider', (text) => {
    if (chatOpenRef.current) return;
    haptic('selection');
    toast(`${driverName}: ${text}`, 'info');
  });

  const beforePickup = b?.status === 'matched' || b?.status === 'driver_en_route' || b?.status === 'driver_arrived';
  // Back: offer cancellation before pickup; once on board, go Home (the ride continues and is reachable
  // from the Home banner and Activities).
  useConfirmBeforeBack(true, () => (beforePickup ? cancel() : resetTo('/(tabs)')));

  useEffect(() => {
    if (!b) return void resetTo('/(tabs)');
    // Trip completion and payment are separate: the completion screen handles both.
    if (b.status === 'payment_pending' || b.status === 'completed') return void resetTo('/trip-complete');
    if (lastStatus.current !== b.status) {
      if (b.status === 'driver_arrived') {
        haptic('success');
        toast('Your driver has arrived', 'success');
      } else if (b.status === 'in_progress') toast('Trip started', 'info');
      lastStatus.current = b.status;
    }
  }, [b, haptic, toast]);

  if (!b || !b.driver) return null;
  const d = b.driver;
  const inProgress = b.status === 'in_progress';
  const fare = b.agreedFare ?? b.quote.suggested;

  const shareTrip = () =>
    Share.share({
      message: `I'm riding with GoBye (preview): ${d.firstName}, ${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model} (${d.vehicle.plate}), from ${b.pickup.title} to ${b.destination.title}.`,
    }).catch(() => undefined);

  const emergency = () => {
    setHelpOpen(false);
    Alert.alert('Call emergency services?', 'Your phone will call 112.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Call 112', style: 'destructive', onPress: () => Linking.openURL('tel:112').catch(() => toast('Could not start the call', 'error')) },
    ]);
  };

  return (
    <>
      {inProgress ? (
        <InTripView b={b} now={now} onShare={shareTrip} onHelp={() => setHelpOpen(true)} onEmergency={emergency} />
      ) : (
        <ApproachView
          b={b}
          now={now}
          pickupAvatarUri={b.rider ? null : (user?.photoUri ?? null)}
          pickupName={b.rider?.name ?? user?.firstName}
          categoryName={catName(b.quote.category)}
          onBack={() => resetTo('/(tabs)')}
          onMessage={() => (chat.available ? setChatOpen(true) : toast('Messages work when you’re matched with a real driver', 'info'))}
          onCall={() => toast('Calls aren’t connected yet. Message your driver instead.', 'info')}
          onHelp={() => setHelpOpen(true)}
          onCancel={cancel}
        />
      )}

      <ChatSheet visible={chatOpen} onClose={() => setChatOpen(false)} title={driverName} note="Your phone numbers stay private." messages={chat.bubbles} quickReplies={QUICK_REPLIES.rider} onSend={chat.send} />

      <HelpSheet
        visible={helpOpen}
        onClose={() => setHelpOpen(false)}
        inProgress={inProgress}
        fareText={formatNaira(fare)}
        onSafety={emergency}
        onSafetyCentre={() => {
          setHelpOpen(false);
          router.push('/account/safety');
        }}
        onReport={() => {
          setHelpOpen(false);
          router.push('/account/support');
        }}
        onEndHere={() => {
          setHelpOpen(false);
          toast(`Request sent to ${d.firstName} (simulated)`, 'info');
        }}
      />
    </>
  );
}
