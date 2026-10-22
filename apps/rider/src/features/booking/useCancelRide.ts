import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Alert, BackHandler } from 'react-native';
import { formatNaira } from '@gobye/core';
import { useToast } from '@gobye/ui';
import { resetTo } from '@/features/navigation/reset';
import { useBooking } from '@/state/booking';

/**
 * Cancel-ride confirmation (BR-080/081, decision D-018: "Keep ride" / "Cancel ride").
 * The fee, if any, is shown before the passenger confirms.
 */
export function useCancelRide() {
  const booking = useBooking();
  const toast = useToast();
  const latest = useRef(booking);
  latest.current = booking;

  return useCallback(() => {
    const fee = latest.current.cancelFee();
    Alert.alert(
      'Cancel this ride?',
      fee > 0 ? `A ${formatNaira(fee)} cancellation fee applies. Not charged in this preview.` : 'Free to cancel now.',
      [
        { text: 'Keep ride', style: 'cancel' },
        {
          text: 'Cancel ride',
          style: 'destructive',
          onPress: () => {
            const r = latest.current.cancel();
            if (!r.ok) return toast(r.error, 'error');
            toast('Ride cancelled', 'info');
            resetTo('/(tabs)');
          },
        },
      ],
    );
  }, [toast]);
}

/**
 * Android system back: run `onBack` instead of silently leaving an active booking.
 * The handler is kept in a ref so it is registered once per focus, not on every render.
 */
export function useConfirmBeforeBack(enabled: boolean, onBack: () => void) {
  const handler = useRef(onBack);
  handler.current = onBack;
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        handler.current();
        return true;
      });
      return () => sub.remove();
    }, [enabled]),
  );
}
