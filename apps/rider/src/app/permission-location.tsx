import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Illustration, Screen, Text, layout, spacing, useTheme } from '@gobye/ui';
import { useCurrentLocation } from '@/state/location';
import { useSession } from '@/state/session';

const POINTS = [
  'Set your pickup automatically. You can edit it.',
  'Show nearby drivers and their arrival time.',
  'Only while you use the app.',
];

/**
 * R06 Location pre permission (D-017), explanatory layout like the bank reference: illustration,
 * title, short explanation, a grouped list of what it's used for, one "Continue" button (Apple HIG:
 * no Cancel on a pre permission screen). Whatever the passenger chooses, they continue; manual pickup
 * is always available.
 */
export default function LocationPermission() {
  const { colors } = useTheme();
  const { request } = useCurrentLocation();
  const { markLocationPrimerSeen } = useSession();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [busy, setBusy] = useState(false);

  const proceed = async () => {
    if (busy) return;
    setBusy(true);
    await request();
    markLocationPrimerSeen();
    setBusy(false);
    if (next === 'search') router.replace({ pathname: '/booking/search', params: { field: 'destination' } });
    else router.back();
  };

  return (
    <Screen footer={<Button title="Continue" onPress={proceed} loading={busy} testID="location-continue" />}>
      <View style={styles.body}>
        <View style={[styles.art, { backgroundColor: colors.surfaceMuted }]}>
          <Illustration name="destination" size={128} />
        </View>
        <View style={styles.copy}>
          <Text variant="title1" align="center" accessibilityRole="header">
            Find your pickup faster
          </Text>
          <Text variant="callout" color="textSecondary" align="center">
            GoBye uses your location while you use the app.
          </Text>
        </View>
        <View style={[styles.group, { backgroundColor: colors.surfaceMuted }]}>
          <Text variant="footnote" weight="semibold" color="textSecondary" style={styles.groupTitle}>
            We use it to
          </Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.groupBody}>
            {POINTS.map((p) => (
              <View key={p} style={styles.point}>
                <Icon name="check" size="sm" color="text" />
                <Text variant="callout" style={styles.flex}>
                  {p}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.footNote}>
          <Icon name="lock" size="xs" color="textSecondary" />
          <Text variant="footnote" color="textSecondary" align="center">
            Change this in Settings any time.
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { gap: spacing.xl, paddingTop: spacing.xl, alignItems: 'stretch' },
  art: { alignSelf: 'center', width: 168, height: 168, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  copy: { gap: spacing.sm },
  group: { borderRadius: layout.cardRadius, overflow: 'hidden' },
  groupTitle: { paddingHorizontal: layout.container, paddingVertical: spacing.md },
  divider: { height: StyleSheet.hairlineWidth },
  groupBody: { padding: layout.container, gap: spacing.md },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  footNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
});
