import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type TextInput } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OTHER_NIGERIAN_STATES, passwordStrength, validateEmail, validateFullName, validateNigerianPhone, validatePassword, type SocialProvider } from '@gobye/core';
import { Button, Icon, RadioRow, Sheet, SimulatedBadge, Text, spacing, useTheme, useToast } from '@gobye/ui';
import { OrDivider, SocialButtons } from '@/features/auth/AuthKit';
import { ChoiceTile, JourneyField, JourneyHero, RoundBack } from '@/features/auth/Journey';
import { useHaptics } from '@/state/haptics';
import { useSession } from '@/state/session';

const STEPS = ['You', 'City', 'Contact', 'Secure'] as const;
const EASE = Easing.bezier(0.3, 0.8, 0.2, 1);
type Errors = Partial<Record<'name' | 'city' | 'email' | 'phone' | 'password' | 'form', string>>;

const STRENGTH = {
  empty: { bars: 0, label: '' },
  weak: { bars: 1, label: 'Too weak: 8+ characters with a letter and a number' },
  okay: { bars: 2, label: 'Good' },
  strong: { bars: 3, label: 'Strong' },
} as const;

/**
 * Create account as a journey (the website's "Join the waitlist", owner request 2026-10-22):
 * You → City → Contact → Secure, one question per step, the car drives along the route as you go,
 * tiles move on by themselves, and the tangerine CTA sits beside a round back button. Ends with phone
 * verification and the rider pass.
 */
