import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { arrivalProgress, formatCountdown, formatDistance, formatDuration, formatNaira, isDriverLocationStale, nairaAccessibilityLabel, type Booking } from '@gobye/core';
import { Avatar, Bone, Button, Icon, IconButton, SkeletonGroup, Text, layout, shadows, spacing, useTheme } from '@gobye/ui';
import { VehicleSummary } from '@/features/common/VehicleSummary';
import { MapCanvas, type MapCanvasHandle } from '@/features/map/MapCanvas';
import { CircleButton, InsetCard, InsetGroup, InsetLine, PinCard } from './parts';
import { JourneyBar } from './JourneyBar';
import { clockIn, distanceToPickup, freshnessLabel, isDriverDelayed, locationAgeSeconds } from './live';

/**
 * Driver found → approaching → arrived (car.jpg): round header controls, a wide compact live map, the
 * arrival message with a quieter "(est. arrival)" note, a route-coloured progress bar driven by trip data,
 * the actual vehicle centred under it, then titled inset groups for driver details and ride details, and a
 * single prominent "Message driver" action with Call beside it and Cancel as quiet red text.
 * Pickup coordination follows live pin.jpg: passenger avatar on the pickup point, distinct vehicle marker,
 * proximity in metres and an honest location freshness label. States: approaching, almost there, arrived,
 * delayed, reconnecting; an ETA skeleton until the first location update arrives.
 */
