import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { Avatar, Button, Icon, ListGroup, ListItem, Sheet, Text, spacing, useTheme, useToast } from '@gobye/ui';
import { useSession } from '@/state/session';

type Step = 'choose' | 'preview' | 'denied' | 'error' | 'confirmRemove';

/**
 * Add / replace / remove the profile photo (brief §14). Permission is asked only when the passenger
 * picks a source. A picked photo is previewed before it is used; saving, permission-denied, load-error
 * and remove-confirmation states all stay inside the sheet. The saved photo shows on Home and Account.
 */
export function ProfilePhotoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { user, setPhoto } = useSession();
  const toast = useToast();
  const [step, setStep] = useState<Step>('choose');
  const [candidate, setCandidate] = useState<string | null>(null);
  const [source, setSource] = useState<'library' | 'camera'>('library');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const name = user ? `${user.firstName} ${user.lastName}`.trim() : '';

  useEffect(() => {
    if (!visible) {
      setStep('choose');
      setCandidate(null);
      setBusy(false);
      setSaving(false);
    }
  }, [visible]);

  const pick = async (from: 'library' | 'camera') => {
    if (busy) return;
    setSource(from);
    setBusy(true);
    try {
      const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setStep('denied');
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 };
      const res = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (!res.canceled && res.assets[0]) {
        setCandidate(res.assets[0].uri);
        setStep('preview');
      }
    } catch {
      setStep('error');
    } finally {
      setBusy(false);
    }
  };

  const use = async () => {
    if (!candidate || saving) return;
    setSaving(true);
    try {
      await Promise.resolve(setPhoto(candidate));
      toast('Profile photo updated', 'success');
      onClose();
    } catch {
      setStep('error');
    } finally {
      setSaving(false);
    }
  };

  const title =
    step === 'preview' ? 'Use this photo?' : step === 'denied' ? `Allow ${source === 'camera' ? 'camera' : 'photo'} access` : step === 'error' ? 'Couldn’t use that photo' : step === 'confirmRemove' ? 'Remove your photo?' : user?.photoUri ? 'Change profile photo' : 'Add profile photo';

  const footer =
    step === 'preview' ? (
      <>
        <Button title="Use photo" onPress={use} loading={saving} disabled={saving} testID="photo-use" />
        <Button title="Choose another" variant="tertiary" onPress={() => setStep('choose')} disabled={saving} />
      </>
    ) : step === 'denied' ? (
      <>
        <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
        <Button title="Not now" variant="tertiary" onPress={() => setStep('choose')} />
      </>
    ) : step === 'error' ? (
      <Button title="Try again" variant="secondary" onPress={() => setStep('choose')} />
    ) : step === 'confirmRemove' ? (
      <>
        <Button
          title="Remove photo"
          variant="destructive"
          onPress={() => {
            setPhoto(null);
            toast('Profile photo removed');
            onClose();
          }}
          testID="photo-remove-confirm"
        />
        <Button title="Keep photo" variant="tertiary" onPress={() => setStep('choose')} />
      </>
    ) : undefined;

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={step === 'choose' ? 'Helps your driver find you.' : undefined} footer={footer} testID="photo-sheet">
      {step === 'choose' ? (
        <>
          <View style={styles.centre}>
            <Avatar uri={user?.photoUri} name={name} size={88} />
          </View>
          <ListGroup>
            <ListItem title="Choose from library" leadingIcon="upload" leadingBadge onPress={() => void pick('library')} testID="photo-library" />
            <ListItem title="Take a photo" leadingIcon="camera" leadingBadge onPress={() => void pick('camera')} testID="photo-camera" />
            {user?.photoUri ? <ListItem title="Remove photo" leadingIcon="delete" destructive onPress={() => setStep('confirmRemove')} testID="photo-remove" /> : null}
          </ListGroup>
        </>
      ) : step === 'preview' && candidate ? (
        <View style={styles.centre}>
          <Image
            source={{ uri: candidate }}
            style={[styles.preview, { borderColor: colors.border }]}
            accessibilityLabel="Preview of your new profile photo"
            accessibilityIgnoresInvertColors
            onError={() => setStep('error')}
          />
          <Text variant="footnote" color="textSecondary" align="center">
            This is how drivers will see you at pickup.
          </Text>
        </View>
      ) : step === 'denied' ? (
        <Text variant="callout">
          Allow {source === 'camera' ? 'camera' : 'photo'} access in Settings, or continue without a photo.
        </Text>
      ) : step === 'error' ? (
        <View style={styles.row}>
          <Icon name="warning" color="danger" />
          <Text variant="callout" style={styles.flex}>
            That photo couldn’t be opened or saved. Try another photo.
          </Text>
        </View>
      ) : step === 'confirmRemove' ? (
        <Text variant="callout">Your driver won’t see a photo at pickup.</Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centre: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  preview: { width: 168, height: 168, borderRadius: 84, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
