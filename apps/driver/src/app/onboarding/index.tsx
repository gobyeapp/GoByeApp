import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { ISSUES, ONBOARDING_STEPS, isStepComplete, nextOnboardingStep, onboardingProgress, openIssues } from '@gobye/core';
import { Button, Icon, ScreenHeader, Screen, Text, layout, spacing, useTheme } from '@gobye/ui';
import { STEP_META, STEP_ROUTES } from '@/features/onboarding/parts';
import { resetTo } from '@/features/navigation/reset';
import { useDriver } from '@/state/driver';
import { useSession } from '@/state/session';

/**
 * D03–D07 overview: the registration checklist. Each step can be opened in any order once started;
 * Submit appears when everything is done. Progress is saved after every step. When staff asked for
 * changes, the flagged steps are marked and the action sends the application back for review.
 */
export default function OnboardingOverview() {
  const { colors } = useTheme();
  const { application, submitApplication, resubmitApplication } = useDriver();
  const { signOut } = useSession();
  const { done, total } = onboardingProgress(application);
  const next = nextOnboardingStep(application);
  const flagged = openIssues(application);
  const flaggedSteps = new Set(flagged.map((i) => ISSUES[i.code].step));
  const changes = application.status === 'changes_requested';
  const locked = application.status === 'pending_review' || application.status === 'approved';

  const send = () => {
    const r = changes ? resubmitApplication() : submitApplication();
    if (!r.ok) return Alert.alert('Not ready yet', r.error);
    resetTo('/(tabs)');
  };
  const back = () => (router.canGoBack() ? router.back() : resetTo('/(tabs)'));

  const footer = locked ? (
    <Button title="Back to dashboard" variant="secondary" onPress={back} testID="onboarding-back" />
  ) : changes && flagged.length ? (
    <Button title={`Fix: ${ISSUES[flagged[0].code].title}`} onPress={() => router.push(STEP_ROUTES[ISSUES[flagged[0].code].step])} testID="onboarding-fix" />
  ) : next ? (
    <Button title={done === 0 ? 'Start' : 'Continue'} onPress={() => router.push(STEP_ROUTES[next])} testID="onboarding-next" />
  ) : (
    <Button title={changes ? 'Send back for review' : 'Submit for review'} onPress={send} testID="onboarding-submit" />
  );

  return (
    <Screen header={<ScreenHeader onBack={back} />} footer={footer}>
      <View style={styles.top}>
        <View />
        <Pressable onPress={() => void signOut().then(() => resetTo('/welcome'))} accessibilityRole="button" hitSlop={8}>
          <Text variant="subhead" color="textSecondary">
            Log out
          </Text>
        </Pressable>
      </View>
      <View style={styles.head}>
        <Text variant="title1" accessibilityRole="header">
          {changes ? (flagged.length ? 'A few things to fix' : 'Ready to send back') : locked ? 'Your registration' : next ? 'Become a GoBye driver' : 'Ready to submit'}
        </Text>
        <Text variant="callout" color="textSecondary">
          {changes
            ? flagged.length
              ? 'Open the marked steps, fix what we flagged, then send it back for review.'
              : 'Everything we flagged is fixed. Send it back for review.'
            : locked
              ? 'Your details are with our team. You can look at them here.'
              : next
                ? 'Five short steps. Have your licence, ID and vehicle papers nearby.'
                : 'Check your details, then send them for review.'}
        </Text>
      </View>

      <View style={styles.progress} accessible accessibilityRole="progressbar" accessibilityLabel={`${done} of ${total} steps done`}>
        <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
          <View style={[styles.fill, { width: `${(done / total) * 100}%`, backgroundColor: colors.primary }]} />
        </View>
        <Text variant="footnote" color="textSecondary" tabular>
          {done}/{total}
        </Text>
      </View>

      <View style={[styles.list, { backgroundColor: colors.surfaceMuted }]}>
        {ONBOARDING_STEPS.map((step, i) => {
          const complete = isStepComplete(application, step);
          const fix = flaggedSteps.has(step);
          const isNext = step === next;
          const meta = STEP_META[step];
          return (
            <Pressable
              key={step}
              onPress={() => router.push(STEP_ROUTES[step])}
              accessibilityRole="button"
              accessibilityLabel={`${meta.title}, ${fix ? 'needs a fix' : complete ? 'done' : isNext ? 'next' : 'to do'}`}
              testID={`step-${step}`}
              style={({ pressed }) => [styles.row, { backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 }, i === 0 && styles.first, i === ONBOARDING_STEPS.length - 1 && styles.last]}
            >
              <View style={[styles.num, { backgroundColor: fix ? colors.warningSurface : complete ? colors.success : isNext ? colors.primary : colors.surfaceMuted }]}>
                {fix ? (
                  <Icon name="warning" size="xs" color="warning" />
                ) : complete ? (
                  <Icon name="check" size="xs" color="onPrimary" />
                ) : (
                  <Text variant="caption" weight="bold" style={{ color: isNext ? colors.onPrimary : colors.textSecondary }}>
                    {i + 1}
                  </Text>
                )}
              </View>
              <View style={styles.texts}>
                <Text variant="headline">{meta.title}</Text>
                <Text variant="footnote" color="textSecondary">
                  {fix ? 'Needs a fix. Tap to update.' : complete ? 'Done. Tap to edit.' : meta.summary}
                </Text>
              </View>
              <Icon name={meta.icon} size="sm" color={complete ? 'textSecondary' : 'text'} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.note}>
        <Icon name="lock" size="xs" color="textSecondary" />
        <Text variant="footnote" color="textSecondary" style={styles.flex}>
          Your documents are used only to verify you and are never shown to riders.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  head: { gap: spacing.sm, marginTop: spacing.xl },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  list: { borderRadius: layout.cardRadius, padding: 6, gap: 2, marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, minHeight: 64, borderRadius: 6 },
  first: { borderTopLeftRadius: layout.cardRadius - 6, borderTopRightRadius: layout.cardRadius - 6 },
  last: { borderBottomLeftRadius: layout.cardRadius - 6, borderBottomRightRadius: layout.cardRadius - 6 },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
});
