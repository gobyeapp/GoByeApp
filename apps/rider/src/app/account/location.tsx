import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Screen, StatusBadge, Text, layout, spacing, useTheme, type StatusKind } from '@gobye/ui';
import { PageHeader, SettingsGroup, SettingsRow } from '@/features/account/ui';
import { useCurrentLocation, type PermissionState } from '@/state/location';

const STATE: Record<PermissionState, { kind: StatusKind; label: string; body: string }> = {
  granted: { kind: 'successful', label: 'Allowed while using the app', body: 'Used to set your pickup while the app is open. Never in the background.' },
  undetermined: { kind: 'neutral', label: 'Not asked yet', body: 'We’ll ask when you set a pickup. You can type an address instead.' },
  unknown: { kind: 'neutral', label: 'Checking', body: 'Checking your phone’s setting.' },
  denied: { kind: 'failed', label: 'Not allowed', body: 'Type your pickup, or allow location in Settings.' },
  restricted: { kind: 'failed', label: 'Turned off in Settings', body: 'Type your pickup, or turn location on in Settings.' },
};

const SHORT: Record<PermissionState, string> = { granted: 'While using', undetermined: 'Not asked', unknown: 'Checking', denied: 'Not allowed', restricted: 'Off' };

/** Location access status (brief §13). Permission is changed in the phone's Settings. */
export default function LocationAccess() {
  const { colors } = useTheme();
  const loc = useCurrentLocation();
  const st = STATE[loc.permission];
  return (
    <Screen header={<PageHeader title="Location access" onBack={() => router.back()} />} footer={<Button title="Open Settings" variant="secondary" leadingIcon="settings" onPress={loc.openSettings} />}>
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name="locate" size="lg" color="text" />
        </View>
        <StatusBadge kind={st.kind} label={st.label} />
        <Text variant="callout" color="textSecondary" align="center">
          {loc.permission === 'granted' && loc.approximate ? 'Approximate location can misplace your pickup. Turn on Precise Location in Settings.' : st.body}
        </Text>
      </View>
      <SettingsGroup title="Details">
        <SettingsRow icon="locate" title="Permission" value={SHORT[loc.permission]} trailing="none" />
        <SettingsRow icon="map" title="Accuracy" value={loc.permission !== 'granted' ? 'Not available' : loc.approximate ? `Approximate${loc.accuracyMeters ? `, ±${Math.round(loc.accuracyMeters)} m` : ''}` : 'Precise'} trailing="none" />
        <SettingsRow icon="shield" title="Background tracking" value="Never" trailing="none" />
      </SettingsGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg, paddingHorizontal: spacing.sm },
  heroIcon: { width: 64, height: 64, borderRadius: layout.cardRadius, alignItems: 'center', justifyContent: 'center' },
});
