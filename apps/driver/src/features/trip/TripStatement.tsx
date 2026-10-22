import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { formatDistance, formatDuration, formatNaira, nairaAccessibilityLabel, receiptReference, type DriverTrip } from '@gobye/core';
import {
  Avatar,
  BRAND_NAME,
  BrandMark,
  Button,
  EmptyState,
  Icon,
  Screen,
  ScreenHeader,
  SimulatedBadge,
  StatusBadge,
  Text,
  brand,
  layout,
  shadows,
  spacing,
  useTheme,
  useToast,
  type StatusKind,
} from '@gobye/ui';
import { PAYMENT_LABEL, formatTime } from '@/features/common/format';
import { resetTo } from '@/features/navigation/reset';
import { useHaptics } from '@/state/settings';

const dateLong = (ms: number) => new Date(ms).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const PAYMENT: Record<DriverTrip['paymentStatus'], { kind: StatusKind; label: string }> = {
  confirmed: { kind: 'successful', label: 'Received' },
  pending: { kind: 'pending', label: 'Pending' },
  not_due: { kind: 'neutral', label: 'Not due' },
};

const CANCEL_LABEL: Record<string, string> = { rider_no_show: 'Rider didn’t come', driver_cancelled: 'You cancelled', rider_cancelled: 'Rider cancelled', admin_cancelled: 'Cancelled by GoBye support' };

/**
 * D16 Trip detail as a branded earnings statement, matching the rider's receipt: aubergine band with the
 * mark, what the driver earned and whether the rider's payment has arrived, a perforation, the journey
 * as a timeline (ink pickup, tangerine drop-off), trip facts, the rider, the fare with GoBye's ₦0
 * commission, and a copyable reference. A cancelled trip shows why, without money lines.
 */
