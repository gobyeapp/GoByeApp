import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, CompletionMark, Screen, ScreenHeader, Text, spacing, useToast } from '@gobye/ui';
import { STEP_ROUTES } from '@/features/onboarding/parts';
import { SimNote } from '@/features/common/SimNote';
import { resetTo } from '@/features/navigation/reset';
import { VerificationCard } from '@/features/verification/VerificationCard';
import { useDriver } from '@/state/driver';

/**
 * D08 Verification status: the same card as the dashboard (stage, checks, anything flagged or delayed),
 * full screen; approved → a welcome and "Start driving".
 */
export default function VerificationStatus() {
  const d = useDriver();
  const toast = useToast();
  const back = () => (router.canGoBack() ? router.back() : resetTo('/(tabs)'));

  if (d.verification === 'approved') {
    return (
      <Screen footer={<Button title="Start driving" onPress={() => resetTo('/(tabs)')} testID="status-start" />}>
        <View style={styles.center}>
          <CompletionMark tone="success" size={88} />
          <Text variant="title1" align="center" accessibilityRole="header">
            You’re approved
          </Text>
          <Text variant="callout" color="textSecondary" align="center">
            Welcome to GoBye, {d.application.personal?.firstName}. Get an access pass, go online, and keep every fare you earn.
          </Text>
        </View>
      </Screen>
    );
  }

  const run = (r: { ok: true } | { ok: false; error: string }) => {
    if (!r.ok) toast(r.error, 'error');
  };
  return (
    <Screen header={<ScreenHeader title="Verification" onBack={back} />}>
      <View style={styles.body}>
        <VerificationCard
          application={d.application}
          onOpenStep={(step) => router.push(STEP_ROUTES[step])}
          onSubmit={() => run(d.submitApplication())}
          onResubmit={() => run(d.resubmitApplication())}
        />
        {d.relayConnected ? null : <SimNote>Preview: checks run on their own, and the licence check waits on the FRSC for a few seconds.</SimNote>}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: spacing.md, marginTop: spacing.huge, paddingHorizontal: spacing.sm },
  body: { gap: spacing.xl, marginTop: spacing.md },
});
