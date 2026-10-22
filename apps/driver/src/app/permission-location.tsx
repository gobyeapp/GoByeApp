import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Screen, ScreenHeader, Text, layout, spacing, useTheme, type IconName } from '@gobye/ui';
import { useDriver } from '@/state/driver';
import { openLocationSettings } from '@/state/location';
import { useHaptics } from '@/state/settings';

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'locate', title: 'Only while you’re online or on a trip', body: 'Go offline and GoBye stops using your location.' },
  { icon: 'route', title: 'So riders see you coming', body: 'Your position is shared with your rider until the trip ends, then stops.' },
  { icon: 'navigation', title: 'Precise location, please', body: 'Approximate location can put you on the wrong side of the road.' },
];

/**
 * D10 Location explanation before the system prompt (HIG pre-permission: one Continue button).
 * Asks for When In Use + precise only (D-026). Background tracking needs a production build, so the
 * driver is told to keep the app open while online.
 */
export default function PermissionLocation() {
  const { colors } = useTheme();
  const d = useDriver();
  const haptic = useHaptics();
  const [busy, setBusy] = useState(false);
  const denied = d.location.permission === 'denied' || d.location.permission === 'restricted';

  const proceed = async () => {
    setBusy(true);
    d.markPrimerSeen();
    const p = await d.requestLocation();
    if (p === 'when_in_use_precise' || p === 'always_precise') {
      const r = d.hasAccess ? await d.goOnline() : null;
      setBusy(false);
      if (r?.ok) haptic('success');
      router.back();
      if (!d.hasAccess) router.push('/access');
      return;
    }
    setBusy(false);
  };

  return (
    <Screen
      header={<ScreenHeader backIcon="close" onBack={() => router.back()} />}
      footer={
        denied ? (
          <Button title="Open Settings" onPress={openLocationSettings} />
        ) : (
          <Button title="Continue" onPress={proceed} loading={busy} testID="permission-continue" />
        )
      }
    >
      <View style={[styles.hero, { backgroundColor: colors.surfaceMuted }]}>
        <Icon name="locate" size="xl" color="text" />
      </View>
      <Text variant="title1" accessibilityRole="header">
        {denied ? 'Location is off for GoBye Driver' : 'Share your location while you drive'}
      </Text>
      <Text variant="callout" color="textSecondary" style={styles.lead}>
        {denied
          ? 'Turn on Location (While Using the App) and Precise Location in Settings to receive trip requests.'
          : 'GoBye matches you with riders nearby and guides them to your car.'}
      </Text>
      <View style={styles.points}>
        {POINTS.map((p) => (
          <View key={p.title} style={styles.point}>
            <View style={[styles.pointIcon, { backgroundColor: colors.surfaceMuted }]}>
              <Icon name={p.icon} size="sm" color="text" />
            </View>
            <View style={styles.flex}>
              <Text variant="headline">{p.title}</Text>
              <Text variant="footnote" color="textSecondary">
                {p.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <Text variant="footnote" color="textSecondary">
        Keep GoBye Driver open while you’re online. In this preview, location stops when the app is in the background.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { width: 72, height: 72, borderRadius: layout.cardRadius, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, marginBottom: spacing.lg },
  lead: { marginTop: spacing.sm },
  points: { gap: spacing.lg, marginVertical: spacing.xxl },
  point: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  pointIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
