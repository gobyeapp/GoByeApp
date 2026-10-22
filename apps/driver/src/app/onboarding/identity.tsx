import { useState } from 'react';
import { validateIdentityNumber, type IdentityDocumentType } from '@gobye/core';
import { Button, TextField } from '@gobye/ui';
import { ChoiceRow, PhotoCapture, StepShell, goNext } from '@/features/onboarding/parts';
import { useDriver } from '@/state/driver';

const TYPES: { id: IdentityDocumentType; label: string; field: string; placeholder: string }[] = [
  { id: 'nin', label: 'NIN', field: 'National Identification Number', placeholder: '11 digits' },
  { id: 'voters_card', label: 'Voter’s card', field: 'Voter identification number (VIN)', placeholder: '19 characters' },
  { id: 'passport', label: 'Passport', field: 'Passport number', placeholder: 'A12345678' },
];

/** D05 Identity: an ID number plus a selfie, matched against the ID by the verification partner (simulated). */
export default function Identity() {
  const { application, updateApplication } = useDriver();
  const i = application.identity;
  const [type, setType] = useState<IdentityDocumentType>(i?.type ?? 'nin');
  const [number, setNumber] = useState(i?.number ?? '');
  const [selfie, setSelfie] = useState(i?.selfieUri);
  const [error, setError] = useState<string>();
  const meta = TYPES.find((t) => t.id === type)!;

  const save = () => {
    const v = validateIdentityNumber(type, number);
    setError(v.ok ? undefined : v.error);
    if (!v.ok || !selfie) return;
    goNext('identity', updateApplication({ identity: { type, number: v.value, selfieUri: selfie } }, 'identity'));
  };

  return (
    <StepShell
      step="identity"
      title="Identity check"
      subtitle="Riders trust GoBye because every driver is who they say they are."
      footer={<Button title="Continue" onPress={save} disabled={!number || !selfie} testID="identity-continue" />}
    >
      <ChoiceRow label="Document" value={type} onChange={(t) => { setType(t); setError(undefined); }} options={TYPES} />
      <TextField label={meta.field} value={number} onChangeText={setNumber} placeholder={meta.placeholder} keyboardType={type === 'nin' ? 'number-pad' : 'default'} autoCapitalize="characters" error={error} testID="identity-number" />
      <PhotoCapture selfie label="A selfie" hint="Face the camera, no hat or sunglasses, in good light." uri={selfie} onChange={setSelfie} testID="identity-selfie" />
    </StepShell>
  );
}
