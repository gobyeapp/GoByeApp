import { StyleSheet, View } from 'react-native';
import { Button, CompletionMark, Icon, Screen, Text, layout, spacing, useTheme } from '@gobye/ui';
import { SimNote } from '@/features/common/SimNote';
import { resetTo } from '@/features/navigation/reset';
import { useDriver } from '@/state/driver';
import { useSession } from '@/state/session';

/** D08 Verification status: in review → approved (or rejected with the reason and a way to fix it). */
export default function VerificationStatus() {
  const { colors } = useTheme();
  const { verification, application, updateApplication } = useDriver();
  const { signOut } = useSession();

  if (verification === 'approved') {
    return (
      <Screen footer={<Button title="Start driving" onPress={() => resetTo('/(tabs)')} testID="status-start" />}>
        <View style={styles.center}>
          <CompletionMark tone="success" size={88} />
          <Text variant="title1" align="center" accessibilityRole="header">
            You’re approved
          </Text>
          <Text variant="callout" color="textSecondary" align="center">
            Welcome to GoBye, {application.personal?.firstName}. Get an access pass, go online, and keep every fare you earn.
          </Text>
        </View>
      </Screen>
    );
  }

  if (verification === 'rejected') {
    return (
      <Screen footer={<Button title="Fix and resubmit" onPress={() => { updateApplication({ status: 'in_progress' }); resetTo('/onboarding'); }} />}>
        <View style={styles.center}>
          <View style={[styles.tile, { backgroundColor: colors.dangerSurface }]}>
            <Icon name="warning" size="lg" color="danger" />
          </View>
          <Text variant="title1" align="center" accessibilityRole="header">
            We couldn’t approve you yet
          </Text>
          <Text variant="callout" color="textSecondary" align="center">
            {application.rejectionReason ?? 'One of your documents couldn’t be read. Retake the photo and submit again.'}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          title="Log out"
          variant="tertiary"
          onPress={() => void signOut().then(() => resetTo('/auth/phone'))}
        />
      }
    >
      <View style={styles.center}>
        <View style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name="timer" size="lg" color="text" />
        </View>
        <Text variant="title1" align="center" accessibilityRole="header">
          We’re checking your documents
        </Text>
        <Text variant="callout" color="textSecondary" align="center">
          This usually takes up to 2 working days. We’ll text you when you’re approved.
        </Text>
      </View>
      <View style={[styles.steps, { backgroundColor: colors.surfaceMuted }]}>
        {[
          { t: 'Application received', done: true },
          { t: 'Licence and identity check', done: false },
          { t: 'Vehicle papers check', done: false },
        ].map((s) => (
          <View key={s.t} style={styles.step}>
            <Icon name={s.done ? 'checkCircle' : 'clock'} variant={s.done ? 'filled' : 'regular'} size="sm" color={s.done ? 'success' : 'textSecondary'} />
            <Text variant="callout" color={s.done ? 'text' : 'textSecondary'}>
              {s.t}
            </Text>
          </View>
        ))}
      </View>
      <SimNote>Preview: review finishes automatically in a few seconds.</SimNote>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: spacing.md, marginTop: spacing.huge, paddingHorizontal: spacing.sm },
  tile: { width: 80, height: 80, borderRadius: layout.cardRadius, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  steps: { borderRadius: layout.cardRadius, padding: spacing.lg, gap: spacing.md, marginTop: spacing.xxl, marginBottom: spacing.lg },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
