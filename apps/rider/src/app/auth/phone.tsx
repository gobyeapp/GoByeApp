import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateNigerianPhone } from '@gobye/core';
import { Button, Screen, SimulatedBadge, Text, TextField, Wordmark, spacing } from '@gobye/ui';
import { AuthStepHeader } from '@/features/auth/AuthStep';
import { useSession } from '@/state/session';

/**
 * R03 Phone sign in or sign up, step 1 of 3 (phone + OTP, D-008; no social login so Guideline 4.8 is not
 * triggered). The number stays in the field after an error so the passenger only fixes what's wrong.
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
      footer={
        <>
          <Button title="Continue" onPress={submit} loading={submitting} disabled={!phone.trim()} testID="send-code" />
          <Text variant="caption" color="textSecondary" align="center">
            By continuing you agree to the Terms and Privacy Policy.
          </Text>
        </>
      }
    >
      <View style={styles.brand}>
        <Wordmark size={28} />
      </View>
      <AuthStepHeader step={1} title="What’s your number?" subtitle="We’ll text you a 6 digit code." />
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
  brand: { marginTop: spacing.lg },
  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
});
