import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LatLng, Place } from '@gobye/core';
import { Button, Icon, IconButton, SimulatedBadge, Text, layout, shadows, spacing, useTheme, SkeletonGroup, Bone } from '@gobye/ui';
import { MapCanvas, type MapCanvasHandle } from '@/features/map/MapCanvas';
import { useBooking } from '@/state/booking';
import { FALLBACK_CENTER, useCurrentLocation } from '@/state/location';
import { useServices } from '@/state/services';

/**
 * R08b — Choose pickup on the map (brief §4). The passenger drags the map under a fixed centre pin;
 * the address under the pin is looked up when the map settles. Confirming updates the pickup, and the
 * options screen then re-routes and re-prices (distance, time and fare follow the new pickup).
 */
export default function PickupOnMap() {
  const { from } = useLocalSearchParams<{ from?: 'options' }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { maps } = useServices();
  const location = useCurrentLocation();
  const { pickup, destination, setPickup } = useBooking();
  const mapRef = useRef<MapCanvasHandle>(null);
  const start = pickup?.coordinate ?? location.coordinate ?? FALLBACK_CENTER;
  const [center, setCenter] = useState<LatLng>(start);
  const [place, setPlace] = useState<Place | null>(pickup);
  const [looking, setLooking] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLooking(true);
    setFailed(false);
    const t = setTimeout(() => {
      maps
        .reverseGeocode(center)
        .then((p) => active && setPlace({ ...p, coordinate: center }))
        .catch(() => active && setFailed(true))
        .finally(() => active && setLooking(false));
    }, 350);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [center, maps]);

  const confirm = () => {
    if (!place) return;
    setPickup({ ...place, coordinate: center });
    if (from === 'options' || !destination) return router.back();
    router.replace('/booking/options');
  };

  return (
    <View style={styles.root}>
      <MapCanvas ref={mapRef} center={start} fit={false} showsUserLocation={location.permission === 'granted'} onCenterChange={setCenter} testID="pickup-map" />

      {/* Fixed pin at the exact map centre (the coordinate reported by onCenterChange); the map moves underneath it. */}
      <View pointerEvents="none" style={styles.pinWrap}>
        <View style={[styles.pinHead, { backgroundColor: colors.primary, borderColor: colors.surface }]}>
          <Icon name="account" variant="filled" size="sm" color="onPrimary" />
        </View>
        <View style={[styles.pinStem, { backgroundColor: colors.primary }]} />
        <View style={[styles.pinShadow, { backgroundColor: colors.text }]} />
      </View>

      <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
        <IconButton icon="back" variant="floating" accessibilityLabel="Back" onPress={() => router.back()} />
        <View style={[styles.hint, shadows.card, { backgroundColor: colors.surface }]}>
          <Text variant="subhead" weight="semibold">
            Move the map to your pickup
          </Text>
        </View>
      </View>
      {location.coordinate ? (
        <View style={[styles.locate, { bottom: 240 + insets.bottom }]}>
          <IconButton icon="locate" variant="floating" accessibilityLabel="Back to my location" onPress={() => mapRef.current?.recenter(location.coordinate!)} />
        </View>
      ) : null}

      <View style={[styles.panel, shadows.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.row} accessible accessibilityLiveRegion="polite" accessibilityLabel={looking ? 'Finding address' : place ? `Pickup: ${place.title}, ${place.subtitle}` : 'Address not found'}>
          <View style={[styles.iconBox, { backgroundColor: colors.surfaceSelected }]}>
            <Icon name="account" color="primary" />
          </View>
          <View style={styles.flex}>
            <Text variant="footnote" color="textSecondary">
              Pickup
            </Text>
            {looking ? (
              <SkeletonGroup label="Finding address" style={styles.loader}>
                <Bone width="75%" height={18} />
                <Bone width="45%" height={12} style={styles.boneGap} />
              </SkeletonGroup>
            ) : (
              <Text variant="headline" numberOfLines={2}>
                {failed ? 'No address here. Move the pin.' : place ? `${place.title}` : 'No address yet'}
              </Text>
            )}
            {!looking && place && !failed ? (
              <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                {place.subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <SimulatedBadge label="Simulated addresses" />
        <Button title="Confirm pickup" onPress={confirm} disabled={looking || !place || failed} testID="confirm-pickup" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: { position: 'absolute', left: layout.page, right: layout.page, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hint: { flex: 1, minHeight: 48, borderRadius: 24, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  locate: { position: 'absolute', right: layout.page },
  pinWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pinHead: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center', marginTop: -54 },
  pinStem: { width: 3, height: 14, borderRadius: 2 },
  pinShadow: { width: 10, height: 4, borderRadius: 5, opacity: 0.25 },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: layout.sheetRadius, borderTopRightRadius: layout.sheetRadius, padding: layout.page, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 56 },
  iconBox: { width: layout.iconBox, height: layout.iconBox, borderRadius: layout.iconBox / 2, alignItems: 'center', justifyContent: 'center' },
  loader: { alignSelf: 'stretch', marginVertical: spacing.xs },
  boneGap: { marginTop: spacing.xs },
});
