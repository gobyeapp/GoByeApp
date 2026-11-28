import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Screen, ScreenHeader, Text } from '@gobye/ui';
import { PhotoCapture } from '@/features/onboarding/parts';
import { makeThumb } from '@/features/onboarding/thumb';
import { useDriver } from '@/state/driver';

/** Change the photo riders see (D-107). The same capture, face check and review as registration. */
export default function ChangePhoto() {
  const router = useRouter();
  const d = useDriver();
  const [uri, setUri] = useState(d.application.personal?.photoUri);
  const [saving, setSaving] = useState(false);
  const changed = !!uri && uri !== d.application.personal?.photoUri;

  const save = async () => {
    if (!uri) return;
    setSaving(true);
    d.updatePhoto(uri, await makeThumb(uri));
    setSaving(false);
    router.back();
  };

  return (
    <Screen header={<ScreenHeader title="Your photo" onBack={() => router.back()} />} footer={<Button title="Save photo" onPress={() => void save()} disabled={!changed} loading={saving} loadingLabel="Saving" testID="photo-save" />}>
      <PhotoCapture selfie label="Photo riders see" hint="Face the camera in good light." uri={uri} onChange={setUri} testID="account-photo" />
      <Text variant="footnote" color="textSecondary">
        Use a clear, recent photo of your face. Riders use it to check they’re getting into the right car.
      </Text>
    </Screen>
  );
}