export function TripStatement({ trip }: { trip: DriverTrip | undefined }) {
  const { colors, scheme } = useTheme();
  const reduce = useReducedMotion();
  const toast = useToast();
  const haptic = useHaptics();
  const back = () => (router.canGoBack() ? router.back() : resetTo('/(tabs)/trips'));

  if (!trip) {
    return (
      <Screen header={<ScreenHeader title="Trip" onBack={back} />}>
        <EmptyState icon="activity" title="Trip not found" body="This trip may have been removed from this device." />
      </Screen>
    );
  }

  const cancelled = trip.stage === 'cancelled';
  const when = trip.completedAt ?? trip.cancelledAt ?? trip.acceptedAt;
  const ref = receiptReference(trip.id);
  const pay = PAYMENT[trip.paymentStatus];
  const method = PAYMENT_LABEL[trip.paymentMethod];
  const booking = trip.kind === 'negotiate' ? 'Negotiated' : 'Quick Match';

  const copyRef = async () => {
    await Clipboard.setStringAsync(ref).catch(() => undefined);
    haptic('selection');
    toast('Reference copied', 'success');
  };
  const help = () => Linking.openURL(`mailto:support@gobye.app?subject=${encodeURIComponent(`Driver trip ${ref}`)}`).catch(() => router.push('/account/support'));

  return (
    <Screen header={<ScreenHeader title="Trip" onBack={back} />} footer={<Button title="Get help with this trip" variant="secondary" leadingIcon="support" onPress={help} testID="statement-help" />}>
      <Animated.View
        entering={reduce ? undefined : FadeInDown.duration(320)}
        style={[styles.ticket, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }, scheme === 'light' && shadows.card]}
        testID="trip-statement"
      >
        <View style={[styles.band, { backgroundColor: colors.brandBanner }]}>
          <View style={styles.bandTop}>
            <View style={styles.brandRow} accessible accessibilityLabel={`${BRAND_NAME} Driver trip statement`}>
              <BrandMark size={26} inverse />
              <Text variant="headline" style={{ color: colors.onBrandBanner }}>
                {BRAND_NAME}
              </Text>
            </View>
            <Text variant="caption" style={[styles.bandLabel, { color: colors.onBrandBanner }]}>
              {cancelled ? 'CANCELLED TRIP' : 'TRIP EARNINGS'}
            </Text>
          </View>
          <Text variant="footnote" style={{ color: colors.onBrandBanner, opacity: 0.8 }}>
            {dateLong(when)}
          </Text>
        </View>

        {cancelled ? (
          <View style={styles.amountBlock} accessible accessibilityLabel={`Cancelled. ${CANCEL_LABEL[trip.cancelReason ?? ''] ?? 'Trip cancelled'}`}>
            <Text style={[styles.amount, { color: colors.text }]}>Cancelled</Text>
            <StatusBadge kind="neutral" label={CANCEL_LABEL[trip.cancelReason ?? ''] ?? 'Trip cancelled'} />
          </View>
        ) : (
          <View style={styles.amountBlock} accessible accessibilityLabel={`You earned ${nairaAccessibilityLabel(trip.fare)}, ${pay.label}, ${method}`}>
            <Text variant="footnote" color="textSecondary">
              You earned
            </Text>
            <Text style={[styles.amount, { color: colors.text }]} tabular testID="statement-amount">
              {formatNaira(trip.fare)}
            </Text>
            <View style={styles.inline}>
              <StatusBadge kind={pay.kind} label={pay.label} />
              <View style={[styles.methodPill, { backgroundColor: colors.surfaceMuted }]}>
                <Icon name={trip.paymentMethod === 'wallet' ? 'wallet' : trip.paymentMethod === 'cash' ? 'coin' : 'bank'} size={14} color="textSecondary" />
                <Text variant="caption" color="textSecondary">
                  {method}
                </Text>
              </View>
            </View>
          </View>
        )}

        <TearLine />

        <View style={styles.section}>
          <Stop dot={colors.text} time={formatTime(trip.startedAt ?? trip.acceptedAt)} title={trip.pickup.title} subtitle={trip.pickup.subtitle} label="Pickup" />
          <View style={[styles.rail, { backgroundColor: colors.border }]} />
          <Stop dot={brand.tangerine} time={trip.completedAt ? formatTime(trip.completedAt) : '–'} title={trip.destination.title} subtitle={trip.destination.subtitle} label="Drop-off" last />
        </View>

        <View style={[styles.facts, { borderColor: colors.border }]}>
          <Fact label="Distance" value={formatDistance(trip.route.distanceMeters)} />
          <View style={[styles.factSep, { backgroundColor: colors.border }]} />
          <Fact label="Duration" value={formatDuration(trip.route.durationSeconds)} />
          <View style={[styles.factSep, { backgroundColor: colors.border }]} />
          <Fact label="Booking" value={booking} />
        </View>

        <View style={[styles.rider, { borderColor: colors.border }]} accessible accessibilityLabel={`Rider ${trip.rider.firstName}, rated ${trip.rider.rating.toFixed(1)}`}>
          <Avatar uri={trip.rider.photoUrl} name={trip.rider.firstName} size={44} />
          <View style={styles.flex}>
            <Text variant="callout" weight="semibold">
              {trip.rider.firstName}
            </Text>
            <View style={styles.meta}>
              <Icon name="star" variant="filled" size={12} color="accent" />
              <Text variant="caption" weight="regular" color="textSecondary">
                {trip.rider.rating.toFixed(1)} · {trip.rider.completedTrips} trips
              </Text>
            </View>
          </View>
        </View>

        {!cancelled ? (
          <View style={styles.section}>
            <Line label={trip.kind === 'negotiate' ? 'Agreed fare' : 'Trip fare'} value={formatNaira(trip.fare)} spoken={nairaAccessibilityLabel(trip.fare)} />
            <Line label="GoBye commission" value="₦0" spoken="zero naira" hint="0% on every trip" />
            <View style={[styles.totalRule, { backgroundColor: colors.border }]} />
            <Line label="You keep" value={formatNaira(trip.fare)} spoken={nairaAccessibilityLabel(trip.fare)} strong />
            <View style={[styles.commission, { backgroundColor: colors.surfaceMuted }]}>
              <Icon name="heart" variant="filled" size={14} color={brand.tangerine} />
              <Text variant="caption" weight="regular" color="textSecondary" style={styles.flex}>
                {trip.paymentStatus === 'confirmed' ? 'The rider’s payment is confirmed. It’s all yours.' : 'We’ll mark this received once the rider’s payment is confirmed.'}
              </Text>
            </View>
          </View>
        ) : null}

        <TearLine />

        <Pressable onPress={copyRef} accessibilityRole="button" accessibilityLabel={`Reference ${ref.split('').join(' ')}. Copy`} style={({ pressed }) => [styles.refRow, pressed && { opacity: 0.6 }]} testID="statement-ref">
          <View style={styles.flex}>
            <Text variant="caption" color="textSecondary">
              Reference
            </Text>
            <Text variant="callout" weight="semibold" tabular style={styles.ref}>
              {ref}
            </Text>
          </View>
          <View style={[styles.copy, { backgroundColor: colors.surfaceMuted }]}>
            <Icon name="copy" size={16} color="text" />
          </View>
        </Pressable>
      </Animated.View>

      <View style={styles.note}>
        <SimulatedBadge />
        <Text variant="footnote" color="textSecondary" style={styles.flex}>
          Test trip and payment. Not a tax document.
        </Text>
      </View>
    </Screen>
  );
}

