import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { checkFacePhoto } from './faceCheck';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { ONBOARDING_STEPS, isStepComplete, nextOnboardingStep, type DriverApplication, type OnboardingStepId } from '@gobye/core';
import { AuthStepHeader, Button, Icon, ListGroup, ListItem, Screen, ScreenHeader, Sheet, Text, layout, spacing, useTheme, type IconName } from '@gobye/ui';

export const STEP_ROUTES: Record<OnboardingStepId, `/onboarding/${OnboardingStepId}`> = {
  personal: '/onboarding/personal',
  licence: '/onboarding/licence',
  identity: '/onboarding/identity',
  vehicle: '/onboarding/vehicle',
  documents: '/onboarding/documents',
};

export const STEP_META: Record<OnboardingStepId, { title: string; icon: IconName; summary: string }> = {
  personal: { title: 'About you', icon: 'account', summary: 'Name, photo and city' },
  licence: { title: 'Driver’s licence', icon: 'idcard', summary: 'Number, expiry and a photo' },
  identity: { title: 'Identity check', icon: 'userSecurity', summary: 'NIN or ID and a selfie' },
  vehicle: { title: 'Your vehicle', icon: 'car', summary: 'Make, model, year and plate' },
  documents: { title: 'Vehicle papers', icon: 'certificate', summary: 'Licence, insurance, roadworthiness' },
};

/**
 * After saving a step: go to the next step still to do, or back to the checklist when everything is in
 * (also after fixing an item staff flagged, so the driver can send it back for review).
 */
export function goNext(step: OnboardingStepId, app?: DriverApplication) {
  if (app && !nextOnboardingStep(app)) return router.replace('/onboarding');
  const after = ONBOARDING_STEPS.slice(ONBOARDING_STEPS.indexOf(step) + 1);
  const next = app ? after.find((s) => !isStepComplete(app, s)) ?? nextOnboardingStep(app) : after[0];
  if (next) router.replace(STEP_ROUTES[next]);
  else router.replace('/onboarding');
}

/**
 * One registration step (progressive disclosure, like sign-in): step bars, a bold title, a short
 * explanation, the fields, and a sticky primary action. Reuses the shared AuthStepHeader.
 */
