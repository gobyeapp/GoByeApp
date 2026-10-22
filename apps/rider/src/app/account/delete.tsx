import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Checkbox, Icon, Screen, Text, layout, spacing, useTheme } from '@gobye/ui';
import { PageHeader } from '@/features/account/ui';
import { useAccount } from '@/state/account';
import { useBooking } from '@/state/booking';
import { useSession } from '@/state/session';

type Step = 'confirm' | 'processing' | 'failed' | 'done';

/** Simulated request time so the processing state is visible in the preview. */
const REQUEST_DELAY_MS = 1200;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * R28 Delete account (App Review Guideline 5.1.1(v)). Reached from the separate destructive section on
 * Account; this page is the confirmation step, so nothing is deleted on the first tap. States: confirm
 * (consequences, safe Cancel, explicit final action), processing, failed (message and retry) and done
 * (then sign out to the phone screen). The preview records a simulated request and clears local data;
 * the backend must perform the real deletion and honour record retention (docs/SECURITY_PRIVACY.md, Q-016).
 */
export default function DeleteAccount() {
  const { colors } = useTheme();
  const { requestDeletion } = useSession();
  const account = useAccount();
  const { booking } = useBooking();
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState<Step>('confirm');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const activeRide = !!booking && booking.status !== 'quoted';

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const remove = async () => {
    setStep('processing');
    try {
      await wait(REQUEST_DELAY_MS);
      const r = await requestDeletion();
      if (!r.ok) throw new Error(r.error);
      account.reset();
      if (!mounted.current) return;
      setStep('done');
      await wait(900);
      router.replace('/onboarding');
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error && e.message ? e.message : 'Something went wrong.');
      setStep('failed');
    }
  };

  if (step === 'done') {
    return (
      <Screen>
        <View style={styles.result} accessible accessibilityLiveRegion="polite" accessibilityLabel="Account deleted. Signing you out." testID="delete-done">
          <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
            <Icon name="check" size="xl" color="text" />
          </View>
          <Text variant="title2" align="center">
            Account deleted
          </Text>
          <Text variant="callout" color="textSecondary" align="center">
            Signing you out.
          </Text>
        </View>
      </Screen>
    );
  }

  const processing = step === 'processing';
  return (
    <Screen
      header={<PageHeader title="Delete account" onBack={processing ? undefined : () => router.back()} />}
      footer={
        <View style={styles.actions}>
          <Button
            title={step === 'failed' ? 'Try again' : 'Delete account'}
            variant="destructive"
            onPress={() => void remove()}
            disabled={!confirmed || activeRide}
            loading={processing}
            testID="delete-account"
          />
          <Button title="Cancel" variant="secondary" onPress={() => router.back()} disabled={processing} testID="delete-cancel" />
        </View>
      }
    >
      <Text variant="title2" accessibilityRole="header">
        Delete your account?
      </Text>
      <View style={styles.list}>
        <Bullet text="Your profile and saved places are removed." />
        <Bullet text="Refund any Wallet balance first." />
        <Bullet text="Some trip and payment records are kept where the law requires." />
        <Bullet text="This can’t be undone." />
      </View>
      {activeRide ? (
        <Text variant="callout" color="danger">
          Finish or cancel your current ride first.
        </Text>
      ) : null}
      {step === 'failed' ? (
        <View style={[styles.error, { backgroundColor: colors.dangerSurface }]} accessible accessibilityLiveRegion="assertive" testID="delete-error">
          <Icon name="warning" size="sm" color="danger" />
          <Text variant="callout" color="danger" style={styles.flex}>
            Couldn’t delete your account. {error}
          </Text>
        </View>
      ) : null}
      <Checkbox checked={confirmed} onChange={setConfirmed} label="I understand this is permanent." testID="confirm-delete" />
      {processing ? (
        <Text variant="footnote" color="textSecondary" accessibilityLiveRegion="polite">
          Deleting your account…
        </Text>
      ) : (
        <Text variant="footnote" color="textSecondary">
          Preview: clears data on this device only.
        </Text>
      )}
    </Screen>
  );
}

function Bullet({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.bullet}>
      <View style={[styles.dot, { backgroundColor: colors.textSecondary }]} />
      <Text variant="callout" color="textSecondary" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: spacing.sm },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 9 },
  actions: { gap: spacing.sm },
  error: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: layout.container, borderRadius: layout.cardRadius },
  result: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.xxl * 2 },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
});
