import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { arrivalProgress, formatDistance, formatDuration, formatNaira, isDriverLocationStale, nairaAccessibilityLabel, type Booking } from '@gobye/core';
import { Avatar, Bone, Button, Icon, SkeletonGroup, Text, layout, shadows, spacing, useTheme } from '@gobye/ui';
import { MapCanvas, type MapCanvasHandle } from '@/features/map/MapCanvas';
import { Notice } from './ApproachView';
import { JourneyBar } from './JourneyBar';
import { clockIn, freshnessLabel, locationAgeSeconds } from './live';


/**
 * Trip in progress (estimate.jpg): the map fills the screen with route, vehicle and destination; small
 * stacked map controls top right; a white (black in dark) lower panel over the map, with
 * "Trip in progress", a grey driver/vehicle card, the agreed fare (never a running meter) beside the
 * distance left, a journey bar with a destination ring, an "Arrival by" pill, the minutes remaining in the
 * route colour, a black "Share trip" action and Emergency as red text. Stale location reads "Reconnecting".
 */
export function InTripView({ b, now, onShare, onHelp, onEmergency }: { b: Booking; now: number; onShare: () => void; onHelp: () => void; onEmergency: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Short screens: keep the map visible by folding the arrival pill into one line and moving the fare note to the fare's spoken label.
  const compact = height < 700;
  const map = useRef<MapCanvasHandle>(null);
  const [panelH, setPanelH] = useState(360);
  const d = b.driver!;
  const name = [d.firstName, d.lastName ? `${d.lastName.charAt(0)}.` : ''].filter(Boolean).join(' ');
  const stale = isDriverLocationStale(b, now);
  const progress = arrivalProgress(b);
  const eta = b.driverEtaSeconds;
  const age = locationAgeSeconds(b, now);
  const remainingShare = eta !== undefined && b.driverEtaInitialSeconds ? Math.min(1, eta / b.driverEtaInitialSeconds) : null;
  const remainingMeters = remainingShare !== null ? b.route.distanceMeters * remainingShare : null;
  const fare = b.agreedFare ?? b.quote.suggested;
  const known = eta !== undefined && progress !== null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <MapCanvas
        ref={map}
        center={d.coordinate}
        destination={b.destination.coordinate}
        route={b.route.polyline}
        driver={d.coordinate}
        driverStale={stale}
        bottomInset={panelH}
        topInset={insets.top + 56}
      />

      {/* Top: honest location freshness (left) and compact stacked map controls (right). */}
      <View style={[styles.top, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={[styles.fresh, shadows.card, { backgroundColor: colors.surface }]} accessible accessibilityLiveRegion="polite">
          <View style={[styles.liveDot, { backgroundColor: stale ? colors.warning : colors.success }]} />
          <Text variant="caption" color={stale ? 'warning' : 'textSecondary'} numberOfLines={1}>
            {stale ? 'Reconnecting' : freshnessLabel(age)}
          </Text>
        </View>
        <View style={[styles.controls, shadows.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable onPress={() => map.current?.fitAll()} accessibilityRole="button" accessibilityLabel="Show the whole route" style={styles.control} hitSlop={2}>
            <Icon name="locate" size="sm" color="text" />
          </Pressable>
          <View style={[styles.controlDivider, { backgroundColor: colors.border }]} />
          <Pressable onPress={onHelp} accessibilityRole="button" accessibilityLabel="Safety and help" style={styles.control} hitSlop={2} testID="trip-help">
            <Icon name="shield" size="sm" color="text" />
          </Pressable>
        </View>
      </View>

      {/* Lower panel: a solid sheet over the map (no fade gradient). */}
      <View style={styles.panelWrap} pointerEvents="box-none" onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}>
        <View style={[styles.panel, compact && styles.panelCompact, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: insets.bottom + spacing.sm }]}>
          <View style={styles.titleRow}>
            <Text variant="title3" accessibilityRole="header" style={styles.flex}>
              Trip in progress
            </Text>
            <View style={[styles.chip, { backgroundColor: colors.warningSurface }]} accessible accessibilityLabel="Simulated trip">
              <Text variant="caption" color="warning">
                Simulated
              </Text>
            </View>
          </View>

          {/* Driver and vehicle, grey card */}
          <View style={[styles.driverCard, { backgroundColor: colors.surfaceMuted }]} accessible accessibilityLabel={`${name}, rated ${d.rating.toFixed(1)}, ${d.completedTrips} trips. ${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model}, plate ${d.vehicle.plate}`}>
            <View style={styles.flex}>
              <View style={styles.inline}>
                <Avatar uri={d.photoUrl} name={name} size={24} />
                <Text variant="subhead" weight="semibold" numberOfLines={1} style={styles.shrink}>
                  {name}
                </Text>
              </View>
              <View style={styles.inline}>
                <Icon name="star" variant="filled" size="xs" color="accent" />
                <Text variant="footnote" color="textSecondary">
                  {d.rating.toFixed(1)} · ({d.completedTrips.toLocaleString('en-NG')} trips)
                </Text>
              </View>
            </View>
            <View style={styles.vehicleText}>
              <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                {d.vehicle.make} {d.vehicle.model} · {d.vehicle.colour}
              </Text>
              <Text variant="footnote" color="textSecondary">
                Plate: <Text variant="footnote" weight="semibold">{d.vehicle.plate}</Text>
              </Text>
            </View>
          </View>

          {/* Agreed fare (fixed) and distance left */}
          <View style={styles.figures}>
            <View accessible accessibilityLabel={`Agreed fare, ${nairaAccessibilityLabel(fare)}. Fixed for this trip. It changes only if an authorised adjustment is made and explained.`}>
              <Text variant="footnote" color="textSecondary">
                Agreed fare · fixed
              </Text>
              <Text variant="headline" tabular>
                {formatNaira(fare)}
              </Text>
            </View>
            <View style={styles.right} accessible accessibilityLabel={`Distance left, ${remainingMeters !== null ? formatDistance(remainingMeters) : 'calculating'}`}>
              <Text variant="footnote" color="textSecondary">
                Distance left
              </Text>
              {remainingMeters !== null ? (
                <Text variant="headline" tabular>
                  {formatDistance(remainingMeters)}
                </Text>
              ) : (
                <SkeletonGroup label="Calculating distance">
                  <Bone width={64} height={18} style={styles.boneTop} />
                </SkeletonGroup>
              )}
            </View>
          </View>

          {known ? (
            <JourneyBar value={progress ?? 0} end label={`Journey ${Math.round((progress ?? 0) * 100)} percent complete toward ${b.destination.title}`} />
          ) : (
            <SkeletonGroup label="Calculating journey progress">
              <Bone height={12} radius={6} style={styles.boneBar} />
            </SkeletonGroup>
          )}

          {/* Arrival pill and remaining time */}
          <View style={styles.arrival} accessible accessibilityLiveRegion="polite" accessibilityLabel={known ? `Arrival by ${clockIn(now, eta!)}. ${formatDuration(eta!)} remaining, estimated` : 'Arrival time calculating'}>
            {compact && known ? null : (
              <View style={[styles.pill, { backgroundColor: colors.surfaceMuted }]}>
                <View style={[styles.pillBar, { backgroundColor: colors.textSecondary }]} />
              <Text variant="footnote" color="textSecondary">
                {known ? `Arrival by ${clockIn(now, eta!)}` : 'Arrival time calculating'}
              </Text>
              </View>
            )}
            {known ? (
              <Text variant="subhead" align="center">
                <Text variant="subhead" weight="semibold" color="accentText">
                  {formatDuration(eta!)} remaining
                </Text>
                {compact ? (
                  <Text variant="subhead" color="textSecondary">
                    {` · by ${clockIn(now, eta!)}`}
                  </Text>
                ) : null}
              </Text>
            ) : null}
          </View>

          {stale ? <Notice tone="warning" icon="refresh" text="Live location lost. Times are from the last update." /> : null}


          <Button title="Share trip" leadingIcon="share" onPress={onShare} testID="trip-share" />
          <Pressable onPress={onEmergency} accessibilityRole="button" accessibilityLabel="Emergency: call 112" style={styles.emergency} testID="trip-sos" hitSlop={4}>
            <Icon name="sos" size="sm" color="danger" />
            <Text variant="subhead" weight="semibold" color="danger">
              Emergency
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  top: { position: 'absolute', left: layout.page, right: layout.page, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  fresh: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 999, flexShrink: 1 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  controls: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  control: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  controlDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 8 },
  panelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panel: { paddingHorizontal: layout.page, paddingTop: spacing.lg, gap: spacing.md, borderTopLeftRadius: layout.sheetRadius, borderTopRightRadius: layout.sheetRadius, borderTopWidth: StyleSheet.hairlineWidth },
  panelCompact: { gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 999 },
  driverCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 18, paddingHorizontal: layout.container, paddingVertical: spacing.md },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vehicleText: { alignItems: 'flex-end', gap: 4, flexShrink: 1, maxWidth: '50%' },
  figures: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  right: { alignItems: 'flex-end' },
  boneTop: { marginTop: 4 },
  boneBar: { marginVertical: 8 },
  arrival: { alignItems: 'center', gap: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 10 },
  pillBar: { width: 2, height: 12, borderRadius: 1 },
  emergency: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, alignSelf: 'center', paddingHorizontal: spacing.lg },
});