export function ApproachView({
  b,
  now,
  pickupAvatarUri,
  pickupName,
  categoryName,
  onBack,
  onMessage,
  onCall,
  onHelp,
  onCancel,
}: {
  b: Booking;
  now: number;
  pickupAvatarUri: string | null;
  pickupName?: string;
  categoryName: string;
  onBack: () => void;
  onMessage: () => void;
  onCall: () => void;
  onHelp: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const map = useRef<MapCanvasHandle>(null);
  const [pickupH, setPickupH] = useState(0);
  const d = b.driver!;
  const name = [d.firstName, d.lastName].filter(Boolean).join(' ');
  const arrived = b.status === 'driver_arrived';
  const stale = !arrived && isDriverLocationStale(b, now);
  const delayed = !arrived && !stale && isDriverDelayed(b, now);
  const progress = arrived ? 1 : arrivalProgress(b);
  const eta = b.driverEtaSeconds;
  const age = locationAgeSeconds(b, now);
  const away = distanceToPickup(b);
  const fare = b.agreedFare ?? b.quote.suggested;
  const almost = !arrived && eta !== undefined && eta <= 120;
  const waiting = eta === undefined && !arrived;

  const heading = arrived ? 'Your driver has arrived' : delayed ? 'Your driver is running late' : almost ? 'Driver is almost there' : 'Your driver is on the way';
  const etaMain = arrived ? `Waiting ${b.arrivedAt ? formatCountdown(now - b.arrivedAt) : 'now'}` : eta !== undefined ? `${formatDuration(eta)} away` : '';
  const etaNote = !arrived && eta !== undefined ? `· arrives ${clockIn(now, eta)}` : '';
  const proximity = !arrived && away !== null ? `${formatDistance(away)} from your pickup` : null;
  const mapH = Math.round(Math.min(200, Math.max(150, (width - layout.page * 2) * 0.5)));

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]} showsVerticalScrollIndicator={false}>
        {/* Header: round back and help controls, like the reference */}
        <View style={styles.header}>
          <CircleButton icon="back" label="Back to Home. Your ride continues" onPress={onBack} testID="trip-back" />
          <View style={[styles.chip, { backgroundColor: colors.warningSurface }]} accessible accessibilityLabel="Simulated trip">
            <Icon name="info" size="xs" color="warning" />
            <Text variant="caption" color="warning">
              Simulated
            </Text>
          </View>
          <CircleButton icon="shield" label="Safety and help" onPress={onHelp} testID="trip-help" />
        </View>

        {/* Wide compact live map: vehicle, its approach (dashed) and the pickup point with your photo. */}
        <View style={[styles.map, { height: mapH, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
          <MapCanvas
            ref={map}
            center={d.coordinate}
            pickup={b.pickup.coordinate}
            pickupAvatarUri={pickupAvatarUri}
            pickupName={pickupName}
            driver={d.coordinate}
            driverRoute={arrived ? null : [d.coordinate, b.pickup.coordinate]}
            driverStale={stale}
          />
          <View style={styles.mapTop} pointerEvents="box-none">
            <View style={[styles.fresh, shadows.card, { backgroundColor: colors.surface }]} accessible accessibilityLiveRegion="polite">
              <View style={[styles.liveDot, { backgroundColor: stale ? colors.warning : colors.success }]} />
              <Text variant="caption" color={stale ? 'warning' : 'textSecondary'}>
                {stale ? `Reconnecting, ${freshnessLabel(age).toLowerCase()}` : freshnessLabel(age)}
              </Text>
            </View>
          </View>
          <View style={styles.mapRecenter}>
            <IconButton icon="locate" variant="floating" accessibilityLabel="Show driver and pickup" onPress={() => map.current?.fitAll()} />
          </View>
        </View>

        {/* Arrival message, ETA, proximity */}
        <View style={styles.status} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${heading}. ${waiting ? 'Arrival time calculating' : `${etaMain} ${etaNote}`}. ${proximity ?? ''}`}>
          <Text variant="title3" accessibilityRole="header">
            {heading}
          </Text>
          {waiting ? (
            <SkeletonGroup label="Calculating arrival time">
              <Bone width={180} height={18} style={styles.boneGap} />
            </SkeletonGroup>
          ) : (
            <Text variant="callout">
              {etaMain}
              <Text variant="callout" color="textSecondary">
                {`  ${etaNote}`}
              </Text>
            </Text>
          )}
          {proximity ? (
            <Text variant="footnote" color="textSecondary">
              {proximity}
            </Text>
          ) : null}
        </View>

        {waiting ? (
          <SkeletonGroup label="Calculating progress">
            <Bone height={12} radius={6} />
          </SkeletonGroup>
        ) : (
          <JourneyBar value={progress ?? 0} icon="car" label={arrived ? 'Driver at your pickup' : `Driver ${Math.round((progress ?? 0) * 100)} percent of the way to you, from live trip data`} />
        )}

        {stale ? (
          <Notice tone="warning" icon="refresh" text="Live location lost. The map shows the last known position." />
        ) : delayed ? (
          <Notice tone="warning" icon="clock" text={eta !== undefined ? `Latest estimate ${formatDuration(eta)}.` : 'Updating the arrival time.'} />
        ) : null}

        {/* Vehicle identity, centred like the reference */}
        <VehicleSummary vehicle={d.vehicle} size="lg" />

        {/* Pickup PIN at the arrival point of the flow */}
        {b.pickupPin && (b.status === 'driver_en_route' || arrived) ? <PinCard pin={b.pickupPin} riderName={b.rider?.name} /> : null}

        {/* Driver's details */}
        <InsetGroup title="Driver’s details">
          <InsetCard>
            <InsetLine
              labelNode={<Avatar uri={d.photoUrl} name={name} size={28} />}
              label={name}
              value={d.rating.toFixed(2)}
              valueMuted={`(${d.completedTrips.toLocaleString('en-NG')} trips)`}
            />
          </InsetCard>
        </InsetGroup>

        {/* Ride details: pickup and destination cards joined by a small connector */}
        <InsetGroup title="Ride details">
          {b.rider ? (
            <InsetCard>
              <InsetLine icon="account" label={`Booked for ${b.rider.name}`} />
            </InsetCard>
          ) : null}
          <View>
            <View onLayout={(e) => setPickupH(e.nativeEvent.layout.height)}>
              <InsetCard style={styles.placeCard}>
                <Text variant="footnote" color="textSecondary">
                  Pickup
                </Text>
                <Text variant="callout" numberOfLines={3}>
                  {b.pickup.title}, {b.pickup.subtitle}
                </Text>
                {b.pickupNote ? (
                  <Text variant="footnote" color="textSecondary" numberOfLines={3}>
                    Note: {b.pickupNote}
                  </Text>
                ) : null}
              </InsetCard>
            </View>
            <InsetCard style={[styles.placeCard, styles.placeCardBelow]}>
              <Text variant="footnote" color="textSecondary">
                Destination
              </Text>
              <Text variant="callout" numberOfLines={3}>
                {b.destination.title}, {b.destination.subtitle}
              </Text>
            </InsetCard>
            {/* Connector drawn last so it sits over both cards, centred in the gap between them. */}
            {pickupH ? (
              <View style={[styles.connectorWrap, { top: pickupH + spacing.sm / 2 - 14 }]} pointerEvents="none">
                <View style={[styles.connector, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                  <Icon name="chevronDown" size="xs" color="textSecondary" />
                </View>
              </View>
            ) : null}
          </View>
          <InsetCard>
            <View style={styles.fareLine} accessible accessibilityLabel={`${b.mode === 'negotiate' ? 'Agreed fare' : 'Fixed fare'}, ${nairaAccessibilityLabel(fare)}. You pay after the trip.`}>
              <View style={styles.flex}>
                <Text variant="footnote" color="textSecondary">
                  {b.mode === 'negotiate' ? 'Agreed fare' : 'Fixed fare'} · {categoryName}
                </Text>
                <Text variant="footnote" color="textSecondary">
                  Pay after the trip
                </Text>
              </View>
              <Text variant="headline" tabular>
                {formatNaira(fare)}
              </Text>
            </View>
          </InsetCard>
        </InsetGroup>

      </ScrollView>

      {/* Contact actions anchored within reach; cancellation quiet and red */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xs, backgroundColor: colors.background }]}>
        <View style={styles.footerRow}>
          <Button title="Message" leadingIcon="message" style={styles.flex} onPress={onMessage} accessibilityLabel={`Message ${d.firstName}`} testID="trip-message" />
          <Pressable
            onPress={onCall}
            accessibilityRole="button"
            accessibilityLabel={`Call ${d.firstName}`}
            testID="trip-call"
            style={({ pressed }) => [styles.call, { backgroundColor: pressed ? colors.secondaryPressed : colors.secondary }]}
          >
            <Icon name="phone" color="onSecondary" />
          </Pressable>
        </View>
        <Pressable onPress={onCancel} accessibilityRole="button" style={styles.cancel} testID="cancel-trip" hitSlop={4}>
          <Text variant="subhead" weight="semibold" color="danger">
            Cancel ride
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Notice({ tone, icon, text }: { tone: 'warning' | 'danger'; icon: 'refresh' | 'clock' | 'warning'; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: tone === 'warning' ? colors.warningSurface : colors.dangerSurface }]} accessible accessibilityLabel={text} accessibilityLiveRegion="polite">
      <Icon name={icon} variant="filled" size="sm" color={tone} />
      <Text variant="footnote" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.page, paddingBottom: spacing.xl, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 999 },
  map: { borderRadius: 22, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  mapTop: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: 'row' },
  fresh: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  mapRecenter: { position: 'absolute', right: spacing.sm, bottom: spacing.sm },
  status: { gap: 4, marginTop: -spacing.xs },
  boneGap: { marginTop: 4 },
  placeCard: { gap: 2 },
  placeCardBelow: { marginTop: spacing.sm },
  connectorWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  connector: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  fareLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: layout.container, borderRadius: 16 },
  footer: { paddingHorizontal: layout.page, paddingTop: spacing.sm },
  footerRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  call: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  cancel: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg },
});
