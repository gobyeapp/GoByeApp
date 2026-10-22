import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { formatPhone, validateEmail, validateName } from '@gobye/core';
import { Button, Screen, Text, TextField, useToast } from '@gobye/ui';
import { PageHeader } from '@/features/account/ui';
import { useSession } from '@/state/session';

/** R20 Personal details. Phone number changes require re-verification (backend; not in this preview). */
export default function Profile() {
  const { user, saveProfile } = useSession();
  const toast = useToast();
  const [first, setFirst] = useState(user?.firstName ?? '');
  const [last, setLast] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [errors, setErrors] = useState<{ first?: string; last?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);
  // Opened before the session finished loading (e.g. app restored on this page): fill once it arrives.
  const filled = useRef(!!user);
  useEffect(() => {
    if (user && !filled.current) {
      filled.current = true;
      setFirst(user.firstName);
      setLast(user.lastName);
      setEmail(user.email ?? '');
    }
  }, [user]);

  const save = async () => {
    const f = validateName(first, 'First name');
    const l = validateName(last, 'Last name');
    const e = validateEmail(email);
    setErrors({ first: f.ok ? undefined : f.error, last: l.ok ? undefined : l.error, email: e.ok ? undefined : e.error });
    if (!f.ok || !l.ok || !e.ok) return;
    setSaving(true);
    const r = await saveProfile({ firstName: f.value, lastName: l.value, email: e.value });
    setSaving(false);
    if (!r.ok) return toast(r.error, 'error');
    toast('Profile updated', 'success');
    router.back();
  };

  return (
    <Screen header={<PageHeader title="Personal details" onBack={() => router.back()} />} footer={<Button title="Save changes" onPress={save} loading={saving} disabled={saving} testID="profile-save" />}>
      <TextField label="First name" value={first} onChangeText={setFirst} error={errors.first} autoComplete="given-name" />
      <TextField label="Last name" value={last} onChangeText={setLast} error={errors.last} autoComplete="family-name" />
      <TextField label="Email (optional)" value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" />
      <TextField label="Mobile number" value={user ? formatPhone(user.phone) : ''} disabled helper="Can’t be changed in this preview." />
      <Text variant="footnote" color="textSecondary">
        Drivers see only your first name.
      </Text>
    </Screen>
  );
}
