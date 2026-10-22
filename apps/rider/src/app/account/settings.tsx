import { router } from 'expo-router';
import { Linking } from 'react-native';
import { Screen, Text } from '@gobye/ui';
import { PageHeader, SettingsGroup, SettingsRow } from '@/features/account/ui';

/** Legal and licences (route kept as /account/settings). Grouped preferences live on the Account tab. */
export default function Legal() {
  const open = () => Linking.openURL('https://gobye.app').catch(() => undefined);
  return (
    <Screen header={<PageHeader title="Legal and licences" onBack={() => router.back()} />}>
      <SettingsGroup title="Policies">
        <SettingsRow icon="lock" title="Privacy Policy" subtitle="Draft, not yet published" onPress={open} />
        <SettingsRow icon="document" title="Terms of Service" subtitle="Draft, not yet published" onPress={open} />
      </SettingsGroup>
      <SettingsGroup title="Open source licences">
        <SettingsRow icon="info" title="MingCute Icons" value="Apache 2.0" trailing="none" />
        <SettingsRow icon="info" title="Inter typeface" value="SIL OFL 1.1" trailing="none" />
        <SettingsRow icon="info" title="React Native and Expo" value="MIT" trailing="none" />
      </SettingsGroup>
      <Text variant="footnote" color="textSecondary">
        GoBye preview 0.1.0. Drivers, ETAs, payments and verification are simulated.
      </Text>
    </Screen>
  );
}
