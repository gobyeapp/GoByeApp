import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { formatNaira, nairaAccessibilityLabel, paymentCharge, type Kobo, type PaymentMethod, type PaymentStatus } from '@gobye/core';
import { Bone, Button, Icon, IconButton, KeyValue, Screen, Sheet, SkeletonGroup, Text, layout, spacing, useTheme, useToast } from '@gobye/ui';
import { SimulatedNote, paymentIcon } from '@/features/booking/components';
import { useConfirmBeforeBack } from '@/features/booking/useCancelRide';
import { resetTo } from '@/features/navigation/reset';
import { CompletionMark } from '@/features/trip/CompletionMark';
import { PaymentMethodSheet } from '@/features/trip/PaymentMethodSheet';
import { TransferSheet } from '@/features/trip/TransferSheet';
import { paymentReference } from '@/features/trip/live';
import { DepositSheet } from '@/features/wallet/DepositSheet';
import { useAccount } from '@/state/account';
import { useBooking } from '@/state/booking';
import { useHaptics } from '@/state/haptics';
import { useWallet } from '@/state/wallet';

/**
 * End of trip, step 1 of 3 (2026-10-21 end-of-trip brief): trip completed → pay → summary.
 * One purpose: pay. A neutral check says the journey ended (never that payment succeeded), the amount
 * due appears once, then the method with "Change" and one primary action. Driver, rating, receipt and
 * journey details live on the summary after payment; the breakdown is one tap away.
 *
 * Wallet: choosing it never charges; "Pay ₦X" does, with progress inside the button and duplicate taps
 * blocked (PAYMENT_STARTED). Bank transfer: "Pay ₦X" opens the account details; "I’ve transferred"
 * only starts a check and the payment stays pending until the transfer is received.
 */
