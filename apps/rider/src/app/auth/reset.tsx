import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { validateEmail, validatePassword } from '@gobye/core';
import { CodeBoxes, FieldMessage, Icon, JourneyField, JourneyFlow, PasswordRules, PreviewNote, spacing, StepTitle, Text, TextLink, useToast } from '@gobye/ui';
import { useHaptics } from '@/state/haptics';
import { useNow } from '@/state/useNow';
import { useSession } from '@/state/session';

const STEPS = ['Email', 'Code', 'New password'];

/**
 * Reset password as a three-step journey, no scrolling: account email → the 6 digit code from the email
 * → a new password. The code is checked when the new password is saved; a wrong code goes back to the
 * code step. The request always "succeeds" for a valid email so it can't reveal who has an account.
 */
export default function ResetPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const reduce = useReducedMotion();
  const toast = useToast();
  const haptic = useHaptics();
  const now = useNow(1000);
  const { requestPasswordReset, resetPassword } = useSession();
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState(params.email ?? '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; code?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    const ref = step === 0 ? emailRef : step === 2 ? pwRef : null;
    const t = setTimeout(() => ref?.current?.focus(), reduce ? 50 : 520);
    return () => clearTimeout(t);
  }, [step, reduce]);

  const send = async () => {
    const e = validateEmail(email);
    if (!e.ok || !e.value) {
      haptic('error');
      return setErrors({ email: 'Enter the email on your account.' });
    }
    setBusy(true);
    const r = await requestPasswordReset(e.value);
    setBusy(false);
    if (!r.ok) return setErrors({ email: r.error });
    setSentTo(r.value.email);
    setResendAt(Date.now() + r.value.resendAfterSeconds * 1000);
    setCode('');
    setErrors({});
    setStep(1);
  };

  const submit = async () => {
    if (busy) return;
    if (step === 0) return send();
    if (step === 1) {
      if (code.length < 6) {
        haptic('error');
        return setErrors({ code: 'Enter the 6 digit code.' });
      }
      setErrors({});
      haptic('selection');
      return setStep(2);
    }
    const pw = validatePassword(password);
    if (!pw.ok) {
      haptic('error');
      return setErrors({ password: pw.error });
    }
    setBusy(true);
    const r = await resetPassword(sentTo ?? email, code, password);
    setBusy(false);
    if (!r.ok) {
      // The code is what failed: take the rider back to it.
      setCode('');
      setStep(1);
      return setErrors({ code: r.error });
    }
    haptic('success');
    toast('Password updated. Sign in with your new password.', 'success');
    router.replace('/auth/signin');
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/auth/signin'));

  return (
    <JourneyFlow
      title="Reset password"
      labels={STEPS}
      step={step}
      onClose={close}
      onBack={() => {
        setErrors({});
        setStep(step - 1);
      }}
      cta={{ title: step === 0 ? 'Send code' : step === 1 ? 'Continue' : 'Save new password', onPress: submit, loading: busy, testID: 'reset-submit' }}
      footnote={<PreviewNote text="Preview · any code but 000000 works" />}
      steps={[
        <>
          <StepTitle title="Which email?" />
          <JourneyField
            ref={emailRef}
            icon="mail"
            label="Email address"
            placeholder="name@example.com"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              setErrors({});
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            onSubmitEditing={submit}
            error={errors.email}
            testID="reset-email"
          />
        </>,
        <>
          <StepTitle
            title="Enter the code"
            hint={sentTo ? `Sent to ${sentTo}` : undefined}
          />
          <CodeBoxes
            value={code}
            onChange={(v) => {
              setCode(v);
              setErrors({});
              if (v.length === 6) setTimeout(() => setStep(2), reduce ? 0 : 250);
            }}
            error={!!errors.code}
            autoFocus={step === 1}
            label="Reset code"
            testID="reset-code"
          />
          <FieldMessage error={errors.code} />
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
        </>,
        <>
          <StepTitle title="New password" />
          <JourneyField
            ref={pwRef}
            icon="lock"
            label="New password"
            placeholder="Create a new password"
            value={password}
            secureTextEntry={!shown}
            onChangeText={(t) => {
              setPassword(t);
              setErrors({});
            }}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="new-password"
            onSubmitEditing={submit}
            error={errors.password}
            testID="reset-password"
            trailing={
              <Pressable onPress={() => setShown((v) => !v)} accessibilityRole="button" accessibilityLabel={shown ? 'Hide password' : 'Show password'} hitSlop={10} style={styles.eye}>
                <Icon name={shown ? 'eyeClose' : 'eye'} size={20} color="textSecondary" />
              </Pressable>
            }
          />
          <PasswordRules password={password} testID="reset-rules" />
        </>,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  resend: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  eye: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
});
