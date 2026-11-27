import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { PAYMENT_METHOD_LABELS, formatDistance, formatDuration, formatNaira, nairaAccessibilityLabel, receiptReference, receiptTimes, type TripReceipt } from '@gobye/core';
import {
  BRAND_NAME,
  Avatar,
  BrandMark,
  Bone,
  Button,
  EmptyState,
  Icon,
  Screen,
  ScreenHeader,
  SkeletonCard,
  SkeletonGroup,
  SkeletonText,
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
import { useBookAgain } from '@/features/booking/useBookAgain';
import { resetTo } from '@/features/navigation/reset';
import { receiptStatusLabel, shareReceiptPdf } from '@/features/trip/receiptPdf';
import { useAccount } from '@/state/account';
import { useCategoryName } from '@/state/config';
import { useHaptics } from '@/state/haptics';

const dateLong = (ms: number) => new Date(ms).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const time = (ms: number) => new Date(ms).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

const STATUS: Record<TripReceipt['paymentStatus'], { kind: StatusKind; label: string }> = {
  paid: { kind: 'successful', label: 'Paid' },
  pending: { kind: 'pending', label: 'Pending' },
  processing: { kind: 'processing', label: 'Confirming' },
  failed: { kind: 'failed', label: 'Payment failed' },
  reversed: { kind: 'reversed', label: 'Reversed' },
  refunded: { kind: 'reversed', label: 'Refunded' },
};

/**
 * R15 Receipt / R18 Ride detail. A branded ticket: an aubergine header with the mark (brand banner
 * token), the amount and payment status, a perforated tear line, the journey as a timeline (ink pickup,
 * tangerine drop-off), trip facts, driver and vehicle, the fare breakdown with the 0% commission note,
 * and a copyable reference. The PDF from "Share receipt" uses the same design.
 */
export function ReceiptView({ id, title }: { id: string; title: string }) {
  const { colors, scheme } = useTheme();
  const reduce = useReducedMotion();
  const catName = useCategoryName();
  const toast = useToast();
  const haptic = useHaptics();
  const { history, ratings, ready } = useAccount();
  const [sharing, setSharing] = useState(false);
  const bookAgain = useBookAgain();
  const r: TripReceipt | undefined = history.find((h) => h.bookingId === id);
  const rating = ratings.find((x) => x.bookingId === id);
  const back = () => (router.canGoBack() ? router.back() : resetTo('/(tabs)'));

  // While trip history loads, show the receipt's shape instead of a false "not found".
  if (!r && !ready) {
    return (
      <Screen header={<ScreenHeader title={title} onBack={back} />}>
        <SkeletonGroup label="Loading receipt" style={styles.skeleton}>
          <Bone height={140} radius={24} />
          <SkeletonText lines={1} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
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

  const total = r.totalPaid || r.fare;
  const ref = receiptReference(r.bookingId);
  const status = STATUS[r.paymentStatus];
  const service = r.driver ? catName(r.driver.vehicle.category) : BRAND_NAME;
  const driverName = r.driver ? [r.driver.firstName, r.driver.lastName].filter(Boolean).join(' ') : '';
  const v = r.driver?.vehicle;
  const method = PAYMENT_METHOD_LABELS[r.paymentMethod.type] ?? r.paymentMethod.label;
  const times = receiptTimes(r);

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
        categoryName: service,
        startedAt: times.pickupAt,
        completedAt: times.dropoffAt,
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
      });
    } catch {
      toast('Couldn’t create the receipt. Try again.', 'error');
    } finally {
      setSharing(false);
    }
  };

  const copyRef = async () => {
    await Clipboard.setStringAsync(ref).catch(() => undefined);
    haptic('selection');
    toast('Reference copied', 'success');
  };

  return (
    <Screen
      header={<ScreenHeader title={title} onBack={back} />}
      footer={
        // One compact row (D-084): help, and the main thing people come back for, the same ride again (D-096).
        // Sharing and the return trip are inside the ticket.
        <View style={styles.row}>
          <Button title="Get help" variant="secondary" size="md" style={styles.flex} leadingIcon="support" onPress={() => router.push({ pathname: '/account/support', params: { trip: id } })} />
          <Button title="Book again" size="md" style={styles.flex} leadingIcon="refresh" onPress={() => bookAgain(r)} testID="receipt-book-again" />
        </View>
      }
    >
      <Animated.View
        entering={reduce ? undefined : FadeInDown.duration(320)}
        style={[styles.ticket, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }, scheme === 'light' && shadows.card]}
        testID="receipt-ticket"
      >
        {/* Brand header. */}
        <View style={[styles.band, { backgroundColor: colors.brandBanner }]}>
          <View style={styles.bandTop}>
            <View style={styles.brandRow} accessible accessibilityLabel={`${BRAND_NAME} trip receipt`}>
              <BrandMark size={26} inverse />
              <Text variant="headline" style={{ color: colors.onBrandBanner }}>
                {BRAND_NAME}
              </Text>
            </View>
            <Text variant="caption" style={[styles.bandLabel, { color: colors.onBrandBanner }]}>
              TRIP RECEIPT
            </Text>
          </View>
          <Text variant="footnote" style={{ color: colors.onBrandBanner, opacity: 0.8 }}>
            {dateLong(r.completedAt)}
          </Text>
        </View>

        {/* Amount. */}
        <View style={styles.amountBlock} accessible accessibilityLabel={`Total ${nairaAccessibilityLabel(total)}, ${status.label}, ${method}`}>
          <Text variant="footnote" color="textSecondary">
            {r.paymentStatus === 'paid' ? 'Total paid' : 'Total'}
          </Text>
          <Text style={[styles.amount, { color: colors.text }]} tabular>
            {formatNaira(total)}
          </Text>
          <View style={styles.inline}>
            <StatusBadge kind={status.kind} label={status.label} />
            <View style={[styles.methodPill, { backgroundColor: colors.surfaceMuted }]}>
              <Icon name={r.paymentMethod.type === 'wallet' ? 'wallet' : 'bank'} size={14} color="textSecondary" />
              <Text variant="caption" color="textSecondary">
                {method}
              </Text>
            </View>
          </View>
        </View>

        <TearLine />

        {/* Journey timeline: one unbroken line from the pickup dot to the drop-off square. */}
        <View style={styles.journey}>
          <Stop dot={colors.text} time={time(times.pickupAt)} title={r.pickup.title} subtitle={r.pickup.subtitle} label="Pickup" />
          <Stop dot={brand.tangerine} time={time(times.dropoffAt)} title={r.destination.title} subtitle={r.destination.subtitle} label="Drop-off" last />
        </View>

        <View style={[styles.facts, { borderColor: colors.border }]}>
          <Fact label="Distance" value={formatDistance(r.distanceMeters)} />
          <View style={[styles.factSep, { backgroundColor: colors.border }]} />
          <Fact label="Duration" value={formatDuration(r.durationSeconds)} />
          <View style={[styles.factSep, { backgroundColor: colors.border }]} />
          <Fact label="Service" value={service} />
        </View>

        {r.driver ? (
          <View style={[styles.driver, { borderColor: colors.border }]} accessible accessibilityLabel={`Driver ${driverName}, rated ${r.driver.rating.toFixed(1)}. ${v ? `${v.colour} ${v.make} ${v.model}, ${v.plate}` : ''}`}>
            <Avatar uri={r.driver.photoUrl} name={driverName} size={44} />
            <View style={styles.flex}>
              <Text variant="callout" weight="semibold">
                {driverName}
              </Text>
              <View style={styles.meta}>
                <Icon name="star" variant="filled" size={12} color="accent" />
                <Text variant="caption" weight="regular" color="textSecondary" numberOfLines={1}>
                  {r.driver.rating.toFixed(1)}
                  {v ? ` · ${v.colour} ${v.make} ${v.model}` : ''}
                </Text>
              </View>
            </View>
            {v ? (
              <View style={[styles.plate, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
                <Text variant="caption" weight="semibold" color="textSecondary" tabular>
                  {v.plate}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Fare breakdown. */}
        <View style={styles.section}>
          {/* With no fee the fare is the total, so it is shown once. */}
          {r.processingFee > 0 ? (
            <>
              <Line label="Agreed trip fare" value={formatNaira(r.fare)} spoken={nairaAccessibilityLabel(r.fare)} />
              <Line label={`${method} fee`} hint="Separate from the fare" value={formatNaira(r.processingFee)} spoken={nairaAccessibilityLabel(r.processingFee)} />
              <View style={[styles.totalRule, { backgroundColor: colors.border }]} />
              <Line label="Total" value={formatNaira(total)} spoken={nairaAccessibilityLabel(total)} strong />
            </>
          ) : (
            <Line label="Agreed trip fare" value={formatNaira(total)} spoken={nairaAccessibilityLabel(total)} strong />
          )}
          <View style={[styles.commission, { backgroundColor: colors.surfaceMuted }]}>
            <Icon name="heart" variant="filled" size={14} color={brand.tangerine} />
            <Text variant="caption" weight="regular" color="textSecondary" style={styles.flex}>
              GoBye takes no commission. Your driver keeps the whole fare.
            </Text>
          </View>
        </View>

        <TearLine />

        {/* Reference. */}
        <Pressable onPress={copyRef} accessibilityRole="button" accessibilityLabel={`Reference ${ref.split('').join(' ')}. Copy`} style={({ pressed }) => [styles.refRow, pressed && { opacity: 0.6 }]} testID="receipt-ref">
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
        {/* Quiet actions: the way back, and the receipt as a PDF. */}
        <View style={[styles.more, { borderColor: colors.border }]}>
          <Pressable onPress={() => bookAgain(r, { reverse: true })} accessibilityRole="button" accessibilityLabel={`Book the return trip, from ${r.destination.title} to ${r.pickup.title}`} style={({ pressed }) => [styles.moreBtn, { backgroundColor: pressed ? colors.secondaryPressed : colors.secondary }]} testID="receipt-return">
            <Icon name="refresh" size={14} color="text" />
            <Text variant="footnote" weight="semibold">
              Return trip
            </Text>
          </Pressable>
          <Pressable onPress={share} disabled={sharing} accessibilityRole="button" accessibilityLabel="Share receipt" style={({ pressed }) => [styles.moreBtn, { backgroundColor: pressed ? colors.secondaryPressed : colors.secondary, opacity: sharing ? 0.6 : 1 }]} testID="receipt-share">
            <Icon name="share" size={14} color="text" />
            <Text variant="footnote" weight="semibold">
              {sharing ? 'Preparing…' : 'Share receipt'}
            </Text>
          </Pressable>
        </View>
        {!rating ? (
          <Pressable
            onPress={() => router.push({ pathname: '/rate/[id]', params: { id, from: 'receipt' } })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.rated, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
            testID="receipt-rate"
          >
            <Text variant="callout" weight="semibold">
              Rate this trip
            </Text>
            <View style={styles.inline}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Icon key={n} name="star" size={16} color="textSecondary" />
              ))}
            </View>
          </Pressable>
        ) : null}
        {rating ? (
          <View style={[styles.rated, { borderColor: colors.border }]}>
            <Text variant="caption" color="textSecondary">
              You rated this trip
            </Text>
            <View style={styles.inline}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Icon key={n} name="star" variant={n <= rating.stars ? 'filled' : 'regular'} size={14} color={n <= rating.stars ? 'accent' : 'textSecondary'} />
              ))}
            </View>
          </View>
        ) : null}
      </Animated.View>

      <View style={styles.note}>
        <SimulatedBadge />
        <Text variant="footnote" color="textSecondary" style={styles.flex}>
          Test trip and payment. Not a tax invoice.
        </Text>
      </View>
    </Screen>
  );
}

