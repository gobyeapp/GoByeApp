import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { useReducedMotion } from 'react-native-reanimated';
import type { LatLng } from './types';
import { Icon } from '../icons/Icon';
import { Avatar } from '../components/patterns';
import { Text } from '../components/Text';
import { brand } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { DARK_MAP_STYLE } from './darkMapStyle';

/**
 * Android maps are Google Maps, and react-native-maps crashes the app on Android when the build has no
 * Google Maps key. app.config.js (tools/expo/with-android-maps-key.js) records whether the build has one
 * in `extra.googleMapsAndroid`. iOS uses Apple Maps and needs no key.
 */
export function mapsAvailable(os: string = Platform.OS, extra: Record<string, unknown> | undefined = Constants.expoConfig?.extra): boolean {
  if (os !== 'android') return true;
  return extra?.googleMapsAndroid === true;
}

export interface MapCanvasHandle {
  recenter(coordinate: LatLng): void;
  /** Re-fit to everything shown (route, pickup, destination, vehicle) — the "recenter" control on trip maps. */
  fitAll(): void;
}

export interface MapCanvasProps {
  center: LatLng;
  pickup?: LatLng | null;
  destination?: LatLng | null;
  route?: LatLng[] | null;
  driver?: LatLng | null;
  /** Driver's approach to the pickup, drawn dashed so it reads differently from the trip route. */
  driverRoute?: LatLng[] | null;
  /** Driver position is old — marker is dimmed and labelled (brief §8). */
  driverStale?: boolean;
  /** Passenger photo shown on the pickup pin for pickup coordination (no tracking outside the trip). */
  pickupAvatarUri?: string | null;
  pickupName?: string;
  showsUserLocation?: boolean;
  /** Space covered by the bottom sheet, so fitted content isn't hidden behind it. */
  bottomInset?: number;
  topInset?: number;
  /** Reports the map centre after the user pans (used by "choose pickup on map"). */
  onCenterChange?: (c: LatLng) => void;
  /** Disable automatic fitting (e.g. while the user picks a point). */
  fit?: boolean;
  testID?: string;
}

/**
 * GoBye map surface (D-004; Google Maps Platform proposed, D-025). Markers are distinct by shape,
 * icon and label — not colour alone: vehicle (car), pickup (person / photo + "Pickup"), destination (flag).
 * Follows the app appearance: Apple Maps via `userInterfaceStyle`, Google Maps via a dark style.
 */
export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  { center, pickup, destination, route, driver, driverRoute, driverStale, pickupAvatarUri, pickupName, showsUserLocation, bottomInset = 0, topInset = 0, onCenterChange, fit = true, testID },
  ref,
) {
  const map = useRef<MapView>(null);
  const reduceMotion = useReducedMotion();
  const { colors, scheme } = useTheme();

  const fitNow = () => {
    const pts = [...(route ?? []), ...(driverRoute ?? []), ...[pickup, destination, driver].filter(Boolean)] as LatLng[];
    if (pts.length >= 2) {
      map.current?.fitToCoordinates(pts, { edgePadding: { top: topInset + 48, right: 48, bottom: bottomInset + 32, left: 48 }, animated: !reduceMotion });
    } else if (pts.length === 1) {
      map.current?.animateToRegion({ ...pts[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }, reduceMotion ? 0 : 400);
    }
  };

  useImperativeHandle(ref, () => ({
    recenter(c) {
      map.current?.animateToRegion({ ...c, latitudeDelta: 0.02, longitudeDelta: 0.02 }, reduceMotion ? 0 : 400);
    },
    fitAll: fitNow,
  }));

  const fitKey = [pickup, destination, route?.length ? route[0] : null].map((p) => (p ? `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}` : '-')).join('|');
  useEffect(() => {
    if (!fit) return;
    fitNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, bottomInset, fit]);

  const initialRegion: Region = { ...center, latitudeDelta: 0.04, longitudeDelta: 0.04 };

  if (!mapsAvailable()) {
    // No Google Maps key in this Android build: a calm placeholder instead of a native crash.
    return (
      <View testID={testID} style={[StyleSheet.absoluteFill, styles.unavailable, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Map not available in this build">
        <Icon name="map" size="lg" color="textSecondary" />
        <Text variant="footnote" color="textSecondary" align="center" style={styles.unavailableText}>
          Map not available in this test build
        </Text>
      </View>
    );
  }

  return (
    <MapView
      ref={map}
      testID={testID}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      showsUserLocation={showsUserLocation}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      userInterfaceStyle={scheme}
      customMapStyle={Platform.OS === 'android' && scheme === 'dark' ? DARK_MAP_STYLE : undefined}
      mapPadding={{ top: topInset, right: 0, bottom: bottomInset, left: 0 }}
      onRegionChangeComplete={(r) => onCenterChange?.({ latitude: r.latitude, longitude: r.longitude })}
      accessibilityLabel="Map"
    >
      {route && route.length > 1 ? <Polyline coordinates={route} strokeColor={colors.mapRoute} strokeWidth={5} /> : null}
      {driverRoute && driverRoute.length > 1 ? <Polyline coordinates={driverRoute} strokeColor={colors.textSecondary} strokeWidth={4} lineDashPattern={[8, 8]} /> : null}
      {pickup ? (
        <Marker coordinate={pickup} anchor={{ x: 0.5, y: 1 }} accessibilityLabel={pickupName ? `Pickup for ${pickupName}` : 'Pickup'} tracksViewChanges={!!pickupAvatarUri}>
          <View style={styles.pin}>
            <View style={[styles.pinHead, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
              {pickupAvatarUri ? <Avatar uri={pickupAvatarUri} name={pickupName} size={30} /> : <Icon name="account" variant="filled" size="sm" color="primary" />}
            </View>
            <View style={[styles.pinLabel, { backgroundColor: colors.primary }]}>
              <Text variant="caption" color="onPrimary" maxFontSizeMultiplier={1.2}>
                Pickup
              </Text>
            </View>
          </View>
        </Marker>
      ) : null}
      {destination ? (
        <Marker coordinate={destination} anchor={{ x: 0.5, y: 1 }} accessibilityLabel="Destination" tracksViewChanges={false}>
          <View style={styles.pin}>
            <View style={[styles.pinHead, { backgroundColor: brand.tangerine, borderColor: colors.surface }]}>
              <Icon name="flag" variant="filled" size="sm" color={brand.white} />
            </View>
            <View style={[styles.pinStem, { backgroundColor: brand.tangerine }]} />
          </View>
        </Marker>
      ) : null}
      {driver ? (
        <Marker coordinate={driver} anchor={{ x: 0.5, y: 0.5 }} accessibilityLabel={driverStale ? 'Vehicle, last known position, reconnecting' : 'Vehicle'}>
          <View style={[styles.vehicle, { backgroundColor: driverStale ? colors.textSecondary : colors.text, borderColor: colors.background, opacity: driverStale ? 0.75 : 1 }]}>
            <Icon name="car" variant="filled" size="sm" color="background" />
          </View>
        </Marker>
      ) : null}
    </MapView>
  );
});

const styles = StyleSheet.create({
  unavailable: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  unavailableText: { marginTop: 8, maxWidth: 240 },
  pin: { alignItems: 'center' },
  pinHead: { width: 38, height: 38, borderRadius: 19, borderWidth: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pinLabel: { marginTop: 2, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  pinStem: { width: 3, height: 10, borderRadius: 2 },
  vehicle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
});
