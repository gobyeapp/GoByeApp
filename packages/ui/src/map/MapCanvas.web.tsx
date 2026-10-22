import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { LatLng } from './types';
import { Icon } from '../icons/Icon';
import { Avatar } from '../components/patterns';
import { Text } from '../components/Text';
import { brand } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import type { MapCanvasHandle, MapCanvasProps } from './MapCanvas';

export type { MapCanvasHandle, MapCanvasProps } from './MapCanvas';

/**
 * WEB / QA ONLY. react-native-maps has no web implementation, so the web build (used only for
 * responsive screenshot testing, docs/RESPONSIVENESS_AUDIT.md) draws a neutral grid with the same
 * markers placed proportionally inside the bounds of the points shown. Native builds never load this file.
 */
export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  { center, pickup, destination, route, driver, driverRoute, driverStale, pickupAvatarUri, pickupName, bottomInset = 0, topInset = 0, onCenterChange, testID },
  ref,
) {
  const { colors } = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  useImperativeHandle(ref, () => ({ recenter() {}, fitAll() {} }));
  useEffect(() => {
    onCenterChange?.(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pts = useMemo(() => [...(route ?? []), ...(driverRoute ?? []), ...[pickup, destination, driver, center].filter(Boolean)] as LatLng[], [route, driverRoute, pickup, destination, driver, center]);
  const bounds = useMemo(() => {
    const lats = pts.map((p) => p.latitude);
    const lngs = pts.map((p) => p.longitude);
    const pad = 0.004;
    return { minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad, minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad };
  }, [pts]);
  const usableH = Math.max(80, size.h - topInset - bottomInset - 80);
  const pos = (p: LatLng) => ({
    left: 40 + ((p.longitude - bounds.minLng) / (bounds.maxLng - bounds.minLng || 1)) * Math.max(1, size.w - 80),
    top: topInset + 40 + ((bounds.maxLat - p.latitude) / (bounds.maxLat - bounds.minLat || 1)) * usableH,
  });
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View testID={testID} onLayout={onLayout} style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceMuted, overflow: 'hidden' }]} accessibilityLabel="Map (web preview)">
      {Array.from({ length: 24 }).map((_, i) => (
        <View key={`v${i}`} style={[styles.gridV, { left: i * 48, backgroundColor: colors.border }]} />
      ))}
      {Array.from({ length: 30 }).map((_, i) => (
        <View key={`h${i}`} style={[styles.gridH, { top: i * 48, backgroundColor: colors.border }]} />
      ))}
      {size.w > 0 && route && route.length > 1
        ? route.map((p, i) => <View key={`r${i}`} style={[styles.dot, pos(p), { backgroundColor: colors.mapRoute }]} />)
        : null}
      {size.w > 0 && pickup ? (
        <View style={[styles.marker, pos(pickup)]}>
          <View style={[styles.pinHead, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
            {pickupAvatarUri ? <Avatar uri={pickupAvatarUri} name={pickupName} size={30} /> : <Icon name="account" variant="filled" size="sm" color="primary" />}
          </View>
          <View style={[styles.label, { backgroundColor: colors.primary }]}>
            <Text variant="caption" color="onPrimary">
              Pickup
            </Text>
          </View>
        </View>
      ) : null}
      {size.w > 0 && destination ? (
        <View style={[styles.marker, pos(destination)]}>
          <View style={[styles.pinHead, { backgroundColor: brand.tangerine, borderColor: colors.surface }]}>
            <Icon name="flag" variant="filled" size="sm" color={brand.white} />
          </View>
        </View>
      ) : null}
      {size.w > 0 && driver ? (
        <View style={[styles.marker, pos(driver)]}>
          <View style={[styles.vehicle, { backgroundColor: driverStale ? colors.textSecondary : colors.text, borderColor: colors.background }]}>
            <Icon name="car" variant="filled" size="sm" color="background" />
          </View>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  dot: { position: 'absolute', width: 5, height: 5, borderRadius: 3, marginLeft: -2, marginTop: -2 },
  marker: { position: 'absolute', alignItems: 'center', marginLeft: -19, marginTop: -19 },
  pinHead: { width: 38, height: 38, borderRadius: 19, borderWidth: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  label: { marginTop: 2, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  vehicle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
});
