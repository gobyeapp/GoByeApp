import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { formatDistance, formatDuration, formatNaira } from '@gobye/core';
import { EmptyState, KeyValue, Screen, ScreenHeader, StatusBadge, Text, layout, spacing, useTheme } from '@gobye/ui';
import { MapCanvas } from '@gobye/ui/src/map/MapCanvas';
import { PAYMENT_LABEL, formatDay, formatTime } from '@/features/common/format';
import { useDriver } from '@/state/driver';

/** D16 detail: one past trip — route, fare, payment and times. */
export default function TripDetail() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useDriver().history.find((t) => t.id === id);

  if (!trip) {
    return (
      <Screen header={<ScreenHeader onBack={() => router.back()} />}>
        <EmptyState icon="activity" title="Trip not found" />
      </Screen>
    );
  }
  const cancelled = trip.stage === 'cancelled';
  const when = trip.completedAt ?? trip.cancelledAt ?? trip.acceptedAt;

  return (
    <Screen header={<ScreenHeader title={`${formatDay(when)}, ${formatTime(when)}`} onBack={() => router.back()} />}>
      <View style={[styles.map, { backgroundColor: colors.surfaceMuted }]}>
        <MapCanvas center={trip.pickup.coordinate} pickup={trip.pickup.coordinate} destination={trip.destination.coordinate} route={trip.route.polyline} />
      </View>
      <View style={styles.head}>
        <Text style={styles.amount} tabular>
          {cancelled ? 'Cancelled' : formatNaira(trip.fare)}
        </Text>
        {cancelled ? (
          <StatusBadge kind="neutral" label={trip.cancelReason === 'rider_no_show' ? 'Rider didn’t come' : 'You cancelled'} />
        ) : (
          <StatusBadge kind={trip.paymentStatus === 'confirmed' ? 'successful' : 'pending'} label={trip.paymentStatus === 'confirmed' ? 'Received' : 'Pending'} />
        )}
      </View>
      <View style={[styles.card, { backgroundColor: colors.surfaceMuted }]}>
        <KeyValue label="Rider" value={trip.rider.firstName} />
        <KeyValue label="Pickup" value={trip.pickup.title} />
        <KeyValue label="Drop off" value={trip.destination.title} />
        <KeyValue label="Distance" value={formatDistance(trip.route.distanceMeters)} />
        <KeyValue label="Time" value={formatDuration(trip.route.durationSeconds)} />
        <KeyValue label="Booking" value={trip.kind === 'negotiate' ? 'Negotiated fare' : 'Quick Match'} />
        {!cancelled ? <KeyValue label="Payment" value={PAYMENT_LABEL[trip.paymentMethod]} /> : null}
        {!cancelled ? <KeyValue label="Commission" value="₦0 (0%)" /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: { height: 200, borderRadius: layout.cardRadius, overflow: 'hidden', marginTop: spacing.sm },
  head: { alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xl },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 36, lineHeight: 44, letterSpacing: -0.8 },
  card: { borderRadius: layout.cardRadius, padding: spacing.lg, gap: spacing.sm },
});
