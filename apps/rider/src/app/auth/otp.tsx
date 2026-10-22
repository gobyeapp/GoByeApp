import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatPhone, validateOtp } from '@gobye/core';
import { Button, CodeBoxes, FieldMessage, Screen, Text, spacing, useToast } from '@gobye/ui';
import { AuthHeading, AuthTopBar, TextLink } from '@/features/auth/AuthKit';
import { resetTo } from '@/features/navigation/reset';
import { useNow } from '@/state/useNow';
import { useSession } from '@/state/session';

/** Verify your number (owner design): six code boxes, auto submit, resend countdown, stable error slot. */
export default function OtpScreen() {
  const { pendingPhone, verifyOtp, requestOtp } = useSession();
  // Coming from Create account: finish on the rider pass.
  const { next } = useLocalSearchParams<{ next?: string }>();
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
    resetTo(r.value.isNewUser ? '/auth/name' : next === 'pass' ? '/auth/pass' : '/(tabs)');
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
      header={<View style={styles.pad}><AuthTopBar onBack={() => router.back()} /></View>}
      footer={
        <>
          <Button variant="brand" title={verified ? 'Verified' : 'Verify'} onPress={() => submit()} loading={submitting} disabled={code.length < 6 || verified} testID="verify-code" />
          <View style={styles.center}>
            <TextLink title="Change number" onPress={() => router.back()} />
          </View>
        </>
      }
    >
      <AuthHeading
        centered
        icon="phone"
        title="Verify your number"
        subtitle={
          <>
            Enter the 6 digit code we sent to{' '}
            <Text variant="body" weight="semibold">
              {pendingPhone ? formatPhone(pendingPhone) : 'your phone'}
            </Text>
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
      <View style={styles.center}>
        {wait > 0 ? (
          <Text variant="callout" color="textSecondary">
            Resend code in{' '}
            <Text variant="callout" weight="semibold" tabular>
              0:{String(wait).padStart(2, '0')}
            </Text>
          </Text>
        ) : (
          <View style={styles.row}>
            <Text variant="callout" color="textSecondary">
              Didn’t get it?
            </Text>
            <TextLink title="Resend code" accent onPress={resend} testID="resend-code" />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 20 },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
