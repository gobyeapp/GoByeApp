import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { formatPhone, parseIdentifier, type SocialProvider } from '@gobye/core';
import { Icon, Text, spacing, useToast } from '@gobye/ui';
import { OrDivider, SocialButtons, TextLink } from '@/features/auth/AuthKit';
import { JourneyField, JourneyFlow, PreviewNote, StepTitle } from '@/features/auth/Journey';
import { useHaptics } from '@/state/haptics';
import { useSession } from '@/state/session';

const STEPS = ['Account', 'Password'];

/**
 * Sign in as a two-step journey, no scrolling: who you are (email or phone, or Apple / Google) →
 * your password (with Forgot password). Then a code to the account's phone. One neutral message for any
 * wrong detail so the form never reveals which accounts exist.
 */
export default function SignIn() {
  const reduce = useReducedMotion();
  const toast = useToast();
  const haptic = useHaptics();
  const { signIn, socialSignIn } = useSession();
  const [step, setStep] = useState(0);
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<{ id?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [social, setSocial] = useState<SocialProvider | null>(null);
  const idRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);

  useEffect(() => {
    // Step 1 doesn't open the keyboard, so Apple and Google stay in view.
    if (step === 0) return;
    const t = setTimeout(() => pwRef.current?.focus(), reduce ? 50 : 520);
    return () => clearTimeout(t);
  }, [step, reduce]);

  const parsed = parseIdentifier(id);
  const who = parsed.ok ? (parsed.value.kind === 'phone' ? formatPhone(parsed.value.value) : parsed.value.value) : '';

  const submit = async () => {
    if (busy) return;
    if (step === 0) {
      if (!parsed.ok) {
        haptic('error');
        return setErrors({ id: parsed.error });
      }
      setErrors({});
      haptic('selection');
      return setStep(1);
    }
    if (!password) {
      haptic('error');
      return setErrors({ password: 'Enter your password.' });
    }
    setBusy(true);
    const r = await signIn(id, password);
    setBusy(false);
    if (!r.ok) {
      haptic('error');
      return setErrors({ form: r.error });
    }
    router.push('/auth/otp');
  };

  const withProvider = async (p: SocialProvider) => {
    setSocial(p);
    const r = await socialSignIn(p);
    setSocial(null);
    if (!r.ok) return toast(r.error, 'error');
    router.push(r.value.next === 'otp' ? '/auth/otp' : '/auth/phone');
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/onboarding'));

  return (
    <JourneyFlow
      eyebrow="WELCOME BACK"
      title="Sign in"
      labels={STEPS}
      step={step}
      onClose={close}
      onBack={() => {
        setErrors({});
        setStep(0);
      }}
      cta={{ title: step === 0 ? 'Continue' : 'Sign in', onPress: submit, loading: busy, loadingLabel: 'Signing in', testID: 'signin-submit' }}
      footnote={<PreviewNote />}
      steps={[
        <>
          <StepTitle title="Good to see you again" hint="Continue with Apple or Google, or use your email or phone." />
          <SocialButtons onPress={withProvider} busy={social} />
          <OrDivider tight />
          <JourneyField
            ref={idRef}
            icon="account"
            label="Email or phone number"
            placeholder="name@example.com or 0803…"
            value={id}
            onChangeText={(t) => {
              setId(t);
              setErrors({});
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="username"
            returnKeyType="next"
            onSubmitEditing={submit}
            error={errors.id}
            testID="signin-id"
          />
          <View style={styles.switch}>
            <Text variant="callout" color="textSecondary">
              New to GoBye?
            </Text>
            <TextLink title="Create account" onPress={() => router.replace('/auth/signup')} testID="to-signup" />
          </View>
        </>,
        <>
          <StepTitle title="Enter your password" hint={who ? `Signing in as ${who}` : undefined} />
          <JourneyField
            ref={pwRef}
            icon="lock"
            label="Password"
            placeholder="Your password"
            value={password}
            secureTextEntry={!shown}
            onChangeText={(t) => {
              setPassword(t);
              setErrors({});
            }}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            autoComplete="current-password"
            onSubmitEditing={submit}
            error={errors.password}
            testID="signin-password"
            trailing={
              <Pressable onPress={() => setShown((v) => !v)} accessibilityRole="button" accessibilityLabel={shown ? 'Hide password' : 'Show password'} hitSlop={10} style={styles.eye}>
                <Icon name={shown ? 'eyeClose' : 'eye'} size={20} color="textSecondary" />
              </Pressable>
            }
          />
          {errors.form ? (
            <View style={styles.err} accessibilityLiveRegion="polite" testID="signin-error">
              <Icon name="warning" size={14} color="danger" />
              <Text variant="footnote" color="danger" style={styles.flex}>
                {errors.form}
              </Text>
            </View>
          ) : null}
          <View style={styles.forgot}>
            <TextLink title="Forgot password?" accent onPress={() => router.push({ pathname: '/auth/reset', params: id.includes('@') ? { email: id.trim() } : {} })} testID="to-reset" />
          </View>
        </>,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  switch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  forgot: { alignItems: 'flex-end', marginTop: -spacing.xs },
  err: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eye: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
});
