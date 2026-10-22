import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDistance, formatDuration, formatNaira, nairaAccessibilityLabel, type TripReceipt } from '@gobye/core';
import { Badge, Bone, Button, Divider, EmptyState, KeyValue, Screen, ScreenHeader, SkeletonCard, SkeletonGroup, SkeletonText, Text, layout, spacing, useToast } from '@gobye/ui';
import { SimulatedNote, paymentIcon } from '@/features/booking/components';
import { VehicleSummary } from '@/features/common/VehicleSummary';
import { resetTo } from '@/features/navigation/reset';
import { DetailRow, DriverHeader, Group, PaymentStatusBadge } from '@/features/trip/parts';
import { receiptStatusLabel, shareReceiptPdf } from '@/features/trip/receiptPdf';
import { useAccount } from '@/state/account';
import { useCategoryName } from '@/state/config';

const dateFmt = (ms: number) =>
  new Date(ms).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** R15 Receipt / R18 Ride detail — shared view for trip history. */
export function ReceiptView({ id, title }: { id: string; title: string }) {
  const catName = useCategoryName();
  const toast = useToast();
  const { history, ratings, ready } = useAccount();
  const [sharing, setSharing] = useState(false);
  const r: TripReceipt | undefined = history.find((h) => h.bookingId === id);
  const rating = ratings.find((x) => x.bookingId === id);
  const back = () => (router.canGoBack() ? router.back() : resetTo('/(tabs)'));

  // While trip history loads, show the receipt's shape instead of a false "not found".
  if (!r && !ready) {
    return (
      <Screen header={<ScreenHeader title={title} onBack={back} />}>
        <SkeletonGroup label="Loading receipt" style={styles.skeleton}>
          <SkeletonText lines={1} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
          <Bone height={52} radius={16} />
        </SkeletonGroup>
      </Screen>
    );
  }
  if (!r) {
    return (
      <Screen header={<ScreenHeader title={title} onBack={back} />}>
        <EmptyState icon="receipt" title="Receipt not found" body="This trip may have been removed from this device." />
      </Screen>
    );
  }
  const total = r.totalPaid ?? r.fare;

  const share = async () => {
    setSharing(true);
    try {
      await shareReceiptPdf({
        bookingId: r.bookingId,
        fare: r.fare,
        processingFee: r.processingFee,
        total,
        paymentMethod: r.paymentMethod,
        paymentStatusLabel: receiptStatusLabel(r.paymentStatus, false),
        pickup: r.pickup,
        destination: r.destination,
        driver: r.driver,
        categoryName: r.driver ? catName(r.driver.vehicle.category) : 'GoBye',
        completedAt: r.completedAt,
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
      });
    } catch {
      toast('Couldn’t create the receipt. Try again.', 'error');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen
      header={<ScreenHeader title={title} onBack={back} />}
      footer={
        <>
          <Button title="Download or share receipt" variant="secondary" size="md" leadingIcon="download" loading={sharing} onPress={share} testID="receipt-share" />
          <View style={styles.row}>
            {!rating ? (
              <Button title="Rate trip" variant="secondary" size="md" style={styles.flex} leadingIcon="star" onPress={() => router.push({ pathname: '/rate/[id]', params: { id, from: 'receipt' } })} />
            ) : null}
            <Button
              title="Report issue"
              variant="secondary"
              size="md"
              style={styles.flex}
              leadingIcon="support"
              onPress={() => router.push({ pathname: '/account/support', params: { trip: id } })}
            />
          </View>
        </>
      }
    >
      <View style={styles.body}>
        <View style={styles.header} accessible accessibilityLabel={`${dateFmt(r.completedAt)}. Total ${nairaAccessibilityLabel(total)}`}>
          <Text variant="footnote" color="textSecondary">
            {dateFmt(r.completedAt)}
          </Text>
          <Text variant="largeTitle" tabular>
            {formatNaira(total)}
          </Text>
        </View>
        <View style={styles.inline}>
          <PaymentStatusBadge status={r.paymentStatus} completed={false} />
          <Badge label={r.paymentMethod.label} icon={paymentIcon(r.paymentMethod)} />
          {rating ? <Badge label={`You rated ${rating.stars} of 5`} icon="star" /> : null}
        </View>

        <Group title="Journey">
          <DetailRow icon="pickup" label="From" value={`${r.pickup.title}, ${r.pickup.subtitle}`} iconColor="primary" />
          <DetailRow icon="flag" label="To" value={`${r.destination.title}, ${r.destination.subtitle}`} iconColor="accent" />
          <DetailRow icon="route" label="Distance · time (estimated)" value={`${formatDistance(r.distanceMeters)} · ${formatDuration(r.durationSeconds)}`} />
        </Group>

        {r.driver ? (
          <Group title="Driver and vehicle">
            <View style={styles.driver}>
              <DriverHeader driver={r.driver} />
              <VehicleSummary vehicle={r.driver.vehicle} size="sm" />
            </View>
          </Group>
        ) : null}

        <Group title="Payment">
          <KeyValue label="Trip fare" value={formatNaira(r.fare)} spoken={nairaAccessibilityLabel(r.fare)} />
          {r.processingFee > 0 ? (
            <KeyValue label={`${r.paymentMethod.label} fee (separate from fare)`} value={formatNaira(r.processingFee)} spoken={nairaAccessibilityLabel(r.processingFee)} />
          ) : null}
          <Divider />
          <KeyValue label="Total" value={formatNaira(total)} spoken={nairaAccessibilityLabel(total)} bold />
        </Group>

        <SimulatedNote text="Test trip. Not a tax invoice." />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: spacing.lg, paddingTop: spacing.md },
  flex: { flex: 1 },
  body: { gap: layout.section, paddingBottom: spacing.lg },
  header: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  inline: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  driver: { gap: spacing.md, paddingVertical: spacing.sm },
});