export default function TripComplete() {
  const { colors } = useTheme();
  const toast = useToast();
  const haptic = useHaptics();
  const reduce = useReducedMotion();
  const booking = useBooking();
  const { paymentMethods } = useAccount();
  const wallet = useWallet();
  const [sheet, setSheet] = useState<'method' | 'transfer' | 'breakdown' | 'deposit' | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PaymentMethod | null>(null);
  const leaving = useRef(false);
  const b = booking.booking;
  const status: PaymentStatus | undefined = b?.status === 'completed' ? 'paid' : b?.paymentStatus;
  const lastStatus = useRef(status);

  // A transfer the passenger says they sent (or a payment whose result didn't come back) is awaiting
  // confirmation, not unpaid: the wording on the way out and on Home must not invite a second payment.
  const awaiting = b?.paymentStatus === 'pending' && !!b.paymentNotice;
  // Pay later: the trip stays outstanding (Home banner) and no new trip starts until it's paid.
  const payLater = () => {
    if (status === 'processing') return;
    toast(awaiting ? 'Payment pending. Check again from Home.' : 'Payment outstanding. Pay from Home.', 'info');
    resetTo('/(tabs)');
  };
  useConfirmBeforeBack(true, payLater);

  useEffect(() => {
    if (leaving.current) return;
    if (!b) return void resetTo('/(tabs)');
    // Opened on a trip that is already paid (restored session): go straight to the summary.
    if (status === 'paid' && lastStatus.current === 'paid') {
      leaving.current = true;
      return void router.replace('/trip-summary');
    }
    if (lastStatus.current !== status) {
      if (lastStatus.current === 'processing') void wallet.refresh();
      if (status === 'paid') {
        leaving.current = true;
        router.replace('/trip-paid');
      }
      if (status === 'failed' || status === 'reversed') haptic('error');
      lastStatus.current = status;
    }
  }, [b, status, haptic, wallet]);

  if (!b || status === 'paid') return null;
  const charge = paymentCharge(b.agreedFare ?? b.quote.suggested, b.paymentMethod.type);
  const method = b.paymentMethod;
  const isWallet = method.type === 'wallet';
  const isTransfer = method.type === 'bank_transfer';
  const processing = status === 'processing';
  const notSeen = status === 'pending' && b.paymentNotice === 'transfer_not_received';
  const notConfirmed = status === 'pending' && b.paymentNotice === 'not_confirmed';
  const walletLoading = isWallet && wallet.state === 'loading';
  // A balance that failed to load is unknown, not zero: never claim a shortfall we can't see.
  const walletUnknown = isWallet && wallet.state === 'error';
  const shortfall = isWallet && wallet.state === 'ready' ? Math.max(0, charge.total - wallet.available) : 0;
  const driverFirst = b.driver?.firstName ?? 'your driver';

  const pay = () => {
    const r = booking.confirmPayment();
    // A second tap while the first request is starting is simply ignored (no error for the passenger).
    if (!r.ok) {
      if (booking.booking?.paymentStatus !== 'processing') toast(r.error, 'error');
    } else haptic('impact');
  };
  const choose = (m: PaymentMethod) => {
    setSheet(null);
    if (m.id === method.id) return;
    // A transfer they say they sent, or a wallet payment whose result didn't come back, may already
    // have gone through: switching now could make them pay twice, so ask first.
    if (awaiting) return setPendingSwitch(m);
    booking.choosePaymentMethod(m);
  };

  // One primary action for each state; the label says exactly what happens.
  const primary = processing ? (
    <Button title={isTransfer ? 'Checking transfer' : 'Paying'} loadingLabel={isTransfer ? 'Checking transfer' : 'Paying'} loading disabled onPress={() => undefined} testID="payment-processing" />
  ) : notConfirmed || (isTransfer && (notSeen || status === 'failed')) ? (
    // Re-check, never re-open "Pay": the transfer may already be on its way.
    <Button title="Check again" onPress={pay} testID="check-transfer" />
  ) : isWallet && shortfall > 0 ? (
    <Button title="Add money" leadingIcon="plus" onPress={() => setSheet('deposit')} testID="top-up" />
  ) : isTransfer ? (
    <Button
      title={`Pay ${formatNaira(charge.total)}`}
      accessibilityLabel={`Pay ${nairaAccessibilityLabel(charge.total)} by bank transfer. Shows the account details.`}
      onPress={() => setSheet('transfer')}
      testID="open-transfer"
    />
  ) : (
    <Button
      title={status === 'failed' || status === 'reversed' ? 'Try again' : `Pay ${formatNaira(charge.total)}`}
      accessibilityLabel={`Pay ${nairaAccessibilityLabel(charge.total)} from your GoBye wallet`}
      disabled={walletLoading}
      onPress={pay}
      testID="confirm-pay"
    />
  );

  const footer = (
    <>
      {primary}
      {processing ? null : (
        <Pressable onPress={payLater} accessibilityRole="button" style={styles.linkBtn} testID="pay-later" hitSlop={4}>
          <Text variant="subhead" weight="semibold" color="textSecondary">
            {awaiting ? 'Check later' : 'Pay later'}
          </Text>
        </Pressable>
      )}
    </>
  );

  return (
    <Screen footer={footer}>
      <View style={styles.top}>
        <IconButton icon="help" accessibilityLabel="Report an issue" onPress={() => router.push('/account/support')} />
      </View>
      <View style={styles.body}>
        {/* Journey ended. Neutral, so it never reads as "paid". */}
        <View style={styles.hero}>
          <CompletionMark tone="neutral" />
          <Text variant="title2" align="center" accessibilityRole="header">
            You’ve arrived
          </Text>
          <Text variant="subhead" color="textSecondary" align="center" numberOfLines={2}>
            {b.destination.title}
          </Text>
        </View>

        {/* The amount due, once. */}
        <View style={styles.amountBlock} accessible accessibilityLabel={`Amount due, ${nairaAccessibilityLabel(charge.total)}`}>
          <Text variant="subhead" color="textSecondary">
            Amount due
          </Text>
          <Text style={[styles.amount, { color: colors.text }]} tabular maxFontSizeMultiplier={1.3}>
            {formatNaira(charge.total)}
          </Text>
          <Pressable onPress={() => setSheet('breakdown')} accessibilityRole="button" hitSlop={8} style={styles.breakdownBtn} testID="view-breakdown">
            <Text variant="footnote" weight="semibold" style={styles.underline}>
              View breakdown
            </Text>
          </Pressable>
        </View>

        {/* Method with a clear Change action, then one status line (same slot, so the layout stays steady). */}
        <View style={[styles.method, { backgroundColor: colors.surfaceMuted }]}>
          <View style={[styles.methodIcon, { backgroundColor: colors.card }]}>
            <Icon name={paymentIcon(method)} variant="filled" size="sm" color="text" />
          </View>
          <View style={styles.flex}>
            <Text variant="callout" weight="semibold" numberOfLines={1}>
              {method.label}
            </Text>
            {isWallet ? (
              walletLoading ? (
                <SkeletonGroup label="Loading wallet balance">
                  <Bone width={110} height={12} style={styles.boneGap} />
                </SkeletonGroup>
              ) : walletUnknown ? (
                <Pressable onPress={() => void wallet.refresh()} accessibilityRole="button" hitSlop={6} testID="wallet-retry">
                  <Text variant="footnote" color="textSecondary">
                    Balance unavailable. <Text variant="footnote" weight="semibold" style={styles.underline}>Retry</Text>
                  </Text>
                </Pressable>
              ) : (
                <Text variant="footnote" color="textSecondary" tabular accessibilityLabel={`Balance ${nairaAccessibilityLabel(wallet.available)}`}>
                  Balance {formatNaira(wallet.available)}
                </Text>
              )
            ) : (
              <Text variant="footnote" color="textSecondary">
                To {driverFirst}’s bank
              </Text>
            )}
          </View>
          <Pressable
            onPress={() => setSheet('method')}
            disabled={processing}
            accessibilityRole="button"
            accessibilityLabel={`Change payment method. Now ${method.label}`}
            hitSlop={8}
            style={({ pressed }) => [styles.change, { backgroundColor: pressed ? colors.secondaryPressed : colors.card, opacity: processing ? 0.4 : 1 }]}
            testID="change-method"
          >
            <Text variant="subhead" weight="semibold">
              Change
            </Text>
          </Pressable>
        </View>

        <StatusLine
          key={`${status}-${b.paymentNotice}-${shortfall > 0}`}
          reduce={!!reduce}
          status={status}
          isTransfer={isTransfer}
          notSeen={notSeen}
          notConfirmed={notConfirmed}
          shortfall={shortfall as Kobo}
          onDetails={isTransfer && (notSeen || status === 'failed') ? () => setSheet('transfer') : undefined}
        />

        <SimulatedNote text="Test payment. No real money moves." />
      </View>

      <PaymentMethodSheet
        visible={sheet === 'method'}
        onClose={() => setSheet(null)}
        methods={paymentMethods}
        selectedId={method.id}
        walletAvailable={wallet.available}
        walletLoading={wallet.state === 'loading'}
        walletUnknown={wallet.state === 'error'}
        amount={paymentCharge(charge.fare, 'wallet').total}
        onSelect={choose}
      />

      <TransferSheet
        visible={sheet === 'transfer'}
        onClose={() => setSheet(null)}
        payout={b.driver?.payoutAccount}
        amount={charge.total}
        reference={paymentReference(b.id)}
        checking={processing}
        onSent={() => {
          setSheet(null);
          pay();
        }}
        onUseWallet={() => {
          const m = paymentMethods.find((x) => x.type === 'wallet');
          if (m) choose(m);
        }}
      />

      <DepositSheet visible={sheet === 'deposit'} onClose={() => setSheet(null)} />

      <Sheet visible={sheet === 'breakdown'} onClose={() => setSheet(null)} title="Breakdown" testID="breakdown-sheet">
        <KeyValue label={b.mode === 'negotiate' ? 'Agreed fare' : 'Trip fare'} value={formatNaira(charge.fare)} spoken={nairaAccessibilityLabel(charge.fare)} />
        {charge.processingFee > 0 ? <KeyValue label={`${method.label} fee`} value={formatNaira(charge.processingFee)} spoken={nairaAccessibilityLabel(charge.processingFee)} /> : null}
        <KeyValue label="Total" value={formatNaira(charge.total)} spoken={nairaAccessibilityLabel(charge.total)} bold />
      </Sheet>

      <Sheet
        visible={!!pendingSwitch}
        onClose={() => setPendingSwitch(null)}
        title={isTransfer ? 'Already sent the transfer?' : 'Wallet payment not confirmed'}
        subtitle={isTransfer ? 'Paying another way could charge you twice.' : 'It may have gone through. Check again before paying another way.'}
        testID="switch-confirm"
        footer={
          <>
            <Button title={`Keep ${method.label}`} onPress={() => setPendingSwitch(null)} testID="switch-keep" />
            <Button
              title={`Use ${pendingSwitch?.label ?? 'this method'}`}
              variant="secondary"
              onPress={() => {
                if (pendingSwitch) booking.choosePaymentMethod(pendingSwitch);
                setPendingSwitch(null);
              }}
              testID="switch-anyway"
            />
          </>
        }
      >
        {null}
      </Sheet>
    </Screen>
  );
}