export function StepShell({ step, title, subtitle, children, footer }: { step: OnboardingStepId; title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <Screen
      header={<ScreenHeader onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding'))} />}
      footer={footer}
    >
      <AuthStepHeader step={ONBOARDING_STEPS.indexOf(step) + 1} total={ONBOARDING_STEPS.length} title={title} subtitle={subtitle} />
      <View style={styles.fields}>{children}</View>
    </Screen>
  );
}

type CaptureStep = 'choose' | 'review' | 'view' | 'denied';

/**
 * One photo field, as a compact row (D-099): a small thumbnail, what the photo is, and Add or Retake.
 * Tapping opens a sheet to take or choose the photo; the photo is then shown large once, so the driver
 * can check it is clear before using it. Size sits where it helps (checking the photo), not on the form.
 * `selfie` = a photo of the driver (front camera, face check, round thumbnail). `cameraOnly` = no
 * choosing an old photo (the ID selfie). Permission is asked only when the driver picks a source.
 */
export function PhotoCapture({
  label,
  hint,
  uri,
  onChange,
  selfie,
  cameraOnly,
  testID,
}: {
  label: string;
  hint: string;
  uri?: string;
  onChange: (uri: string) => void;
  selfie?: boolean;
  cameraOnly?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<CaptureStep>('choose');
  const [candidate, setCandidate] = useState<string | null>(null);
  const [source, setSource] = useState<'camera' | 'library'>('camera');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = () => {
    setError(null);
    setCandidate(null);
    setStep(uri ? 'view' : 'choose');
    setOpen(true);
  };

  const pick = async (from: 'camera' | 'library') => {
    if (busy) return;
    setError(null);
    setSource(from);
    setBusy(true);
    try {
      const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setStep('denied');
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: !selfie, cameraType: selfie ? ImagePicker.CameraType.front : ImagePicker.CameraType.back };
      const res = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      const asset = !res.canceled ? res.assets[0] : undefined;
      if (!asset) return;
      // A photo of a person is checked for one clear face before it is offered (D-098).
      if (selfie) {
        const face = await checkFacePhoto({ uri: asset.uri, width: asset.width, height: asset.height });
        if (!face.ok) {
          setStep('choose');
          return setError(face.error);
        }
      }
      setCandidate(asset.uri);
      setStep('review');
    } catch {
      setStep('choose');
      setError(cameraOnly ? 'We couldn’t open the camera. Try again.' : 'We couldn’t open that. Try the other option.');
    } finally {
      setBusy(false);
    }
  };

  const shown = step === 'review' ? candidate : uri;
  const title = step === 'review' ? 'Is it clear?' : step === 'denied' ? `Allow ${source === 'camera' ? 'camera' : 'photo'} access` : label;
  const footer =
    step === 'review' ? (
      <>
        <Button
          title="Use photo"
          onPress={() => {
            if (candidate) onChange(candidate);
            setOpen(false);
          }}
          testID="capture-use"
        />
        <Button title="Retake" variant="tertiary" onPress={() => setStep('choose')} />
      </>
    ) : step === 'view' ? (
      <>
        <Button title="Done" onPress={() => setOpen(false)} />
        <Button title="Retake" variant="tertiary" onPress={() => setStep('choose')} testID="capture-retake" />
      </>
    ) : step === 'denied' ? (
      <>
        <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
        <Button title="Not now" variant="tertiary" onPress={() => setStep('choose')} />
      </>
    ) : undefined;

  return (
    <>
      <Pressable
        onPress={start}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={uri ? `${label}: added. View or retake` : `Add ${label}`}
        style={({ pressed }) => [styles.capture, { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={[styles.thumb, selfie && styles.thumbRound, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : <Icon name={selfie ? 'account' : 'camera'} color="textSecondary" />}
        </View>
        <View style={styles.flex}>
          <Text variant="subhead" weight="semibold" numberOfLines={1}>
            {label}
          </Text>
          {uri ? (
            <View style={styles.done}>
              <Icon name="checkCircle" variant="filled" size="xs" color="success" />
              <Text variant="footnote" color="success">
                Added
              </Text>
            </View>
          ) : (
            <Text variant="footnote" color="textSecondary" numberOfLines={2}>
              {hint}
            </Text>
          )}
        </View>
        <View style={[styles.action, { backgroundColor: uri ? colors.secondary : colors.primary }]}>
          <Text variant="footnote" weight="semibold" style={{ color: uri ? colors.text : colors.onPrimary }}>
            {uri ? 'Retake' : 'Add'}
          </Text>
        </View>
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title={title} subtitle={step === 'choose' ? hint : undefined} footer={footer} testID="capture-sheet">
        {step === 'choose' ? (
          <>
            {error ? (
              <View style={styles.notice} accessibilityLiveRegion="polite">
                <Icon name="warning" color="danger" size="sm" />
                <Text variant="callout" color="danger" style={styles.flex} testID="capture-error">
                  {error}
                </Text>
              </View>
            ) : null}
            {busy ? (
              <Text variant="footnote" color="textSecondary" accessibilityLiveRegion="polite">
                Checking your photo…
              </Text>
            ) : null}
            <ListGroup>
              <ListItem title="Take a photo" leadingIcon="camera" leadingBadge onPress={() => void pick('camera')} testID="capture-camera" />
              {cameraOnly ? null : <ListItem title="Choose from library" leadingIcon="upload" leadingBadge onPress={() => void pick('library')} testID="capture-library" />}
            </ListGroup>
            {cameraOnly ? (
              <Text variant="footnote" color="textSecondary">
                This one has to be taken now, so we know it’s you today.
              </Text>
            ) : null}
          </>
        ) : step === 'denied' ? (
          <Text variant="callout">
            {source === 'camera' ? 'Camera' : 'Photo'} access is off. Allow it in Settings{cameraOnly ? '.' : ', or use the other option.'}
          </Text>
        ) : shown ? (
          <View style={styles.reviewWrap}>
            <View style={[selfie ? styles.reviewSelfie : styles.reviewDoc, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
              <Image source={{ uri: shown }} style={StyleSheet.absoluteFill} contentFit={selfie ? 'cover' : 'contain'} accessibilityLabel={`${label}, large`} accessibilityIgnoresInvertColors />
            </View>
            {step === 'review' ? (
              <Text variant="footnote" color="textSecondary" align="center">
                {selfie ? 'Your whole face, in focus, nothing covering it.' : 'All four corners showing, and every word easy to read.'}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

/** Pill choices for short lists (city, document type, category). Selection = filled + check, not colour alone. */
export function ChoiceRow<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value?: T; onChange: (v: T) => void; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.choiceWrap}>
      <Text variant="footnote" weight="medium" color="textSecondary">
        {label}
      </Text>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <Pressable
              key={o.id}
              onPress={() => onChange(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              testID={`choice-${o.id}`}
              style={({ pressed }) => [
                styles.choice,
                { backgroundColor: on ? colors.primary : colors.surfaceMuted, borderColor: on ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              {on ? <Icon name="check" size="xs" color="onPrimary" /> : null}
              <Text variant="subhead" weight="semibold" style={{ color: on ? colors.onPrimary : colors.text }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fields: { gap: spacing.lg, marginTop: spacing.md },
  capture: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 72, padding: spacing.md, borderRadius: layout.cardRadius, borderWidth: 1 },
  thumb: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbRound: { borderRadius: 24 },
  done: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  action: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reviewWrap: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  reviewSelfie: { width: 200, height: 200, borderRadius: 100, borderWidth: 1, overflow: 'hidden' },
  reviewDoc: { alignSelf: 'stretch', aspectRatio: 1.5, borderRadius: layout.cardRadius, borderWidth: 1, overflow: 'hidden' },
  choiceWrap: { gap: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: 999, borderWidth: 1 },
});
