import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateEmail, validateFullName, validateNigerianPhone, validatePassword, type SocialProvider } from '@gobye/core';
import { Button, Screen, SimulatedBadge, Text, TextField, spacing, useToast } from '@gobye/ui';
import { AuthHeading, AuthTopBar, OrDivider, PasswordField, SocialButtons } from '@/features/auth/AuthKit';
import { useSession } from '@/state/session';

type Errors = Partial<Record<'name' | 'email' | 'phone' | 'password' | 'form', string>>;

/**
 * Create account (owner design): full name, email, phone and password, then the phone is verified with
 * a code. Apple / Google as the alternative. Each field keeps its value after an error; errors sit under
 * the field that needs fixing.
 */
export default function SignUp() {
  const { signUp, socialSignIn } = useSession();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [social, setSocial] = useState<SocialProvider | null>(null);

  const clear = (k: keyof Errors) => errors[k] && setErrors((e) => ({ ...e, [k]: undefined, form: undefined }));

  const submit = async () => {
    if (busy) return;
    const n = validateFullName(name);
    const e = validateEmail(email);
    const p = validateNigerianPhone(phone);
    const pw = validatePassword(password);
    const next: Errors = {
      name: n.ok ? undefined : n.error,
      email: e.ok && e.value ? undefined : 'Enter a valid email address.',
      phone: p.ok ? undefined : p.error,
      password: pw.ok ? undefined : pw.error,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    const r = await signUp({ fullName: name, email, phone, password });
    setBusy(false);
    if (!r.ok) return setErrors({ form: r.error });
    router.push('/auth/otp');
  };

  const withProvider = async (p: SocialProvider) => {
    setSocial(p);
    const r = await socialSignIn(p);
    setSocial(null);
    if (!r.ok) return toast(r.error, 'error');
    router.push(r.value.next === 'otp' ? '/auth/otp' : '/auth/phone');
  };

  return (
    <Screen
      header={<View style={styles.pad}><AuthTopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding'))} /></View>}
      footer={
        <>
          <Button title="Create account" onPress={submit} loading={busy} loadingLabel="Creating account" testID="signup-submit" />
          <Text variant="caption" weight="regular" color="textSecondary" align="center">
            By creating an account you agree to the Terms and Privacy notice.
          </Text>
        </>
      }
    >
      <AuthHeading title="Create account" subtitle="One account for every ride. It takes less than a minute." />
      <View style={styles.fields}>
        <TextField label="Full name" leadingIcon="account" placeholder="Ada Okafor" value={name} onChangeText={(t) => { setName(t); clear('name'); }} autoCapitalize="words" textContentType="name" autoComplete="name" error={errors.name} testID="signup-name" />
        <TextField label="Email address" leadingIcon="mail" placeholder="name@example.com" value={email} onChangeText={(t) => { setEmail(t); clear('email'); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" autoComplete="email" error={errors.email} testID="signup-email" />
        <TextField label="Phone number" prefix="+234" placeholder="803 123 4567" value={phone} onChangeText={(t) => { setPhone(t); clear('phone'); }} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" helper="Your driver uses it to reach you at pickup." error={errors.phone} testID="signup-phone" />
        <PasswordField label="Password" placeholder="Create a password" value={password} onChangeText={(t) => { setPassword(t); clear('password'); }} textContentType="newPassword" autoComplete="new-password" helper="At least 8 characters, with a number." error={errors.password} testID="signup-password" />
        {errors.form ? (
          <Text variant="footnote" color="danger" accessibilityLiveRegion="polite" testID="signup-error">
            {errors.form}
          </Text>
        ) : null}
        <View>
          <OrDivider />
          <SocialButtons layout="row" onPress={withProvider} busy={social} />
        </View>
        <View style={styles.note}>
          <SimulatedBadge />
          <Text variant="footnote" color="textSecondary" style={styles.flex}>
            Accounts, SMS, Apple and Google are simulated in this preview.
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 20 },
  flex: { flex: 1 },
  fields: { gap: spacing.lg },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