/** One short line for anything the passenger needs to know before acting. Colour is never the only cue. */
function StatusLine(p: { reduce: boolean; status?: PaymentStatus; isTransfer: boolean; notSeen: boolean; notConfirmed: boolean; shortfall: Kobo; onDetails?: () => void }) {
  const { colors } = useTheme();
  let tone: 'warning' | 'danger' | 'neutral' | null = null;
  let icon: 'warning' | 'clock' | 'refresh' = 'warning';
  let text = '';
  let spoken: string | undefined;
  if (p.status === 'processing') return null; // progress shows inside the button
  if (p.notConfirmed) {
    tone = 'warning';
    icon = 'clock';
    text = 'Pending. We couldn’t confirm it yet. Check again; you won’t be charged twice.';
  } else if (p.shortfall > 0) {
    tone = 'danger';
    text = `${formatNaira(p.shortfall)} short. Add money or change method.`;
    spoken = `${nairaAccessibilityLabel(p.shortfall)} short. Add money or change method.`;
  } else if (p.notSeen) {
    tone = 'warning';
    icon = 'clock';
    text = 'Pending. Transfer not received yet. Don’t send it twice.';
  } else if (p.status === 'failed') {
    tone = 'danger';
    text = p.isTransfer ? 'We couldn’t confirm your transfer.' : 'Payment didn’t go through. Nothing was taken.';
  } else if (p.status === 'reversed') {
    tone = 'neutral';
    icon = 'refresh';
    text = 'Payment reversed and refunded. Please pay again.';
  }
  if (!tone) return null;
  const bg = tone === 'danger' ? colors.dangerSurface : tone === 'warning' ? colors.warningSurface : colors.neutralSurface;
  const fg = tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'textSecondary';
  return (
    <Animated.View entering={p.reduce ? undefined : FadeIn.duration(160)} style={[styles.notice, { backgroundColor: bg }]} accessible={!p.onDetails} accessibilityLabel={spoken ?? text} accessibilityLiveRegion="polite" testID="payment-status-line">
      <Icon name={icon} variant="filled" size="sm" color={fg} />
      <Text variant="subhead" color={tone === 'neutral' ? 'text' : fg} style={styles.flex}>
        {text}
      </Text>
      {p.onDetails ? (
        <Pressable onPress={p.onDetails} accessibilityRole="button" accessibilityLabel="Show transfer details" hitSlop={8} style={styles.detailsBtn} testID="transfer-details">
          <Text variant="subhead" weight="semibold" style={styles.underline}>
            Details
          </Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: spacing.xs },
  body: { gap: spacing.xl, paddingBottom: spacing.lg },
  hero: { alignItems: 'center', gap: spacing.sm },
  amountBlock: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 44, lineHeight: 52, letterSpacing: -1 },
  breakdownBtn: { minHeight: 32, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
  method: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, borderRadius: layout.cardRadius, padding: spacing.md, paddingLeft: layout.container, minHeight: 72 },
  methodIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  boneGap: { marginTop: 4 },
  change: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: layout.container, paddingVertical: spacing.md, borderRadius: layout.cardRadius, marginTop: -spacing.md },
  detailsBtn: { minHeight: 32, justifyContent: 'center' },
  linkBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
