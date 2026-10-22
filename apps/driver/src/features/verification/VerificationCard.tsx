import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { verificationSummary, type CheckState, type DriverApplication, type OnboardingStepId, type VerificationSummary } from '@gobye/core';
import { Button, Icon, Text, layout, spacing, useTheme, type IconName } from '@gobye/ui';
import { STEP_META } from '@/features/onboarding/parts';
import { formatTime } from '@/features/common/format';

/**
 * The dashboard card for a driver who isn't approved yet (D-049): where they are (Register → Review →
 * Drive), what's left to register, what staff flagged and how to fix it, and which check is held up
 * by an outside office and why. One clear next action. Status colours always come with an icon and text.
 */
interface CardProps {
  application: DriverApplication;
  onOpenStep: (step: OnboardingStepId) => void;
  onSubmit: () => void;
  onResubmit: () => void;
}

/** The card's one next action as a button, for placing outside a scroll view (always in reach). */
export function VerificationAction({ application, onOpenStep, onSubmit, onResubmit }: CardProps) {
  const s = verificationSummary(application);
  if (!s.action) return null;
  const target = s.action.target;
  const act = () => (target === 'submit' ? onSubmit() : target === 'resubmit' ? onResubmit() : onOpenStep(target));
  return <Button title={s.action.label} onPress={act} testID="verification-action" />;
}

