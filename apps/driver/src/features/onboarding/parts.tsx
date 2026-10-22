import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { ONBOARDING_STEPS, isStepComplete, nextOnboardingStep, type DriverApplication, type OnboardingStepId } from '@gobye/core';
import { AuthStepHeader, Button, Icon, Screen, ScreenHeader, Text, layout, spacing, useTheme, type IconName } from '@gobye/ui';

export const STEP_ROUTES: Record<OnboardingStepId, `/onboarding/${OnboardingStepId}`> = {
  personal: '/onboarding/personal',
  licence: '/onboarding/licence',
  identity: '/onboarding/identity',
  vehicle: '/onboarding/vehicle',
  documents: '/onboarding/documents',
};

export const STEP_META: Record<OnboardingStepId, { title: string; icon: IconName; summary: string }> = {
  personal: { title: 'About you', icon: 'account', summary: 'Name, email and city' },
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

/**
 * Document or selfie capture. Camera first (front camera for selfies), library as the alternative.
 * Permission is asked only when the driver taps; a refusal explains how to allow it in Settings.
 */
export function PhotoCapture({
  label,
  hint,
  uri,
  onChange,
  selfie,
  testID,
}: {
  label: string;
  hint: string;
  uri?: string;
  onChange: (uri: string) => void;
  selfie?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);

  const pick = async (from: 'camera' | 'library') => {
    setError(null);
    try {
      const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError(from === 'camera' ? 'Camera access is off. Allow it in Settings, or choose a photo instead.' : 'Photo access is off. Allow it in Settings to choose a photo.');
        return;
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: !selfie, cameraType: selfie ? ImagePicker.CameraType.front : ImagePicker.CameraType.back };
      const res = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (!res.canceled && res.assets[0]) onChange(res.assets[0].uri);
    } catch {
      setError('We couldn’t open the camera. Try choosing a photo instead.');
    }
  };

  return (
    <View style={styles.capture} testID={testID}>
      <View style={styles.captureHead}>
        <Text variant="subhead" weight="semibold">
          {label}
        </Text>
        {uri ? (
          <View style={styles.done}>
            <Icon name="checkCircle" variant="filled" size="xs" color="success" />
            <Text variant="footnote" color="success">
              Added
            </Text>
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={() => pick('camera')}
        accessibilityRole="button"
        accessibilityLabel={uri ? `Retake ${label}` : `Take a photo of ${label}`}
        style={({ pressed }) => [
          styles.frame,
          selfie && styles.frameSelfie,
          { borderColor: uri ? colors.border : colors.textSecondary, backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <View style={styles.empty}>
            <View style={[styles.camIcon, { backgroundColor: colors.card }]}>
              <Icon name="camera" color="text" />
            </View>
            <Text variant="footnote" color="textSecondary" align="center">
              {hint}
            </Text>
          </View>
        )}
      </Pressable>
      <View style={styles.captureActions}>
        <Button title={uri ? 'Retake' : 'Take photo'} size="md" variant="secondary" leadingIcon="camera" onPress={() => pick('camera')} style={styles.flex} />
        <Button title="Choose photo" size="md" variant="tertiary" onPress={() => pick('library')} style={styles.flex} />
      </View>
      {error ? (
        <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="link">
          <Text variant="footnote" color="danger">
            {error}
          </Text>
        </Pressable>
      ) : null}
    </View>
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
  capture: { gap: spacing.sm },
  captureHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  done: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  frame: { height: 168, borderRadius: layout.cardRadius, borderWidth: 1.5, borderStyle: 'dashed', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  frameSelfie: { height: 220 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  camIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  captureActions: { flexDirection: 'row', gap: spacing.sm },
  choiceWrap: { gap: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: 999, borderWidth: 1 },
});
