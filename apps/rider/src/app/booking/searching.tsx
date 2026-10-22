import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNaira, nairaAccessibilityLabel } from '@gobye/core';
import { Button, EmptyState, MapSheet, SkeletonGroup, SkeletonRow, Text, layout, spacing, useTheme, useToast } from '@gobye/ui';
import { SearchingPulse, SimulatedNote } from '@/features/booking/components';
import { useCancelRide, useConfirmBeforeBack } from '@/features/booking/useCancelRide';
import { MapCanvas } from '@/features/map/MapCanvas';
import { resetTo } from '@/features/navigation/reset';
import { useBooking } from '@/state/booking';
import { useHaptics } from '@/state/haptics';
import { useCategoryName } from '@/state/config';

const MATCHED = ['matched', 'driver_en_route', 'driver_arrived', 'in_progress'];

/** R12 — Quick Match searching / no drivers. No driver is shown until the match is confirmed. */
export default function Searching() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheetH = Math.round(Math.min(520, Math.max(380, height * 0.66)));
  const { colors } = useTheme();
  const toast = useToast();
  const haptic = useHaptics();
  const booking = useBooking();
  const catName = useCategoryName();
  const b = booking.booking;
  const cancel = useCancelRide();
  useConfirmBeforeBack(true, cancel);

  useEffect(() => {
    if (!b) resetTo('/(tabs)');
    else if (MATCHED.includes(b.status) && b.driver) {
      // Only a confirmed match (driver assigned by the matching service) moves on — never earlier.
      haptic('success');
      toast('Driver found', 'success');
      resetTo('/trip');
    } else if (b.status === 'no_drivers') haptic('warning');
  }, [b?.status, b, haptic, toast]);

  if (!b) return null;
  // 'quoted' here means a retry couldn't be submitted — offer the same recovery actions.
  const noDrivers = b.status === 'no_drivers' || b.status === 'quoted';

  return (
    <View style={styles.root}>
      <MapCanvas center={b.pickup.coordinate} pickup={b.pickup.coordinate} destination={b.destination.coordinate} route={b.route.polyline} bottomInset={sheetH} topInset={insets.top} />
      <MapSheet snapPoints={[sheetH]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {noDrivers ? (
          <View style={styles.content}>
            <EmptyState icon="car" title="No drivers available" body="Nearby drivers are busy. Try again or offer your fare." />
            <Button
              title="Try again"
              onPress={async () => {
                const r = await booking.rebook('quick_match');
                if (!r.ok) toast(r.error, 'error');
              }}
              testID="retry-search"
            />
            <Button
              title="Offer your fare"
              variant="secondary"
              onPress={async () => {
                const r = await booking.rebook('negotiate');
                if (!r.ok) return toast(r.error, 'error');
                router.replace('/booking/negotiate');
              }}
            />
            <Button title="Cancel" variant="tertiary" onPress={cancel} />
          </View>
        ) : (
          <View style={styles.content} accessibilityLiveRegion="polite">
            <SearchingPulse />
            <View style={styles.titleBlock}>
              <Text variant="title3" align="center" accessibilityRole="header">
                Finding you a driver
              </Text>
              <Text variant="callout" color="textSecondary" align="center">
                Asking nearby drivers
              </Text>
            </View>
            <View
              style={[styles.summary, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
              accessible
              accessibilityLabel={`${catName(b.quote.category)}, ${b.mode === 'negotiate' ? 'agreed fare' : 'fixed fare'} ${nairaAccessibilityLabel(b.agreedFare ?? b.quote.suggested)}. From ${b.pickup.title} to ${b.destination.title}`}
            >
              <View style={styles.summaryRow}>
                <Text variant="subhead" weight="semibold" style={styles.flex}>
                  {catName(b.quote.category)}
                </Text>
                <Text variant="headline" tabular>
                  {formatNaira(b.agreedFare ?? b.quote.suggested)}
                </Text>
              </View>
              <Text variant="footnote" color="textSecondary" numberOfLines={2}>
                {b.pickup.title} to {b.destination.title}
              </Text>
            </View>
            {/* Where the driver's details will appear: a skeleton, never a guessed driver. */}
            <SkeletonGroup label="Waiting for a driver to accept">
              <View style={[styles.summary, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                <SkeletonRow />
              </View>
            </SkeletonGroup>
            <SimulatedNote text="Test drivers only" />
            <Pressable onPress={cancel} accessibilityRole="button" style={styles.cancel} testID="cancel-search" hitSlop={4}>
              <Text variant="subhead" weight="semibold" color="danger">
                Cancel ride
              </Text>
            </Pressable>
          </View>
        )}
        </ScrollView>
      </MapSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing.md, paddingTop: spacing.sm },
  titleBlock: { gap: spacing.xs },
  summary: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: layout.container, paddingVertical: spacing.sm, gap: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  cancel: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg },
  scroll: { paddingBottom: spacing.lg },
});
