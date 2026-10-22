import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateEmail, validatePassword } from '@gobye/core';
import { Button, CodeBoxes, FieldMessage, Screen, Text, TextField, spacing, useToast } from '@gobye/ui';
import { AuthHeading, AuthTopBar, PasswordField, TextLink } from '@/features/auth/AuthKit';
import { useNow } from '@/state/useNow';
import { useSession } from '@/state/session';

/**
 * Reset password (owner design), two steps on one screen: the account email → a 6 digit code from the
 * email plus a new password. The request always "succeeds" for a valid email so it can't be used to
 * find out who has an account.
 */
export default function ResetPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { requestPasswordReset, resetPassword } = useSession();
  const toast = useToast();
  const now = useNow(1000);
  const [email, setEmail] = useState(params.email ?? '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; code?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const send = async () => {
    const e = validateEmail(email);
    if (!e.ok || !e.value) return setErrors({ email: 'Enter the email on your account.' });
    setBusy(true);
    const r = await requestPasswordReset(e.value);
    setBusy(false);
    if (!r.ok) return setErrors({ email: r.error });
    setSentTo(r.value.email);
    setResendAt(Date.now() + r.value.resendAfterSeconds * 1000);
    setCode('');
    setErrors({});
  };

  const save = async () => {
    if (!sentTo || busy) return;
    const pw = validatePassword(password);
    const next = { code: code.length === 6 ? undefined : 'Enter the 6 digit code.', password: pw.ok ? undefined : pw.error };
    setErrors(next);
    if (next.code || next.password) return;
    setBusy(true);
    const r = await resetPassword(sentTo, code, password);
    setBusy(false);
    if (!r.ok) return setErrors({ code: r.error });
    toast('Password updated. Sign in with your new password.', 'success');
    router.replace('/auth/signin');
  };

  const back = () => (sentTo ? setSentTo(null) : router.canGoBack() ? router.back() : router.replace('/auth/signin'));

  if (!sentTo) {
    return (
      <Screen
        header={<View style={styles.pad}><AuthTopBar onBack={back} /></View>}
        footer={<Button variant="brand" title="Send code" trailingIcon="arrowRight" onPress={send} loading={busy} disabled={!email.trim()} testID="reset-send" />}
      >
        <AuthHeading centered icon="mail" title="Reset password" subtitle="Enter the email on your account and we’ll send you a 6 digit code." />
        <TextField label="Email address" leadingIcon="mail" placeholder="name@example.com" value={email} onChangeText={(t) => { setEmail(t); setErrors({}); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" autoComplete="email" error={errors.email} onSubmitEditing={send} testID="reset-email" />
      </Screen>
    );
  }

  return (
    <Screen
      header={<View style={styles.pad}><AuthTopBar onBack={back} /></View>}
      footer={
        <>
          <Button variant="brand" title="Save new password" onPress={save} loading={busy} disabled={code.length < 6 || !password} testID="reset-save" />
          <Text variant="caption" weight="regular" color="textSecondary" align="center">
            Can’t find it? Check your spam or promotions folder.
          </Text>
        </>
      }
    >
      <AuthHeading
        centered
        icon="mail"
        title="Reset password"
        subtitle={
          <>
            We sent a 6 digit code to{' '}
            <Text variant="body" weight="semibold">
              {sentTo}
            </Text>
            . Enter it to set a new password.
          </>
        }
      />
      <CodeBoxes value={code} onChange={(v) => { setCode(v); setErrors((e) => ({ ...e, code: undefined })); }} error={!!errors.code} label="Reset code" testID="reset-code" />
      <FieldMessage error={errors.code} info="Preview: no email is sent. Any code except 000000 works." />
      <View style={styles.resend}>
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
            <TextLink title="Resend code" accent onPress={send} />
          </View>
        )}
      </View>
      <PasswordField label="New password" placeholder="Create a new password" value={password} onChangeText={(t) => { setPassword(t); setErrors((e) => ({ ...e, password: undefined })); }} textContentType="newPassword" autoComplete="new-password" helper="At least 8 characters, with a number." error={errors.password} testID="reset-password" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 20 },
  resend: { alignItems: 'center', marginBottom: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
