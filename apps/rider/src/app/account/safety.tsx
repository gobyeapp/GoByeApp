import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { validateName, validateNigerianPhone, formatPhone } from '@gobye/core';
import { Button, Card, Icon, Screen, Section, Text, TextField, spacing, useTheme, useToast } from '@gobye/ui';
import { PageHeader, SettingsGroup, SettingsRow } from '@/features/account/ui';
import { useAccount } from '@/state/account';

/**
 * R25 — Safety. GoBye has no emergency response service in this preview (BR-120): the SOS action
 * opens the phone dialler for Nigeria's national emergency number 112 — it does not alert GoBye.
 */
export default function Safety() {
  const { colors } = useTheme();
  const toast = useToast();
  const { trustedContact, setTrustedContact } = useAccount();
  const [name, setName] = useState(trustedContact?.name ?? '');
  const [phone, setPhone] = useState(trustedContact?.phone ?? '');
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});

  const save = () => {
    const n = validateName(name, 'Name');
    const p = validateNigerianPhone(phone);
    setErrors({ name: n.ok ? undefined : n.error, phone: p.ok ? undefined : p.error });
    if (!n.ok || !p.ok) return;
    setTrustedContact({ name: n.value, phone: p.value });
    toast('Trusted contact saved on this device', 'success');
  };

  return (
    <Screen header={<PageHeader title="Safety and emergency" onBack={() => router.back()} />}>
      <Card style={[styles.sos, { borderColor: colors.danger }]}>
        <View style={styles.row}>
          <Icon name="sos" variant="filled" color="danger" />
          <Text variant="headline" style={styles.flex}>
            In an emergency
          </Text>
        </View>
        <Text variant="callout" color="textSecondary">
          Call 112, Nigeria’s emergency number. In this preview, GoBye alerts nobody.
        </Text>
        <Button title="Call 112" variant="destructive" leadingIcon="phone" onPress={() => Linking.openURL('tel:112').catch(() => toast('Calling isn’t available on this device', 'error'))} />
      </Card>

      <SettingsGroup title="Before every trip">
        <SettingsRow icon="car" title="Check the plate and car" subtitle="Match the plate, colour and model in the app." trailing="none" />
        <SettingsRow icon="account" title="Confirm the driver’s name" subtitle="Ask who they’re here for before you get in." trailing="none" />
        <SettingsRow icon="share" title="Share your trip" subtitle="Send your trip to someone you trust." trailing="none" />
      </SettingsGroup>

      <Section title="Trusted contact">
        <Text variant="footnote" color="textSecondary">
          {trustedContact ? `Saved: ${trustedContact.name}, ${formatPhone(trustedContact.phone)}` : 'Stored only on this device in this preview.'}
        </Text>
        <TextField label="Name" value={name} onChangeText={setName} error={errors.name} />
        <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" prefix="+234" error={errors.phone} />
        <Button title="Save contact" variant="secondary" onPress={save} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sos: { gap: spacing.md, borderWidth: 1.5 },
});
