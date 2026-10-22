import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatPhone, validateOtp } from '@gobye/core';
import { AuthStepHeader, Button, CodeBoxes, FieldMessage, Screen, ScreenHeader, Text, spacing, useToast } from '@gobye/ui';
import { resetTo } from '@/features/navigation/reset';
import { useNow } from '@/state/useNow';
import { useSession } from '@/state/session';

/** D02 OTP verification, step 2 of 2: six code boxes, auto submit, resend cooldown, stable error slot. */
export default function OtpScreen() {
  const { pendingPhone, verifyOtp, requestOtp } = useSession();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resendAt, setResendAt] = useState(() => Date.now() + 30_000);
  const now = useNow(1000);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const submit = async (value = code) => {
    if (submitting || verified) return;
    const v = validateOtp(value);
    if (!v.ok) return setError(v.error);
    setSubmitting(true);
    const r = await verifyOtp(v.value);
    setSubmitting(false);
    if (!r.ok) return setError(r.error);
    setVerified(true);
    resetTo('/');
  };

  const resend = async () => {
    if (!pendingPhone) return;
    const r = await requestOtp(pendingPhone);
    if (r.ok) {
      setResendAt(Date.now() + r.value.resendAfterSeconds * 1000);
      setCode('');
      setError(undefined);
      toast('New code sent (simulated).', 'success');
    }
  };

  return (
    <Screen
      header={<ScreenHeader onBack={() => router.back()} />}
      footer={<Button title={verified ? 'Verified' : 'Verify'} onPress={() => submit()} loading={submitting} disabled={code.length < 6 || verified} testID="verify-code" />}
    >
      <AuthStepHeader
        step={2}
        total={2}
        title="Enter the code"
        subtitle={
          <>
            Sent to{' '}
            <Text variant="callout" weight="semibold">
              {pendingPhone ? formatPhone(pendingPhone) : 'your phone'}
            </Text>
            .
          </>
        }
      />
      <CodeBoxes
        value={code}
        onChange={(digits) => {
          setCode(digits);
          setError(undefined);
          if (digits.length === 6) void submit(digits);
        }}
        error={!!error}
        verified={verified}
        disabled={submitting}
        testID="otp-input"
      />
      <FieldMessage error={error} info={submitting ? 'Checking your code…' : 'Preview: any code except 000000.'} />
      <View style={styles.resend}>
        <Text variant="callout" color="textSecondary">
          Didn’t get it?
        </Text>
        <Button title={wait > 0 ? `Resend in ${wait}s` : 'Resend code'} variant="tertiary" size="md" disabled={wait > 0} onPress={resend} testID="resend-code" />
      </View>
      <Button title="Change number" variant="tertiary" size="md" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  resend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
});