function TearLine() {
  const { colors } = useTheme();
  return (
    <View style={styles.tear} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.notch, styles.notchLeft, { backgroundColor: colors.background }]} />
      <View style={[styles.dash, { borderColor: colors.border }]} />
      <View style={[styles.notch, styles.notchRight, { backgroundColor: colors.background }]} />
    </View>
  );
}

function Stop({ dot, time, title, subtitle, label, last }: { dot: string; time: string; title: string; subtitle: string; label: string; last?: boolean }) {
  return (
    <View style={styles.stop} accessible accessibilityLabel={`${label} at ${time}: ${title}, ${subtitle}`}>
      <View style={[styles.dot, last ? styles.dotSquare : null, { backgroundColor: dot }]} />
      <View style={styles.flex}>
        <Text variant="callout" weight="semibold" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" weight="regular" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text variant="caption" color="textSecondary" tabular>
        {time}
      </Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text variant="caption" weight="regular" color="textSecondary">
        {label}
      </Text>
      <Text variant="subhead" weight="semibold" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Line({ label, value, hint, strong, spoken }: { label: string; value: string; hint?: string; strong?: boolean; spoken?: string }) {
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}, ${spoken ?? value}`}>
      <View style={styles.flex}>
        <Text variant={strong ? 'headline' : 'callout'} color={strong ? 'text' : 'textSecondary'}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" weight="regular" color="textSecondary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Text variant={strong ? 'title3' : 'callout'} weight={strong ? 'bold' : 'medium'} tabular>
        {value}
      </Text>
    </View>
  );
}

const NOTCH = 18;

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ticket: { borderRadius: layout.sheetRadius, overflow: 'hidden', marginTop: spacing.sm },
  band: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xs },
  bandTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bandLabel: { letterSpacing: 1.2, opacity: 0.85 },
  amountBlock: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 40, lineHeight: 48, letterSpacing: -1 },
  methodPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 999 },
  tear: { height: NOTCH, justifyContent: 'center' },
  dash: { marginHorizontal: NOTCH, borderTopWidth: 1.5, borderStyle: 'dashed' },
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, top: 0 },
  notchLeft: { left: -NOTCH / 2 },
  notchRight: { right: -NOTCH / 2 },
  section: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.sm },
  stop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  dotSquare: { borderRadius: 2 },
  rail: { width: 2, height: 18, marginLeft: 4, marginVertical: -2, borderRadius: 1 },
  facts: { flexDirection: 'row', marginHorizontal: spacing.xl, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  fact: { flex: 1, gap: 2 },
  factSep: { width: StyleSheet.hairlineWidth, marginHorizontal: spacing.md },
  rider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  totalRule: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  commission: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: layout.controlRadius, marginTop: spacing.sm },
  refRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  ref: { letterSpacing: 1 },
  copy: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
});
