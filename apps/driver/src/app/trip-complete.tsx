import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDistance, formatDuration, formatNaira, nairaAccessibilityLabel } from '@gobye/core';
import { Button, CompletionMark, KeyValue, Screen, StarRating, StatusBadge, Text, layout, spacing, useTheme } from '@gobye/ui';
import { PAYMENT_LABEL } from '@/features/common/format';
import { SimNote } from '@/features/common/SimNote';
import { resetTo } from '@/features/navigation/reset';
import { useDriver } from '@/state/driver';
import { useHaptics } from '@/state/settings';

/**
 * D14 Trip complete: the fare (all of it is the driver's, 0% commission) and the payment status.
 * Payment is a separate stage (D-030): it stays "pending" until confirmed — a wallet payment is confirmed
 * by GoBye, a bank transfer by the driver checking their bank app. Never shown as paid before that.
 */
export default function TripComplete() {
  const { colors } = useTheme();
  const haptic = useHaptics();
  const d = useDriver();
  const trip = d.activeTrip;
  const [rating, setRating] = useState(0);

  useEffect(() => {
    if (!trip) resetTo('/(tabs)');
  }, [trip]);
  useEffect(() => {
    if (trip?.paymentStatus === 'confirmed') haptic('success');
  }, [trip?.paymentStatus, haptic]);

  if (!trip) return null;
  const confirmed = trip.paymentStatus === 'confirmed';
  const transfer = trip.paymentMethod === 'bank_transfer';
  const minutes = trip.startedAt && trip.completedAt ? Math.round((trip.completedAt - trip.startedAt) / 1000) : trip.route.durationSeconds;

  const done = () => {
    d.finishTrip();
    resetTo('/(tabs)');
  };

  return (
    <Screen
      footer={
        transfer && !confirmed ? (
          <>
            <Button title="I’ve received it" onPress={d.confirmPayment} testID="confirm-transfer" />
            <Button title="Not yet, finish for now" variant="tertiary" onPress={done} />
          </>
        ) : (
          <Button title="Done" onPress={done} testID="trip-done" />
        )
      }
    >
      <View style={styles.hero}>
        <CompletionMark tone={confirmed ? 'success' : 'neutral'} />
        <Text variant="title2" accessibilityRole="header">
          Trip complete
        </Text>
        <Text style={styles.amount} tabular accessibilityLabel={nairaAccessibilityLabel(trip.fare)}>
          {formatNaira(trip.fare)}
        </Text>
        <Text variant="callout" color="textSecondary" align="center">
          You keep all of it. 0% commission.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surfaceMuted }]} accessibilityLiveRegion="polite">
        <View style={styles.payHead}>
          <Text variant="headline" style={styles.flex}>
            {PAYMENT_LABEL[trip.paymentMethod]}
          </Text>
          <StatusBadge kind={confirmed ? 'successful' : 'pending'} label={confirmed ? 'Received' : 'Pending'} />
        </View>
        <Text variant="footnote" color="textSecondary">
          {confirmed
            ? transfer
              ? 'You confirmed the transfer arrived.'
              : 'Paid from the rider’s GoBye Wallet. It’s in your earnings now.'
            : transfer
              ? `${trip.rider.firstName} is sending ${formatNaira(trip.fare)} to your bank account. Check your bank app before you confirm.`
              : 'Confirming the wallet payment…'}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surfaceMuted }]}>
        <KeyValue label="Pickup" value={trip.pickup.title} />
        <KeyValue label="Drop off" value={trip.destination.title} />
        <KeyValue label="Distance" value={formatDistance(trip.route.distanceMeters)} />
        <KeyValue label="Time" value={formatDuration(minutes)} />
      </View>

      <View style={styles.rate}>
        <Text variant="subhead" weight="semibold" align="center">
          {rating ? 'Thanks for rating' : `How was ${trip.rider.firstName}?`}
        </Text>
        <StarRating value={rating} onChange={setRating} size="lg" />
      </View>
      <SimNote>Payments and ratings are simulated in this preview.</SimNote>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl, marginBottom: spacing.xl },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 44, lineHeight: 52, letterSpacing: -1 },
  card: { borderRadius: layout.cardRadius, padding: spacing.lg, gap: spacing.sm, marginBottom: spacing.md },
  payHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rate: { gap: spacing.sm, marginVertical: spacing.lg },
});
