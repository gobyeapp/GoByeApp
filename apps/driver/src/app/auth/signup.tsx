import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { validateEmail, validateFullName, validateNigerianPhone, validatePassword, type SocialProvider } from '@gobye/core';
import { ChoiceTile, Icon, JourneyField, JourneyFlow, PasswordRules, PreviewNote, SocialFirst, StepTitle, Text, useToast } from '@gobye/ui';
import { useHaptics } from '@/state/settings';
import { useSession } from '@/state/session';

const STEPS = ['You', 'City', 'Contact', 'Secure'] as const;
type Errors = Partial<Record<'name' | 'city' | 'email' | 'phone' | 'password' | 'form', string>>;


/**
 * D02 Create a driver account, the same journey as the rider app: You → City → Contact → Secure, one
 * question per step. Drivers are onboarded in the launch cities only, so City is Lagos or Abuja. Ends
 * with phone verification and the driver pass, then registration (licence, ID, vehicle).
 */
export default function SignUp() {
  const reduce = useReducedMotion();
  const toast = useToast();
  const haptic = useHaptics();
  const { signUp, socialSignIn } = useSession();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [city, setCity] = useState<'Lagos' | 'Abuja' | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [social, setSocial] = useState<SocialProvider | null>(null);

  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passRef = useRef<TextInput>(null);

  // Focus the step's field once it has slid in.
  useEffect(() => {
    // Step 1 doesn't open the keyboard, so Apple and Google stay in view.
    const ref = step === 2 ? emailRef : step === 3 ? passRef : null;
    const t = setTimeout(() => ref?.current?.focus(), reduce ? 50 : 520);
    return () => clearTimeout(t);
  }, [step, reduce]);

  const first = validateFullName(name).ok ? name.trim().split(/\s+/)[0] : '';

  const check = (n: number): boolean => {
    const next: Errors = {};
    if (n === 0) {
      const v = validateFullName(name);
      if (!v.ok) next.name = v.error;
    }
    if (n === 1) {
      if (!city) next.city = 'Choose where you’ll drive.';
    }
    if (n === 2) {
      const e = validateEmail(email);
      if (!e.ok || !e.value) next.email = 'Enter a valid email address.';
      const p = validateNigerianPhone(phone);
      if (!p.ok) next.phone = p.error;
    }
    if (n === 3) {
      const p = validatePassword(password);
      if (!p.ok) next.password = p.error;
    }
    setErrors(next);
    if (Object.keys(next).length) haptic('error');
    return Object.keys(next).length === 0;
  };

  const go = (n: number) => {
    setErrors({});
    setStep(n);
  };

  const submit = async () => {
    if (busy) return;
    if (!check(step)) return;
    if (step < STEPS.length - 1) {
      haptic('selection');
      return go(step + 1);
    }
    setBusy(true);
    const r = await signUp({ fullName: name, email, phone, password, city: city ?? 'Lagos' });
    setBusy(false);
    if (!r.ok) {
      // Send the rider back to the step that needs fixing.
      const toContact = /email|number/i.test(r.error);
      if (toContact) go(2);
      return setErrors({ form: r.error });
    }
    haptic('success');
    router.push({ pathname: '/auth/otp', params: { next: 'pass' } });
  };

  const pickCity = (c: 'Lagos' | 'Abuja') => {
    setCity(c);
    setErrors({});
    haptic('selection');
    // Tiles move on by themselves (website journey).
    setTimeout(() => go(2), reduce ? 0 : 260);
  };

  const withProvider = async (p: SocialProvider) => {
    setSocial(p);
    const r = await socialSignIn(p);
    setSocial(null);
    if (!r.ok) return toast(r.error, 'error');
    router.push(r.value.next === 'otp' ? '/auth/otp' : '/auth/phone');
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/welcome'));
  const back = () => (step === 0 ? close() : go(step - 1));

  return (
    <>
      <JourneyFlow
        title="Become a driver"
        labels={[...STEPS]}
        step={step}
        onClose={close}
        onBack={back}
        cta={{ title: step === STEPS.length - 1 ? 'Create account' : 'Continue', onPress: submit, loading: busy, loadingLabel: 'Creating account', testID: 'signup-submit' }}
        footnote={<PreviewNote />}
        steps={[
                <>
                  <StepTitle title="What’s your name?" />
                  <SocialFirst onPress={withProvider} busy={social} />
                  <JourneyField
                    ref={nameRef}
                    icon="account"
                    label="Full name"
                    placeholder="Your full name"
                    value={name}
                    onChangeText={(t) => {
                      setName(t);
                      if (errors.name) setErrors({});
                    }}
                    autoCapitalize="words"
                    textContentType="name"
                    autoComplete="name"
                    returnKeyType="next"
                    onSubmitEditing={submit}
                    error={errors.name}
                    testID="signup-name"
                  />
                </>,
                <>
                  <StepTitle title={`Where will you drive${first ? `, ${first}` : ''}?`} />
                  <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel="City">
                    <ChoiceTile icon="destination" title="Lagos" selected={city === 'Lagos'} onPress={() => pickCity('Lagos')} testID="city-lagos" />
                    <ChoiceTile icon="destination" title="Abuja" selected={city === 'Abuja'} onPress={() => pickCity('Abuja')} testID="city-abuja" />
                  </View>
                  {errors.city ? (
                    <View style={styles.inlineErr} accessibilityLiveRegion="polite">
                      <Icon name="warning" size={14} color="danger" />
                      <Text variant="footnote" color="danger">
                        {errors.city}
                      </Text>
                    </View>
                  ) : null}
                </>,
                <>
                  <StepTitle title="How do we reach you?" />
                  <JourneyField
                    ref={emailRef}
                    icon="mail"
                    label="Email address"
                    placeholder="name@example.com"
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      setErrors((e) => ({ ...e, email: undefined, form: undefined }));
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="emailAddress"
                    autoComplete="email"
                    returnKeyType="next"
                    onSubmitEditing={() => phoneRef.current?.focus()}
                    error={errors.email}
                    testID="signup-email"
                  />
                  <JourneyField
                    ref={phoneRef}
                    icon="phone"
                    label="Phone number"
                    prefix="+234"
                    placeholder="803 123 4567"
                    value={phone}
                    onChangeText={(t) => {
                      setPhone(t);
                      setErrors((e) => ({ ...e, phone: undefined, form: undefined }));
                    }}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    onSubmitEditing={submit}
                    error={errors.phone}
                    testID="signup-phone"
                  />

                  {errors.form ? (
                    <View style={styles.inlineErr} accessibilityLiveRegion="polite" testID="signup-error">
                      <Icon name="warning" size={14} color="danger" />
                      <Text variant="footnote" color="danger" style={styles.flex}>
                        {errors.form}
                      </Text>
                    </View>
                  ) : null}
                </>,
                <>
                  <StepTitle title="Set a password" />
                  <JourneyField
                    ref={passRef}
                    icon="lock"
                    label="Password"
                    placeholder="Create a password"
                    value={password}
                    secureTextEntry={!shown}
                    onChangeText={(t) => {
                      setPassword(t);
                      setErrors((e) => ({ ...e, password: undefined, form: undefined }));
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    autoComplete="new-password"
                    onSubmitEditing={submit}
                    error={errors.password}
                    testID="signup-password"
                    trailing={
                      <Pressable onPress={() => setShown((v) => !v)} accessibilityRole="button" accessibilityLabel={shown ? 'Hide password' : 'Show password'} hitSlop={10} style={styles.eye}>
                        <Icon name={shown ? 'eyeClose' : 'eye'} size={20} color="textSecondary" />
                      </Pressable>
                    }
                  />
                  <PasswordRules password={password} testID="signup-rules" />
                  <Text variant="footnote" color="textSecondary">
                    By creating an account you agree to the Terms and Privacy notice.
                  </Text>

                  {errors.form ? (
                    <View style={styles.inlineErr} accessibilityLiveRegion="polite" testID="signup-error">
                      <Icon name="warning" size={14} color="danger" />
                      <Text variant="footnote" color="danger" style={styles.flex}>
                        {errors.form}
                      </Text>
                    </View>
                  ) : null}
                </>,
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  inlineErr: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eye: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
});
