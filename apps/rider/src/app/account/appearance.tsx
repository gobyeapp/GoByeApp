import { router } from 'expo-router';
import { Appearance, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Screen, Text, darkColors, layout, lightColors, spacing, useTheme, type AppearancePreference, type IconName } from '@gobye/ui';
import { PageHeader, SettingsGroup } from '@/features/account/ui';
import { useAccount } from '@/state/account';

const OPTIONS: { id: AppearancePreference; title: string; icon: IconName; subtitle?: string }[] = [
  { id: 'light', title: 'Light', icon: 'settings' },
  { id: 'dark', title: 'Dark', icon: 'settings' },
  { id: 'system', title: 'System', icon: 'phone', subtitle: 'Match phone' },
];

/** Appearance (brief §1): Light, Dark or System, remembered on this device. */
export default function AppearanceScreen() {
  const { settings, updateSettings } = useAccount();
  const { colors } = useTheme();
  const systemNow = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <Screen header={<PageHeader title="Appearance" onBack={() => router.back()} />}>
      {/* Visual previews of the two themes, selected one outlined with a check */}
      <View style={styles.previews} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
        {OPTIONS.map((o) => {
          const selected = settings.appearance === o.id;
          const look = o.id === 'system' ? systemNow : o.id;
          // Thumbnails always show the theme they represent, whatever the current appearance is.
          const t = look === 'dark' ? darkColors : lightColors;
          return (
            <Pressable
              key={o.id}
              onPress={() => updateSettings({ appearance: o.id })}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={o.id === 'system' ? `System, currently ${systemNow}` : o.title}
              testID={`appearance-${o.id}`}
              style={styles.option}
            >
              <View style={[styles.preview, { borderColor: selected ? colors.primary : colors.border, borderWidth: selected ? 2 : StyleSheet.hairlineWidth, backgroundColor: t.background }]}>
                <View style={[styles.previewBar, { backgroundColor: t.secondary, width: '70%' }]} />
                <View style={[styles.previewBar, { backgroundColor: t.secondary, width: '45%' }]} />
                <View style={[styles.previewButton, { backgroundColor: t.primary }]} />
                {selected ? (
                  <View style={[styles.check, { backgroundColor: colors.primary }]}>
                    <Icon name="check" size={12} color="onPrimary" />
                  </View>
                ) : null}
              </View>
              <Text variant="subhead" weight={selected ? 'semibold' : 'medium'} align="center">
                {o.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <SettingsGroup>
        <View style={styles.note}>
          <Text variant="footnote" color="textSecondary">
            {settings.appearance === 'system' ? `Following your phone (${systemNow}).` : `Always ${settings.appearance}.`}
          </Text>
        </View>
      </SettingsGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  previews: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.sm },
  option: { flex: 1, gap: spacing.sm },
  preview: { aspectRatio: 0.72, borderRadius: layout.controlRadius, padding: spacing.sm, gap: 6, justifyContent: 'flex-start' },
  previewBar: { height: 8, borderRadius: 4 },
  previewButton: { marginTop: 'auto', height: 14, borderRadius: 7 },
  check: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  note: { paddingVertical: spacing.md },
});
