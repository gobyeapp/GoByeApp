import { useState } from 'react';
import { validateExpiry, validateLicenceNumber } from '@gobye/core';
import { Button, TextField } from '@gobye/ui';
import { PhotoCapture, StepShell, goNext } from '@/features/onboarding/parts';
import { useDriver } from '@/state/driver';

/** D04 Driver's licence: number, expiry (must be in the future) and a photo of the front. */
export default function Licence() {
  const { application, updateApplication } = useDriver();
  const l = application.licence;
  const [number, setNumber] = useState(l?.number ?? '');
  const [expiry, setExpiry] = useState(l?.expiry ?? '');
  const [photo, setPhoto] = useState(l?.photoUri);
  const [errors, setErrors] = useState<{ number?: string; expiry?: string }>({});

  // Type digits only; dashes are added as YYYY-MM-DD.
  const onExpiry = (t: string) => {
    const d = t.replace(/\D/g, '').slice(0, 8);
    setExpiry([d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join('-'));
  };

  const save = () => {
    const n = validateLicenceNumber(number);
    const e = validateExpiry(expiry, Date.now());
    setErrors({ number: n.ok ? undefined : n.error, expiry: e.ok ? undefined : e.error });
    if (!n.ok || !e.ok || !photo) return;
    goNext('licence', updateApplication({ licence: { number: n.value, expiry: e.value, photoUri: photo } }, 'licence'));
  };

  return (
    <StepShell
      step="licence"
      title="Driver’s licence"
      subtitle="We check it with the issuing authority before you can go online."
      footer={<Button title="Continue" onPress={save} disabled={!number || expiry.length < 10 || !photo} testID="licence-continue" />}
    >
      <TextField label="Licence number" value={number} onChangeText={setNumber} autoCapitalize="characters" autoCorrect={false} placeholder="ABC12345AA12" error={errors.number} testID="licence-number" />
      <TextField label="Expiry date" value={expiry} onChangeText={onExpiry} keyboardType="number-pad" placeholder="YYYY-MM-DD" maxLength={10} error={errors.expiry} testID="licence-expiry" />
      <PhotoCapture label="Front of your licence" hint="Lay it flat in good light. All four corners in the frame." uri={photo} onChange={setPhoto} testID="licence-photo" />
    </StepShell>
  );
}
