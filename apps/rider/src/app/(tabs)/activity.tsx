import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nairaAccessibilityLabel, type Kobo, type PaymentStatus, type TripReceipt } from '@gobye/core';
import { SignedAmount, TxStatusBadge } from '@/features/common/Money';
import { EmptyState, Icon, SkeletonGroup, SkeletonRow, Text, layout, shadows, spacing, useTheme, type StatusKind } from '@gobye/ui';
import { liveBannerCopy, liveRoute } from '@/features/navigation/reset';
import { useAccount } from '@/state/account';
import { useBooking } from '@/state/booking';

/** Completion and payment are separate states (brief §9): every trip shows a written payment status. */
const PAY: Record<PaymentStatus, { kind: StatusKind | null; label: string }> = {
  pending: { kind: 'pending', label: 'Pending' },
  processing: { kind: 'processing', label: 'Confirming' },
  paid: { kind: null, label: 'Paid' },
  failed: { kind: 'failed', label: 'Failed' },
  reversed: { kind: 'reversed', label: 'Reversed' },
  refunded: { kind: 'reversed', label: 'Refunded' },
};

const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

/**
 * R17 Activities (wallet history reference): a contextual banner for a ride in progress, then the trip
 * history in a rounded card on a pale panel. Each row: icon, destination, time, amount and a written
 * payment status in its semantic colour.
 */
export default function Activity() {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const { history, ready } = useAccount();
  const { booking } = useBooking();
  const live = booking && booking.status !== 'quoted' && booking.status !== 'cancelled' && booking.status !== 'failed' ? booking : null;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}>
      <Text variant="title2" accessibilityRole="header" style={styles.title}>
        Activities
      </Text>

      {live ? (
        <Pressable
          onPress={() => router.push(liveRoute(live.status))}
          accessibilityRole="button"
          accessibilityLabel={`${liveBannerCopy(live, 'Ride in progress').title} to ${live.destination.title}. ${liveBannerCopy(live).action}`}
          style={({ pressed }) => [styles.banner, { backgroundColor: colors.brandBanner }, pressed && { opacity: 0.9 }]}
          testID="activities-live"
        >
          <View style={styles.flex}>
            <Text variant="headline" style={{ color: colors.onBrandBanner }}>
              {liveBannerCopy(live, 'Ride in progress').title}
            </Text>
            <Text variant="footnote" style={{ color: colors.onBrandBanner, opacity: 0.85 }} numberOfLines={1}>
              To {live.destination.title}
            </Text>
          </View>
          <View style={[styles.bannerAction, { backgroundColor: colors.onBrandBanner }]}>
            <Text variant="subhead" weight="semibold" style={{ color: colors.brandBanner }}>
              {liveBannerCopy(live).action}
            </Text>
          </View>
        </Pressable>
      ) : null}

      <View style={[styles.panel, { backgroundColor: colors.surfaceMuted }]}>
        <View style={styles.panelHead}>
          <Text variant="subhead" weight="semibold" accessibilityRole="header" style={styles.flex}>
            Trip history
          </Text>
          {ready && history.length ? (
            <Text variant="footnote" color="textSecondary">
              {history.length} {history.length === 1 ? 'trip' : 'trips'}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0 },
            scheme === 'light' && shadows.card,
          ]}
        >
          {!ready ? (
            <SkeletonGroup label="Loading your trips">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonRow key={i} avatar />
              ))}
            </SkeletonGroup>
          ) : history.length === 0 ? (
            <EmptyState icon="activity" illustration="sedan" title="No trips yet" actionLabel="Book a ride" onAction={() => router.navigate('/(tabs)')} />
          ) : (
            history.map((item, i) => <TripRow key={item.bookingId} item={item} first={i === 0} />)
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function TripRow({ item, first }: { item: TripReceipt; first: boolean }) {
  const { colors } = useTheme();
  const pay = PAY[item.paymentStatus];
  const amount = item.totalPaid || item.fare;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/ride/[id]', params: { id: item.bookingId } })}
      accessibilityRole="button"
      accessibilityLabel={`Trip to ${item.destination.title}, ${when(item.completedAt)}, ${nairaAccessibilityLabel(amount)}, ${pay.label}`}
      style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
        <Icon name="car" variant="filled" size="sm" color="text" />
        <View style={[styles.subIcon, { backgroundColor: colors.card }]}>
          <Icon name={item.paymentMethod.type === 'wallet' ? 'wallet' : 'bank'} size={11} color="textSecondary" />
        </View>
      </View>
      <View style={styles.flex}>
        <Text variant="callout" weight="medium" numberOfLines={2}>
          {item.destination.title}
        </Text>
        <Text variant="footnote" color="textSecondary">
          {when(item.completedAt)}
        </Text>
      </View>
      <View style={styles.right}>
        {/* A trip payment is money out: red with "−". Status only when it isn't a normal paid trip. */}
        <SignedAmount amount={-amount as Kobo} voided={item.paymentStatus === 'failed' || item.paymentStatus === 'reversed'} variant="callout" />
        <TxStatusBadge kind={pay.kind} label={pay.label} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: layout.page, paddingBottom: spacing.xxl, gap: spacing.lg },
  title: { paddingTop: spacing.xs },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: layout.cardRadius, padding: layout.container, minHeight: 72 },
  bannerAction: { borderRadius: 999, paddingHorizontal: spacing.md, minHeight: 34, justifyContent: 'center' },
  panel: { borderRadius: layout.sheetRadius, padding: spacing.sm, gap: spacing.xs },
  panelHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.xs },
  card: { borderRadius: layout.cardRadius, paddingHorizontal: layout.container, paddingVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 64, paddingVertical: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  subIcon: { position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  right: { alignItems: 'flex-end', gap: 2, flexShrink: 0, maxWidth: '45%' },
  struck: { textDecorationLine: 'line-through' },
});
