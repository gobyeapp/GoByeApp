import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateNigerianPhone } from '@gobye/core';
import { AuthStepHeader, Button, Screen, ScreenHeader, SimulatedBadge, Text, TextField, Wordmark, spacing } from '@gobye/ui';
import { useSession } from '@/state/session';

/**
 * D02 Driver sign in or sign up, step 1 of 2 (phone + OTP, D-008 — shared steps from @gobye/ui).
 * The number stays in the field after an error so the driver only fixes what's wrong.
 */
export default function PhoneSignIn() {
  const { requestOtp } = useSession();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    const v = validateNigerianPhone(phone);
    if (!v.ok) return setError(v.error);
    setError(undefined);
    setSubmitting(true);
    const r = await requestOtp(v.value);
    setSubmitting(false);
    if (!r.ok) return setError(r.error);
    router.push('/auth/otp');
  };

  return (
    <Screen
      header={router.canGoBack() ? <ScreenHeader onBack={() => router.back()} /> : undefined}
      footer={
        <>
          <Button title="Continue" onPress={submit} loading={submitting} disabled={!phone.trim()} testID="send-code" />
          <Text variant="caption" color="textSecondary" align="center">
            By continuing you agree to the Driver Terms and Privacy Policy.
          </Text>
        </>
      }
    >
      <View style={styles.brand}>
        <Wordmark size={28} />
      </View>
      <AuthStepHeader step={1} total={2} title="Your phone number" subtitle="Riders reach you on it at pickup. We’ll text you a 6 digit code to confirm it." />
      <TextField
        label="Mobile number"
        prefix="+234"
        placeholder="803 123 4567"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        value={phone}
        onChangeText={(t) => {
          setPhone(t);
          if (error) setError(undefined);
        }}
        onSubmitEditing={submit}
        error={error}
        editable={!submitting}
        testID="phone-input"
        autoFocus
      />
      <View style={styles.note}>
        <SimulatedBadge />
        <Text variant="footnote" color="textSecondary" style={styles.flex}>
          No SMS in this preview. Any 6 digit code works.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { marginTop: spacing.sm },
  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
});