/** Perforated tear line with half-circle notches cut into both edges of the ticket. */
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

function Stop({ dot, time: t, title, subtitle, label, last }: { dot: string; time: string; title: string; subtitle: string; label: string; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stop} accessible accessibilityLabel={`${label} at ${t}: ${title}, ${subtitle}`}>
      <View style={styles.railCol}>
        {last ? <View style={[styles.railTop, { backgroundColor: colors.border }]} /> : <View style={styles.railGap} />}
        <View style={[styles.dot, last ? styles.dotSquare : null, { backgroundColor: dot }]} />
        {last ? null : <View style={[styles.railRest, { backgroundColor: colors.border }]} />}
      </View>
      <View style={[styles.flex, last ? null : styles.stopBody]}>
        <Text variant="callout" weight="semibold" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" weight="regular" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text variant="caption" color="textSecondary" tabular>
        {t}
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

function Line({ label, value, hint, strong, spoken }: { label: string; value: string; hint?: string; strong?: boolean; spoken?: string }): ReactNode {
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
  skeleton: { gap: spacing.lg, paddingTop: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ticket: { borderRadius: layout.sheetRadius, overflow: 'hidden', marginTop: spacing.sm },
  band: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xs },
  bandTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bandLabel: { letterSpacing: 1.2, opacity: 0.85 },
  amountBlock: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  methodPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 999 },
  tear: { height: NOTCH, justifyContent: 'center' },
  dash: { marginHorizontal: NOTCH, borderTopWidth: 1.5, borderStyle: 'dashed' },
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, top: 0 },
  notchLeft: { left: -NOTCH / 2 },
  notchRight: { right: -NOTCH / 2 },
  section: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.sm },
  journey: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  stop: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md },
  stopBody: { paddingBottom: spacing.lg },
  railCol: { width: 10, alignItems: 'center' },
  railGap: { height: 6 },
  railTop: { width: 2, height: 6 },
  railRest: { width: 2, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotSquare: { borderRadius: 2 },
  facts: { flexDirection: 'row', marginHorizontal: spacing.xl, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  fact: { flex: 1, gap: 2 },
  factSep: { width: StyleSheet.hairlineWidth, marginHorizontal: spacing.md },
  driver: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  plate: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  totalRule: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  commission: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: layout.controlRadius, marginTop: spacing.sm },
  more: { flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.xl, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  moreBtn: { flex: 1, height: 40, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  refRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  ref: { letterSpacing: 1 },
  copy: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rated: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: spacing.xl, paddingBottom: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
});