export default function SignUp() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const toast = useToast();
  const haptic = useHaptics();
  const { signUp, socialSignIn, setHomeCity } = useSession();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [city, setCity] = useState<'Lagos' | 'Abuja' | 'Another city' | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [statesOpen, setStatesOpen] = useState(false);
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

  // Horizontal track of steps; the viewport height follows the current step.
  const [w, setW] = useState(0);
  const [heights, setHeights] = useState<number[]>([0, 0, 0, 0]);
  const x = useSharedValue(0);
  const h = useSharedValue(0);
  useEffect(() => {
    if (!w) return;
    x.value = reduce ? -step * w : withTiming(-step * w, { duration: 500, easing: EASE });
    const target = heights[step] || 0;
    if (target) h.value = reduce || !h.value ? target : withTiming(target, { duration: 450, easing: EASE });
  }, [step, w, heights, reduce, x, h]);
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const viewStyle = useAnimatedStyle(() => (h.value ? { height: h.value } : {}));
  const measure = (i: number) => (e: LayoutChangeEvent) => {
    const v = Math.ceil(e.nativeEvent.layout.height);
    setHeights((prev) => (prev[i] === v ? prev : prev.map((p, j) => (j === i ? v : p))));
  };

  // Focus the step's field once it has slid in.
  useEffect(() => {
    const ref = step === 0 ? nameRef : step === 2 ? emailRef : step === 3 ? passRef : null;
    const t = setTimeout(() => ref?.current?.focus(), reduce ? 50 : 520);
    return () => clearTimeout(t);
  }, [step, reduce]);

  const first = validateFullName(name).ok ? name.trim().split(/\s+/)[0] : '';
  const cityLabel = city === 'Another city' ? state ?? 'Another city' : city ?? '';
  const strength = passwordStrength(password);

  const check = (n: number): boolean => {
    const next: Errors = {};
    if (n === 0) {
      const v = validateFullName(name);
      if (!v.ok) next.name = v.error;
    }
    if (n === 1) {
      if (!city) next.city = 'Choose where you’ll ride.';
      else if (city === 'Another city' && !state) next.city = 'Choose your state.';
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
    const r = await signUp({ fullName: name, email, phone, password });
    setBusy(false);
    if (!r.ok) {
      // Send the rider back to the step that needs fixing.
      const toContact = /email|number/i.test(r.error);
      if (toContact) go(2);
      return setErrors({ form: r.error });
    }
    setHomeCity(cityLabel);
    haptic('success');
    router.push({ pathname: '/auth/otp', params: { next: 'pass' } });
  };

  const pickCity = (c: 'Lagos' | 'Abuja' | 'Another city') => {
    setCity(c);
    setErrors({});
    haptic('selection');
    if (c === 'Another city') return setStatesOpen(true);
    setState(null);
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

  const close = () => (router.canGoBack() ? router.back() : router.replace('/onboarding'));
  const back = () => (step === 0 ? close() : go(step - 1));

  const stepView = (i: number, children: ReactNode) => (
    <View key={i} style={{ width: w || undefined }} onLayout={measure(i)} accessibilityElementsHidden={i !== step} importantForAccessibility={i === step ? 'auto' : 'no-hide-descendants'} pointerEvents={i === step ? 'auto' : 'none'}>
      <View style={styles.step}>{children}</View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <JourneyHero eyebrow="JOIN GOBYE" title="Create your account" step={step} labels={[...STEPS]} onClose={close} topInset={insets.top} />

      <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          <Animated.View style={[styles.viewport, viewStyle]}>
            <Animated.View style={[styles.track, trackStyle]}>
              {stepView(
                0,
                <>
                  <Text style={[styles.q, { color: colors.text }]} accessibilityRole="header">
                    First, what should we call you?
                  </Text>
                  <Text variant="callout" color="textSecondary" style={styles.hint}>
                    Your rider pass will carry your name. Drivers see your first name only.
                  </Text>
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
                  <OrDivider />
                  <SocialButtons layout="row" onPress={withProvider} busy={social} />
                </>,
              )}
              {stepView(
                1,
                <>
                  <Text style={[styles.q, { color: colors.text }]} accessibilityRole="header">
                    Where will you ride{first ? `, ${first}` : ''}?
                  </Text>
                  <Text variant="callout" color="textSecondary" style={styles.hint}>
                    GoBye launches in Lagos and Abuja first.
                  </Text>
                  <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel="City">
                    <ChoiceTile icon="destination" title="Lagos" subtitle="Launching first" selected={city === 'Lagos'} onPress={() => pickCity('Lagos')} testID="city-lagos" />
                    <ChoiceTile icon="destination" title="Abuja" subtitle="Launching first" selected={city === 'Abuja'} onPress={() => pickCity('Abuja')} testID="city-abuja" />
                    <ChoiceTile
                      wide
                      icon="map"
                      title={city === 'Another city' && state ? state : 'Another city'}
                      subtitle={city === 'Another city' && state ? 'We’ll tell you when GoBye arrives' : 'Choose your state'}
                      selected={city === 'Another city'}
                      onPress={() => pickCity('Another city')}
                      testID="city-other"
                    />
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
              )}
              {stepView(
                2,
                <>
                  <Text style={[styles.q, { color: colors.text }]} accessibilityRole="header">
                    How do we reach you?
                  </Text>
                  <Text variant="callout" color="textSecondary" style={styles.hint}>
                    Receipts go to your email. Your driver calls this number at pickup.
                  </Text>
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
                </>,
              )}
              {stepView(
                3,
                <>
                  <Text style={[styles.q, { color: colors.text }]} accessibilityRole="header">
                    Last, secure your account
                  </Text>
                  <Text variant="callout" color="textSecondary" style={styles.hint}>
                    You’ll sign in with your email or phone and this password.
                  </Text>
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
                  <View style={styles.meter} accessible accessibilityLabel={strength === 'empty' ? 'Password strength' : `Password strength: ${STRENGTH[strength].label}`}>
                    <View style={styles.bars}>
                      {[1, 2, 3].map((b) => (
                        <View
                          key={b}
                          style={[
                            styles.bar,
                            { backgroundColor: b <= STRENGTH[strength].bars ? (strength === 'weak' ? colors.danger : strength === 'okay' ? colors.warning : colors.success) : colors.border },
                          ]}
                        />
                      ))}
                    </View>
                    <Text variant="caption" color="textSecondary">
                      {STRENGTH[strength].label || 'At least 8 characters, with a number.'}
                    </Text>
                  </View>
                  <Text variant="footnote" color="textSecondary">
                    By creating an account you agree to the Terms and Privacy notice.
                  </Text>
                </>,
              )}
            </Animated.View>
          </Animated.View>
        </View>

        {errors.form ? (
          <View style={styles.inlineErr} accessibilityLiveRegion="polite" testID="signup-error">
            <Icon name="warning" size={14} color="danger" />
            <Text variant="footnote" color="danger" style={styles.flex}>
              {errors.form}
            </Text>
          </View>
        ) : null}
        <View style={styles.note}>
          <SimulatedBadge />
          <Text variant="footnote" color="textSecondary" style={styles.flex}>
            Accounts, SMS, Apple and Google are simulated in this preview.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, spacing.lg), borderTopColor: colors.border }]}>
        {step > 0 ? <RoundBack onPress={back} disabled={busy} /> : null}
        <Button
          variant="brand"
          title={step === STEPS.length - 1 ? 'Create account' : 'Continue'}
          trailingIcon="arrowRight"
          loading={busy}
          loadingLabel="Creating account"
          onPress={submit}
          style={styles.flex}
          testID="signup-submit"
        />
      </View>

      <Sheet visible={statesOpen} onClose={() => setStatesOpen(false)} title="Which state?" subtitle="We’ll let you know when GoBye arrives." testID="state-sheet">
        {OTHER_NIGERIAN_STATES.map((s) => (
          <RadioRow
            key={s}
            title={s}
            selected={state === s}
            onSelect={() => {
              setState(s);
              setStatesOpen(false);
              setErrors({});
              setTimeout(() => go(2), reduce ? 0 : 300);
            }}
            testID={`state-${s}`}
          />
        ))}
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: spacing.xl, gap: spacing.lg },
  viewport: { overflow: 'hidden' },
  track: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { gap: 14, paddingBottom: 8 },
  q: { fontFamily: 'Inter_700Bold', fontSize: 23, lineHeight: 27, letterSpacing: -0.8 },
  hint: { marginTop: -6, marginBottom: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  inlineErr: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meter: { gap: 6 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  eye: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
