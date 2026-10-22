import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { formatNaira, nairaAccessibilityLabel, paymentCharge } from '@gobye/core';
import { Button, Screen, Text, spacing, useTheme } from '@gobye/ui';
import { useConfirmBeforeBack } from '@/features/booking/useCancelRide';
import { resetTo } from '@/features/navigation/reset';
import { CompletionMark } from '@/features/trip/CompletionMark';
import { useBooking } from '@/state/booking';
import { useHaptics } from '@/state/haptics';

/**
 * End of trip, step 2 of 3: payment successful. Shown only after a verified payment (booking
 * `completed`). A green check, one line, the amount paid once, and one way on. No checkout layout.
 */
export default function TripPaid() {
  const { colors } = useTheme();
  const haptic = useHaptics();
  const reduce = useReducedMotion();
  const { booking: b } = useBooking();
  const paid = b?.status === 'completed' || b?.paymentStatus === 'paid';
  const moved = useRef(false);
  const next = () => {
    moved.current = true;
    router.replace('/trip-summary');
  };
  useConfirmBeforeBack(true, next);

  useEffect(() => {
    if (moved.current) return;
    if (!b) return void resetTo('/(tabs)');
    if (!paid) return void router.replace('/trip-complete'); // never shown before confirmation
  }, [b, paid]);
  useEffect(() => {
    haptic('success');
  }, [haptic]);

  if (!b || !paid) return null;
  const charge = paymentCharge(b.agreedFare ?? b.quote.suggested, b.paymentMethod.type);

  return (
    <Screen footer={<Button title="Continue" onPress={next} testID="payment-continue" />} scroll={false}>
      <View style={styles.center} accessible accessibilityLiveRegion="polite" accessibilityLabel={`Payment successful. ${nairaAccessibilityLabel(charge.total)} paid with ${b.paymentMethod.label}.`} testID="payment-success">
        <CompletionMark tone="success" size={88} />
        <Animated.View entering={reduce ? undefined : FadeIn.delay(180).duration(220)} style={styles.text}>
          <Text variant="title2" align="center" accessibilityRole="header">
            Payment successful
          </Text>
          <Text style={[styles.amount, { color: colors.text }]} tabular maxFontSizeMultiplier={1.3}>
            {formatNaira(charge.total)}
          </Text>
          <Text variant="subhead" color="textSecondary" align="center">
            {b.paymentMethod.label}
          </Text>
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingBottom: spacing.xxl },
  text: { alignItems: 'center', gap: spacing.xs },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 36, lineHeight: 44, letterSpacing: -0.5, marginTop: spacing.xs },
});
