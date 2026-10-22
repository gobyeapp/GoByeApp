import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Sheet, Text, layout, radii, shadows, spacing, useTheme, useToast, type IconName } from '@gobye/ui';
import { useCurrentLocation } from '@/state/location';
import { useHaptics } from '@/state/haptics';
import { useLocatePickup } from './useLocatePickup';

/**
 * Change pickup (brief §4). Three ways to set the pickup, in a clear order of importance:
 *  1. Search for an address — the primary action: a raised card with the strongest label.
 *  2. Choose on map — a quieter row.
 *  3. Use my location — a quick action whose accuracy is supporting detail. Handles every permission
 *     state in place (ask via the pre-permission screen, open Settings, still locating, lookup failed).
 * Dismissing the sheet changes nothing: the pickup and the map stay as they were.
 */
export function PickupSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, scheme } = useTheme();
  const toast = useToast();
  const haptic = useHaptics();
  const location = useCurrentLocation();
  const { locate, busy } = useLocatePickup();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  const leave = (fn: () => void) => {
    onClose();
    fn();
  };

  const searchAddress = () => leave(() => router.push({ pathname: '/booking/search', params: { field: 'pickup' } }));
  const chooseOnMap = () => leave(() => router.push('/booking/pickup-map'));

  const useMyLocation = async () => {
    if (busy) return;
    setError(null);
    if (location.permission === 'denied' || location.permission === 'restricted') return location.openSettings();
    // Never prompt cold: the pre-permission screen explains first, then sets the pickup (next=pickup).
    if (location.permission !== 'granted') return leave(() => router.push({ pathname: '/permission-location', params: { next: 'pickup' } }));
    const r = await locate();
    if (!r.ok) {
      haptic('error');
      return setError(r.error);
    }
    haptic('success');
    onClose();
    toast('Pickup set to your current location', 'success');
  };

  const off = location.permission === 'denied' || location.permission === 'restricted';
  const locationDetail = busy
    ? 'Finding you…'
    : off
      ? 'Location is off. Turn it on in Settings.'
      : location.permission !== 'granted'
        ? 'Allow location access to use this'
        : location.accuracyMeters
          ? `Accurate to about ${Math.max(5, Math.round(location.accuracyMeters))} m`
          : 'Uses your phone’s GPS';

  const raised = scheme === 'dark' ? colors.surfaceSelected : colors.card;

  return (
    <Sheet visible={visible} onClose={onClose} title="Change pickup" headerAlign="leading" testID="pickup-sheet">
      {/* 1. Primary: search. */}
      <Pressable
        onPress={searchAddress}
        accessibilityRole="button"
        accessibilityLabel="Search for an address"
        accessibilityHint="Opens address search"
        testID="pickup-search"
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: pressed ? colors.surfaceMuted : raised, borderColor: colors.border },
          scheme === 'light' && shadows.card,
          pressed && styles.pressedScale,
        ]}
      >
        <View style={styles.primaryIcon}>
          <Icon name="search" size="md" color="text" />
        </View>
        <View style={styles.flex}>
          <Text variant="headline">Search for an address</Text>
          <Text variant="footnote" color="textSecondary" numberOfLines={1}>
            Street, landmark or place
          </Text>
        </View>
        <Icon name="chevronRight" size={16} color="textSecondary" />
      </Pressable>

      {/* 2 and 3. Quieter rows, icons aligned with the search icon above. */}
      <View style={styles.rows}>
        <ActionRow icon="map" title="Choose on map" detail="Drag the map to pinpoint your pickup." onPress={chooseOnMap} chevron testID="pickup-on-map" />
        <ActionRow
          icon="locate"
          title="Use my location"
          detail={locationDetail}
          onPress={useMyLocation}
          loading={busy}
          accessibilityHint={off ? 'Opens Settings' : undefined}
          testID="pickup-my-location"
        />
        {error ? (
          <View style={styles.error} accessibilityLiveRegion="polite">
            <Icon name="warning" size="xs" color="danger" />
            <Text variant="footnote" color="danger" style={styles.flex}>
              {error}
            </Text>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

function ActionRow({
  icon,
  title,
  detail,
  onPress,
  chevron,
  loading,
  accessibilityHint,
  testID,
}: {
  icon: IconName;
  title: string;
  detail: string;
  onPress: () => void;
  chevron?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: !!loading }}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size="sm" color="text" />
      </View>
      <View style={styles.flex}>
        <Text variant="callout" weight="medium">
          {title}
        </Text>
        <Text variant="caption" weight="regular" color="textSecondary" numberOfLines={2}>
          {detail}
        </Text>
      </View>
      {loading ? <ActivityIndicator size="small" color={colors.textSecondary} /> : chevron ? <Icon name="chevronRight" size={14} color="textSecondary" /> : null}
    </Pressable>
  );
}

const ICON_COL = 24;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressedScale: { transform: [{ scale: 0.99 }] },
  primaryIcon: { width: ICON_COL, alignItems: 'center' },
  rows: { gap: spacing.xxs, marginTop: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: layout.controlRadius,
  },
  rowIcon: { width: ICON_COL, alignItems: 'center' },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
});
