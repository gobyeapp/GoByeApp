import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, UIManager, View } from 'react-native';
import { formatDistance, formatDuration, formatNaira, nairaAccessibilityLabel, paymentCharge } from '@gobye/core';
import { Avatar, Bone, Button, Icon, KeyValue, Screen, SkeletonGroup, StatusBadge, Text, layout, spacing, useTheme, useToast } from '@gobye/ui';
import { SimulatedNote } from '@/features/booking/components';
import { useConfirmBeforeBack } from '@/features/booking/useCancelRide';
import { resetTo } from '@/features/navigation/reset';
import { RatingPanel } from '@/features/trip/parts';
import { paymentReference, tripReference } from '@/features/trip/live';
import { receiptStatusLabel, shareReceiptPdf } from '@/features/trip/receiptPdf';
import { useAccount } from '@/state/account';
import { useBooking } from '@/state/booking';
import { useCategoryName } from '@/state/config';

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

/**
 * End of trip, step 3 of 3: post-payment summary. Reached only after a verified payment.
 * Rating first (optional, skippable), a compact driver and vehicle line, receipt actions, then trip
 * and payment details collapsed by default, and one way home. The amount appears once, inside
 * Payment details. Leaving records the trip in Activities (finish()).
 */
export default function TripSummary() {
  const { colors } = useTheme();
  const toast = useToast();
  const account = useAccount();
  const booking = useBooking();
  const catName = useCategoryName();
  const b = booking.booking;
  const paid = b?.status === 'completed' || b?.paymentStatus === 'paid';
  const leaving = useRef(false);
  const [skipped, setSkipped] = useState(false);
  const [sharing, setSharing] = useState<'download' | 'share' | null>(null);

  const home = () => {
    leaving.current = true;
    booking.finish();
    resetTo('/(tabs)');
  };
  useConfirmBeforeBack(true, home);

  useEffect(() => {
    if (leaving.current) return;
    if (!b) return void resetTo('/(tabs)');
    if (!paid) router.replace('/trip-complete');
  }, [b, paid]);

  if (!b || !paid) return null;
  const charge = paymentCharge(b.agreedFare ?? b.quote.suggested, b.paymentMethod.type);
  const d = b.driver;
  const driverName = d ? [d.firstName, d.lastName].filter(Boolean).join(' ') : 'Your driver';
  const existing = account.ratings.find((r) => r.bookingId === b.id);
  const duration = b.startedAt && b.completedAt ? Math.max(60, Math.round((b.completedAt - b.startedAt) / 1000)) : b.route.durationSeconds;
  const completedAt = b.completedAt ?? Date.now();
  const when = new Date(completedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const receipt = async (action: 'download' | 'share') => {
    setSharing(action);
    try {
      await shareReceiptPdf({
        bookingId: b.id,
        fare: charge.fare,
        processingFee: charge.processingFee,
        total: charge.total,
        paymentMethod: b.paymentMethod,
        paymentStatusLabel: receiptStatusLabel(b.paymentStatus, b.status === 'completed'),
        pickup: b.pickup,
        destination: b.destination,
        driver: d,
        categoryName: catName(b.quote.category),
        completedAt,
        distanceMeters: b.route.distanceMeters,
        durationSeconds: duration,
      });
    } catch {
      toast('Couldn’t create the receipt. Try again.', 'error');
    } finally {
      setSharing(null);
    }
  };

  return (
    <Screen footer={<Button title="Back to Home" onPress={home} testID="trip-done" />}>
      <View style={styles.body}>
        <Text variant="title2" accessibilityRole="header" style={styles.title}>
          Trip summary
        </Text>

        {/* Rating: optional. Skip collapses it; it can be done later from Activities. */}
        {skipped && !existing ? null : (
          <View style={[styles.card, { backgroundColor: colors.surfaceMuted }]} testID="rating-card">
            <View style={styles.cardHead}>
              <Text variant="headline" style={styles.flex}>
                {existing ? 'Your rating' : `Rate ${d?.firstName ?? 'your driver'}`}
              </Text>
              {existing ? null : (
                <Pressable onPress={() => setSkipped(true)} accessibilityRole="button" accessibilityLabel="Skip rating" hitSlop={8} style={styles.skip} testID="skip-rating">
                  <Text variant="subhead" weight="semibold" color="textSecondary">
                    Skip
                  </Text>
                </Pressable>
              )}
            </View>
            {account.ready ? (
              <RatingPanel
                bookingId={b.id}
                existing={existing}
                onSubmit={(r) => {
                  account.addRating(r);
                  toast('Thanks for your feedback', 'success');
                }}
              />
            ) : (
              <SkeletonGroup label="Loading rating">
                <Bone height={60} radius={20} />
              </SkeletonGroup>
            )}
          </View>
        )}

        {/* Driver and vehicle, one compact row. */}
        {d ? (
          <View
            style={styles.driver}
            accessible
            accessibilityLabel={`${driverName}, rated ${d.rating.toFixed(1)}. ${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model}, plate ${d.vehicle.plate}`}
          >
            <Avatar uri={d.photoUrl} name={driverName} size={44} />
            <View style={styles.flex}>
              <View style={styles.inline}>
                <Text variant="callout" weight="semibold" numberOfLines={1} style={styles.shrink}>
                  {driverName}
                </Text>
                <Icon name="star" variant="filled" size={14} color="accent" />
                <Text variant="footnote" weight="semibold">
                  {d.rating.toFixed(1)}
                </Text>
              </View>
              <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                {d.vehicle.colour} {d.vehicle.make} {d.vehicle.model}
              </Text>
            </View>
            <View style={[styles.plate, { borderColor: colors.border }]}>
              <Text variant="footnote" weight="semibold" tabular>
                {d.vehicle.plate}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Receipt */}
        <View style={styles.receiptRow} testID="receipt-section">
          <Button title="Download" variant="secondary" size="md" leadingIcon="download" onPress={() => receipt('download')} loading={sharing === 'download'} disabled={!!sharing} style={styles.receiptBtn} testID="receipt-pdf" accessibilityLabel="Download receipt" accessibilityHint="Creates a PDF you can save to your files" />
          <Button title="Share" variant="secondary" size="md" leadingIcon="share" onPress={() => receipt('share')} loading={sharing === 'share'} disabled={!!sharing} style={styles.receiptBtn} testID="receipt-share" accessibilityLabel="Share receipt" />
        </View>

        {/* Details, collapsed by default */}
        <View style={[styles.details, { borderColor: colors.border }]}>
          <Expandable title="Trip details" testID="trip-details">
            <RoutePair from={b.pickup.title} to={b.destination.title} />
            <KeyValue label="Date" value={when} />
            <KeyValue label="Distance" value={formatDistance(b.route.distanceMeters)} />
            <KeyValue label="Time" value={formatDuration(duration)} />
            <KeyValue label="Car" value={catName(b.quote.category)} />
            <KeyValue label="Trip" value={tripReference(b.id)} />
          </Expandable>
          <View style={[styles.rule, { backgroundColor: colors.border }]} />
          <Expandable title="Payment details" testID="payment-details">
            <KeyValue label={b.mode === 'negotiate' ? 'Agreed fare' : 'Trip fare'} value={formatNaira(charge.fare)} spoken={nairaAccessibilityLabel(charge.fare)} />
            {charge.processingFee > 0 ? <KeyValue label={`${b.paymentMethod.label} fee`} value={formatNaira(charge.processingFee)} spoken={nairaAccessibilityLabel(charge.processingFee)} /> : null}
            <KeyValue label="Total paid" value={formatNaira(charge.total)} spoken={nairaAccessibilityLabel(charge.total)} bold />
            <KeyValue label="Method" value={b.paymentMethod.label} />
            {b.paymentMethod.type === 'bank_transfer' ? <KeyValue label="Reference" value={paymentReference(b.id)} /> : null}
            <View style={styles.statusRow}>
              <Text variant="callout" color="textSecondary">
                Status
              </Text>
              <StatusBadge kind="successful" label="Paid" />
            </View>
          </Expandable>
        </View>

        <Pressable onPress={() => router.push('/account/support')} accessibilityRole="button" style={styles.link} hitSlop={4}>
          <Icon name="help" size="sm" color="textSecondary" />
          <Text variant="subhead" weight="semibold" color="textSecondary">
            Report an issue
          </Text>
        </Pressable>
        <SimulatedNote text="Test trip and payment" />
      </View>
    </Screen>
  );
}

function Expandable({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.expHead}
        testID={testID}
      >
        <Text variant="callout" weight="semibold" style={styles.flex}>
          {title}
        </Text>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size="sm" color="textSecondary" />
      </Pressable>
      {open ? <View style={styles.expBody}>{children}</View> : null}
    </View>
  );
}

function RoutePair({ from, to }: { from: string; to: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.route} accessible accessibilityLabel={`From ${from} to ${to}`}>
      <View style={styles.routeRail}>
        <View style={[styles.dot, { backgroundColor: colors.text }]} />
        <View style={[styles.railLine, { backgroundColor: colors.border }]} />
        <Icon name="flag" variant="filled" size={12} color="accent" />
      </View>
      <View style={[styles.flex, styles.routeText]}>
        <Text variant="subhead" weight="medium" numberOfLines={2}>
          {from}
        </Text>
        <Text variant="subhead" weight="medium" numberOfLines={2}>
          {to}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  body: { gap: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  title: { paddingTop: spacing.xs },
  card: { borderRadius: layout.cardRadius, padding: layout.container, gap: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  skip: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.xs },
  driver: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  plate: { borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  receiptBtn: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md },
  receiptRow: { flexDirection: 'row', gap: spacing.sm },
  details: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  rule: { height: StyleSheet.hairlineWidth },
  expHead: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: spacing.md },
  expBody: { gap: spacing.xs, paddingBottom: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  route: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
  routeRail: { width: 12, alignItems: 'center', paddingTop: 6, paddingBottom: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  railLine: { width: 2, flex: 1, minHeight: 12, marginVertical: 3, borderRadius: 1 },
  routeText: { gap: spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 44 },
});
