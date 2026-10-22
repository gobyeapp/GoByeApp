import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateNigerianPhone } from '@gobye/core';
import { Button, Icon, Screen, Text, TextField, layout, spacing, useTheme } from '@gobye/ui';
import { AuthHeading, AuthTopBar } from '@/features/auth/AuthKit';
import { useSession } from '@/state/session';

/**
 * Your phone number (owner design). Used when an Apple / Google account is new: GoBye still needs a
 * verified number so the driver can reach the rider at pickup.
 */
export default function PhoneScreen() {
  const { colors } = useTheme();
  const { requestOtp } = useSession();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const v = validateNigerianPhone(phone);
    if (!v.ok) return setError(v.error);
    setBusy(true);
    const r = await requestOtp(v.value);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push('/auth/otp');
  };

  return (
    <Screen
      header={<View style={styles.pad}><AuthTopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding'))} /></View>}
      footer={
        <>
          <Button variant="brand" title="Send code" onPress={submit} loading={busy} disabled={!phone.trim()} testID="send-code" />
          <Text variant="caption" weight="regular" color="textSecondary" align="center">
            Standard SMS rates may apply.
          </Text>
        </>
      }
    >
      <AuthHeading
        title="Your phone number"
        subtitle="We’ll text you a code."
      />
      <TextField
        label="Phone number"
        prefix="+234"
        placeholder="803 123 4567"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        value={phone}
        onChangeText={(t) => {
          setPhone(t);
          setError(undefined);
        }}
        onSubmitEditing={submit}
        error={error}
        autoFocus
        testID="phone-input"
      />
      <View style={[styles.info, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Icon name="shield" size="sm" color="accent" />
        <Text variant="callout" color="textSecondary" style={styles.flex}>
          We only use your number for your trips and to keep your account secure.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 20 },
  flex: { flex: 1 },
  info: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', padding: spacing.lg, borderRadius: layout.controlRadius + 2, borderWidth: StyleSheet.hairlineWidth, marginTop: spacing.lg },
});
