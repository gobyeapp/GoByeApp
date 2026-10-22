import { router } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';
import { PageHeader, Screen, SettingsGroup, SettingsRow, Text, spacing } from '@gobye/ui';

const FAQ: { q: string; a: string }[] = [
  { q: 'How do I get paid?', a: 'Riders pay you the full fare by bank transfer to your payout account, or through the GoBye Wallet. GoBye takes no commission.' },
  { q: 'What is the access pass?', a: 'A flat daily or monthly fee that lets you go online. It replaces the per-trip commission other apps charge.' },
  { q: 'Why do I need the rider’s PIN?', a: 'It proves you’ve picked up the right person. Never start a trip without it.' },
  { q: 'What if a rider doesn’t come?', a: 'Wait for the full waiting time after you arrive, then report a no show from the trip screen.' },
];

/** Help and safety for drivers. */
export default function Support() {
  return (
    <Screen header={<PageHeader title="Help and safety" onBack={() => router.back()} />}>
      <View style={styles.groups}>
        <SettingsGroup title="Get help">
          <SettingsRow icon="mail" title="Email driver support" value="support@gobye.app" onPress={() => Linking.openURL('mailto:support@gobye.app?subject=Driver%20support')} />
          <SettingsRow icon="sos" title="Emergency" subtitle="Nigeria emergency number" value="112" onPress={() => Linking.openURL('tel:112')} />
        </SettingsGroup>
        <SettingsGroup title="Common questions">
          {FAQ.map((f) => (
            <View key={f.q} style={styles.faq}>
              <Text variant="subhead" weight="semibold">
                {f.q}
              </Text>
              <Text variant="footnote" color="textSecondary">
                {f.a}
              </Text>
            </View>
          ))}
        </SettingsGroup>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ groups: { gap: spacing.lg, paddingTop: spacing.sm }, faq: { gap: 4, paddingVertical: spacing.md } });
