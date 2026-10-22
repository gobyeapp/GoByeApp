import { useState } from 'react';
import { validateEmail, validateName, type DriverPersonalDetails } from '@gobye/core';
import { Button, TextField } from '@gobye/ui';
import { ChoiceRow, StepShell, goNext } from '@/features/onboarding/parts';
import { useDriver } from '@/state/driver';

/** D03 Registration: personal details (the name riders see, contact email, launch city). */
export default function Personal() {
  const { application, updateApplication } = useDriver();
  const p = application.personal;
  const [first, setFirst] = useState(p?.firstName ?? '');
  const [last, setLast] = useState(p?.lastName ?? '');
  const [email, setEmail] = useState(p?.email ?? '');
  const [city, setCity] = useState<DriverPersonalDetails['city']>(p?.city ?? 'Lagos');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const save = () => {
    const f = validateName(first, 'First name');
    const l = validateName(last, 'Last name');
    const e = validateEmail(email);
    setErrors({ first: f.ok ? undefined : f.error, last: l.ok ? undefined : l.error, email: e.ok ? undefined : e.error });
    if (!f.ok || !l.ok || !e.ok) return;
    updateApplication({ personal: { firstName: f.value, lastName: l.value, email: e.value, city } });
    goNext('personal');
  };

  return (
    <StepShell step="personal" title="About you" subtitle="Use the name on your driver’s licence. Riders see your first name only." footer={<Button title="Continue" onPress={save} disabled={!first.trim() || !last.trim()} testID="personal-continue" />}>
      <TextField label="First name" value={first} onChangeText={setFirst} autoComplete="given-name" textContentType="givenName" error={errors.first} testID="first-name" />
      <TextField label="Last name" value={last} onChangeText={setLast} autoComplete="family-name" textContentType="familyName" error={errors.last} testID="last-name" />
      <TextField label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" helper="For trip statements and receipts." error={errors.email} />
      <ChoiceRow label="Where will you drive?" value={city} onChange={setCity} options={[{ id: 'Lagos', label: 'Lagos' }, { id: 'Abuja', label: 'Abuja' }]} />
    </StepShell>
  );
}