export function VerificationCard({ showAction = true, ...props }: CardProps & { showAction?: boolean }) {
  const { application, onOpenStep } = props;
  const { colors } = useTheme();
  const s = verificationSummary(application);

  return (
    <View style={styles.card} testID={`verification-${s.stage}`}>
      <Stepper steps={s.steps} />
      <View style={styles.head}>
        <Text variant="title3" accessibilityRole="header" accessibilityLiveRegion="polite" testID="verification-title">
          {s.title}
        </Text>
        <Text variant="footnote" color="textSecondary">
          {s.body}
        </Text>
      </View>

      {s.stage === 'register' && s.todo.length ? (
        <View style={[styles.group, { backgroundColor: colors.surfaceMuted }]}>
          {s.todo.map((step, i) => (
            <Row key={step} icon={STEP_META[step].icon} title={STEP_META[step].title} sub={STEP_META[step].summary} next={i === 0} onPress={() => onOpenStep(step)} testID={`todo-${step}`} />
          ))}
        </View>
      ) : null}

      {s.issues.length ? (
        <View style={styles.issues}>
          {s.issues.map((i) => (
            <View key={i.id} style={[styles.issue, { backgroundColor: colors.warningSurface }]} testID={`issue-${i.code}`}>
              <Icon name="warning" size="sm" color="warning" />
              <View style={styles.flex}>
                <Text variant="subhead" weight="semibold">
                  {i.title}
                </Text>
                <Text variant="footnote" color="textSecondary">
                  {i.fix}
                </Text>
                {i.note ? (
                  <Text variant="footnote" style={styles.note}>
                    Our team: “{i.note}”
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => onOpenStep(i.step)} accessibilityRole="button" accessibilityLabel={`Fix ${i.title}`} hitSlop={6} style={({ pressed }) => [styles.fix, { backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 }]} testID={`fix-${i.code}`}>
                <Text variant="footnote" weight="semibold">
                  Fix
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {s.waiting.length ? (
        <View style={styles.issues}>
          {s.waiting.map((w) => (
            <View key={w.id} style={[styles.issue, { backgroundColor: colors.surfaceMuted }]} accessible accessibilityLabel={`${w.label}: waiting. ${w.reason}`} testID={`waiting-${w.id}`}>
              <Icon name="timer" size="sm" color="text" />
              <View style={styles.flex}>
                <Text variant="subhead" weight="semibold">
                  {w.label} · waiting since {formatTime(w.since)}
                </Text>
                <Text variant="footnote" color="textSecondary">
                  {w.reason}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {s.stage === 'review' ? (
        <View style={[styles.group, styles.checks, { backgroundColor: colors.surfaceMuted }]}>
          {s.checks.map((c) => (
            <CheckRow key={c.id} label={c.label} state={c.state} />
          ))}
        </View>
      ) : null}

      {s.stage === 'rejected' ? (
        <Button title="Contact driver support" variant="secondary" leadingIcon="support" onPress={() => Linking.openURL('mailto:support@gobye.app?subject=Driver%20application')} />
      ) : null}
      {showAction ? <VerificationAction {...props} /> : null}
    </View>
  );
}

function Stepper({ steps }: { steps: VerificationSummary['steps'] }) {
  const { colors } = useTheme();
  const current = steps.find((x) => x.state === 'current' || x.state === 'blocked');
  return (
    <View style={styles.stepper} accessible accessibilityLabel={`Stage: ${current?.label ?? 'Drive'}. ${steps.map((x) => `${x.label} ${x.state === 'done' ? 'done' : x.state === 'blocked' ? 'needs changes' : x.state === 'current' ? 'now' : 'to come'}`).join(', ')}`}>
      {steps.map((x, i) => {
        const on = x.state === 'done' || x.state === 'current' || x.state === 'blocked';
        const fill = x.state === 'blocked' ? colors.warning : x.state === 'todo' ? colors.border : colors.text;
        return (
          <View key={x.id} style={styles.stepCol}>
            <View style={[styles.bar, { backgroundColor: fill }]} />
            <View style={styles.stepLabel}>
              {x.state === 'done' ? <Icon name="checkCircle" variant="filled" size={12} color="text" /> : x.state === 'blocked' ? <Icon name="warning" size={12} color="warning" /> : null}
              <Text variant="caption" weight={x.state === 'current' || x.state === 'blocked' ? 'bold' : 'medium'} color={on ? 'text' : 'textSecondary'}>
                {i + 1}. {x.label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const CHECK_STATE: Record<CheckState, { icon: IconName | null; label: string; tone: 'success' | 'warning' | 'danger' | 'textSecondary' | 'text' }> = {
  passed: { icon: 'checkCircle', label: 'Done', tone: 'success' },
  checking: { icon: null, label: 'Checking', tone: 'text' },
  waiting: { icon: 'timer', label: 'Waiting', tone: 'warning' },
  queued: { icon: 'clock', label: 'Queued', tone: 'textSecondary' },
  failed: { icon: 'warning', label: 'Needs a fix', tone: 'danger' },
};

function CheckRow({ label, state }: { label: string; state: CheckState }) {
  const { colors } = useTheme();
  const m = CHECK_STATE[state];
  return (
    <View style={styles.check} accessible accessibilityLabel={`${label}: ${m.label}`} testID={`check-${state}`}>
      {m.icon ? <Icon name={m.icon} variant={state === 'passed' ? 'filled' : 'regular'} size="sm" color={m.tone} /> : <ActivityIndicator size="small" color={colors.text} style={styles.spin} />}
      <Text variant="footnote" style={styles.flex} color={state === 'queued' ? 'textSecondary' : 'text'}>
        {label}
      </Text>
      <Text variant="caption" weight="semibold" color={m.tone}>
        {m.label}
      </Text>
    </View>
  );
}

function Row({ icon, title, sub, next, onPress, testID }: { icon: IconName; title: string; sub: string; next?: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}${next ? ', next' : ''}. ${sub}`} style={({ pressed }) => [styles.row, { backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 }]} testID={testID}>
      <Icon name={icon} size="sm" color="text" />
      <View style={styles.flex}>
        <Text variant="subhead" weight="semibold">
          {title}
        </Text>
        <Text variant="caption" weight="regular" color="textSecondary" numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {next ? (
        <Text variant="caption" weight="bold" color="accentText">
          Next
        </Text>
      ) : null}
      <Icon name="chevronRight" size="xs" color="textSecondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { gap: spacing.md },
  head: { gap: 4 },
  stepper: { flexDirection: 'row', gap: 6 },
  stepCol: { flex: 1, gap: 6 },
  bar: { height: 4, borderRadius: 2 },
  stepLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  group: { borderRadius: layout.controlRadius, padding: 4, gap: 2 },
  checks: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, minHeight: 52, borderRadius: layout.controlRadius - 4 },
  issues: { gap: spacing.sm },
  issue: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: layout.controlRadius },
  note: { marginTop: 2, fontStyle: 'italic' },
  fix: { paddingHorizontal: spacing.md, minHeight: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 22 },
  spin: { width: 20 },
});
