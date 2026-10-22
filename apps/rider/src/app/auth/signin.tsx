import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { parseIdentifier, type SocialProvider } from '@gobye/core';
import { Button, Screen, SimulatedBadge, Text, TextField, spacing, useToast } from '@gobye/ui';
import { AuthHeading, AuthTopBar, OrDivider, PasswordField, SocialButtons, TextLink } from '@/features/auth/AuthKit';
import { useSession } from '@/state/session';

/**
 * Sign in (owner design): Apple / Google first, then email or phone + password, then a code to the
 * account's phone. One error message for any wrong detail so the form never reveals which accounts exist.
 */
export default function SignIn() {
  const { signIn, socialSignIn } = useSession();
  const toast = useToast();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ id?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [social, setSocial] = useState<SocialProvider | null>(null);

  const submit = async () => {
    if (busy) return;
    const p = parseIdentifier(id);
    const next = { id: p.ok ? undefined : p.error, password: password ? undefined : 'Enter your password.' };
    setErrors(next);
    if (next.id || next.password) return;
    setBusy(true);
    const r = await signIn(id, password);
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
          <Button title="Sign in" onPress={submit} loading={busy} loadingLabel="Signing in" testID="signin-submit" />
          <View style={styles.switch}>
            <Text variant="callout" color="textSecondary">
              New to GoBye?
            </Text>
            <TextLink title="Create account" onPress={() => router.replace('/auth/signup')} testID="to-signup" />
          </View>
        </>
      }
    >
      <AuthHeading title="Sign in" subtitle="Welcome back. Pick up where your last trip ended." />
      <SocialButtons onPress={withProvider} busy={social} />
      <OrDivider />
      <View style={styles.fields}>
        <TextField
          label="Email or phone number"
          leadingIcon="account"
          placeholder="name@example.com or 0803…"
          value={id}
          onChangeText={(t) => { setId(t); setErrors({}); }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="username"
          error={errors.id}
          testID="signin-id"
        />
        <PasswordField label="Password" placeholder="Your password" value={password} onChangeText={(t) => { setPassword(t); setErrors({}); }} textContentType="password" autoComplete="current-password" error={errors.password} onSubmitEditing={submit} testID="signin-password" />
        {errors.form ? (
          <Text variant="footnote" color="danger" accessibilityLiveRegion="polite" testID="signin-error">
            {errors.form}
          </Text>
        ) : null}
        <View style={styles.forgot}>
          <TextLink title="Forgot password?" accent onPress={() => router.push({ pathname: '/auth/reset', params: id.includes('@') ? { email: id.trim() } : {} })} testID="to-reset" />
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
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fields: { gap: spacing.lg },
  forgot: { alignItems: 'flex-end', marginTop: -spacing.sm },
  switch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
});
