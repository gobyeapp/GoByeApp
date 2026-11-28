import { useState } from 'react';
import { makeThumb } from '@/features/onboarding/thumb';
import { StyleSheet, View } from 'react-native';
import { validateEmail, validateName, type DriverPersonalDetails } from '@gobye/core';
import { Button, TextField, spacing } from '@gobye/ui';
import { ChoiceRow, PhotoCapture, StepShell, goNext } from '@/features/onboarding/parts';
import { useDriver } from '@/state/driver';
import { useSession } from '@/state/session';

/** D03 Registration: personal details (the name and photo riders see, contact email, launch city). */
export default function Personal() {
  const { application, updateApplication } = useDriver();
  // Prefilled from the account (sign up, or Apple / Google) when registration hasn't saved it yet.
  const { profile } = useSession();
  const p = application.personal;
  const [first, setFirst] = useState(p?.firstName ?? profile?.firstName ?? '');
  const [last, setLast] = useState(p?.lastName ?? profile?.lastName ?? '');
  const [email, setEmail] = useState(p?.email ?? profile?.email ?? '');
  const [city, setCity] = useState<DriverPersonalDetails['city']>(p?.city ?? profile?.city ?? 'Lagos');
  const [photo, setPhoto] = useState(p?.photoUri);
  const [thumb, setThumb] = useState(p?.photoThumb);
  const choosePhoto = (uri: string) => {
    setPhoto(uri);
    setThumb(undefined);
    void makeThumb(uri).then(setThumb);
  };
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const save = () => {
    const f = validateName(first, 'First name');
    const l = validateName(last, 'Last name');
    const e = validateEmail(email);
    setErrors({ first: f.ok ? undefined : f.error, last: l.ok ? undefined : l.error, email: e.ok ? undefined : e.error });
    if (!f.ok || !l.ok || !e.ok || !photo) return;
    goNext('personal', updateApplication({ personal: { firstName: f.value, lastName: l.value, email: e.value, city, photoUri: photo, photoThumb: thumb } }, 'personal'));
  };

  return (
    <StepShell step="personal" title="About you" subtitle="Use the name on your driver’s licence. Riders only see your first name." footer={<Button title="Continue" onPress={save} disabled={!first.trim() || !last.trim() || !photo} testID="personal-continue" />}>
      {/* The photo riders see when this driver is matched (D-097). */}
      <PhotoCapture selfie label="Your photo" hint="Riders see this when you’re matched." uri={photo} onChange={choosePhoto} testID="personal-photo" />
      {/* Side by side, so the whole step fits on one screen. */}
      <View style={styles.names}>
        <View style={styles.flex}>
          <TextField label="First name" value={first} onChangeText={setFirst} autoComplete="given-name" textContentType="givenName" error={errors.first} testID="first-name" />
        </View>
        <View style={styles.flex}>
          <TextField label="Last name" value={last} onChangeText={setLast} autoComplete="family-name" textContentType="familyName" error={errors.last} testID="last-name" />
        </View>
      </View>
      <TextField label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" helper="For trip statements and receipts." error={errors.email} />
      <ChoiceRow label="Where will you drive?" value={city} onChange={setCity} options={[{ id: 'Lagos', label: 'Lagos' }, { id: 'Abuja', label: 'Abuja' }]} />
    </StepShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  names: { flexDirection: 'row', gap: spacing.md },
});
