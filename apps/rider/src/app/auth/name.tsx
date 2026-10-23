import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateEmail, validateName } from '@gobye/core';
import { Button, Checkbox, Screen, TextField, layout, spacing, useTheme } from '@gobye/ui';
import { AuthStepHeader, FieldMessage } from '@/features/auth/AuthStep';
import { resetTo } from '@/features/navigation/reset';
import { useSession } from '@/state/session';

/**
 * R05 Profile setup, step 3 of 3. Collects only what's needed (Guideline 5.1.1(v)); email optional.
 * Values stay in place after a failed save; errors sit under each field.
 */
export default function NameScreen() {
  const { colors } = useTheme();
  const { saveProfile } = useSession();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<{ first?: string; last?: string; email?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    const f = validateName(first, 'First name');
    const l = validateName(last, 'Last name');
    const e = validateEmail(email);
    const next = { first: f.ok ? undefined : f.error, last: l.ok ? undefined : l.error, email: e.ok ? undefined : e.error };
    setErrors(next);
    if (!f.ok || !l.ok || !e.ok) return;
    setSaving(true);
    const r = await saveProfile({ firstName: f.value, lastName: l.value, email: e.value });
    setSaving(false);
    if (!r.ok) return setErrors({ form: r.error });
    resetTo('/(tabs)');
  };

  return (
    <Screen footer={<Button title="Finish" onPress={submit} loading={saving} disabled={!agreed} testID="profile-continue" />}>
      <AuthStepHeader step={3} title="What should drivers call you?" subtitle="Drivers see your first name." />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="First name" value={first} onChangeText={setFirst} autoComplete="given-name" textContentType="givenName" error={errors.first} editable={!saving} testID="first-name" />
        </View>
        <View style={styles.flex}>
          <TextField label="Last name" value={last} onChangeText={setLast} autoComplete="family-name" textContentType="familyName" error={errors.last} editable={!saving} testID="last-name" />
        </View>
      </View>
      <TextField
        label="Email (optional)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        helper="For receipts."
        error={errors.email}
        editable={!saving}
      />
      <View style={[styles.terms, { backgroundColor: colors.surfaceMuted }]}>
        <Checkbox checked={agreed} onChange={setAgreed} label="I agree to the GoBye Terms of Service and Privacy Policy." testID="agree-terms" />
      </View>
      <FieldMessage error={errors.form} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  terms: { borderRadius: layout.controlRadius, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
