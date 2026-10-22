import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatNaira, nairaAccessibilityLabel, type WalletTransaction } from '@gobye/core';
import { Button, KeyValue, Sheet, StatusBadge, Text, layout, spacing, useTheme, useToast } from '@gobye/ui';
import { useAccount } from '@/state/account';
import { useHaptics } from '@/state/haptics';
import { useWallet } from '@/state/wallet';
import { TX_STATUS, txDate, txTitle } from './TransactionRow';

/**
 * Detail for a pending, failed or reversed wallet transaction, with the useful next action (brief §11):
 * a pending deposit can be checked, a failed deposit restarted (never re-sent), a failed or reversed
 * trip payment explained with a link to the trip.
 */
export function TransactionDetailSheet({ tx, onClose, onNewDeposit }: { tx: WalletTransaction | null; onClose: () => void; onNewDeposit: () => void }) {
  const { colors } = useTheme();
  const wallet = useWallet();
  const toast = useToast();
  const haptic = useHaptics();
  const { history } = useAccount();
  const [current, setCurrent] = useState<WalletTransaction | null>(tx);
  const [checking, setChecking] = useState(false);

  useEffect(() => setCurrent(tx), [tx]);
  // Follow the ledger, so a confirmed deposit updates in place.
  useEffect(() => {
    if (!current) return;
    const fresh = wallet.transactions.find((t) => t.id === current.id);
    if (fresh && fresh.status !== current.status) setCurrent(fresh);
  }, [wallet.transactions, current]);

  const t = current;
  const status = t ? TX_STATUS[t.status] : null;
  const trip = t?.bookingId ? history.find((h) => h.bookingId === t.bookingId) : undefined;

  const check = async () => {
    if (!t || checking) return;
    setChecking(true);
    try {
      const s = await wallet.checkDeposit(t.id);
      haptic(s === 'successful' ? 'success' : s === 'failed' ? 'error' : 'selection');
      if (s === 'pending') toast('Not received yet. Transfers can take a few minutes.', 'info');
    } catch {
      toast('Couldn’t check right now. Try again.', 'error');
    } finally {
      setChecking(false);
    }
  };

  const explanation = !t
    ? ''
    : t.type === 'top_up'
      ? t.status === 'pending'
        ? 'Waiting to confirm your transfer. Your balance updates once it’s confirmed.'
        : t.status === 'failed'
          ? 'Nothing was added. Don’t send it again. If money left your account, contact Support with the reference.'
          : t.status === 'successful'
            ? 'Added to your balance.'
            : 'Reversed and returned to the sender.'
      : t.type === 'ride_payment'
        ? t.status === 'reversed'
          ? 'Returned to your wallet. If the trip is still unpaid, you’ll pay again.'
          : t.status === 'failed'
            ? 'Didn’t go through. You weren’t charged.'
            : t.status === 'pending'
              ? 'Reserved while the payment is processed.'
              : 'Paid from your wallet.'
        : t.status === 'pending'
          ? 'Processing.'
          : 'Your balance didn’t change.';

  const footer = !t ? null : t.type === 'top_up' && t.status === 'pending' ? (
    <Button title="Check status" onPress={check} loading={checking} disabled={checking} testID="tx-check" />
  ) : t.type === 'top_up' && t.status === 'failed' ? (
    <>
      <Button
        title="New deposit"
        onPress={() => {
          onClose();
          onNewDeposit();
        }}
      />
      <Button title="Contact support" variant="tertiary" onPress={() => (onClose(), router.push('/account/support'))} />
    </>
  ) : trip ? (
    <>
      <Button title="View trip" variant="secondary" onPress={() => (onClose(), router.push(`/ride/${trip.bookingId}`))} />
      <Button title="Close" variant="tertiary" onPress={onClose} />
    </>
  ) : (
    <Button title="Close" variant="secondary" onPress={onClose} />
  );

  return (
    <Sheet visible={!!t} onClose={onClose} title={t ? txTitle(t) : ''} subtitle={t ? txDate(t.createdAt) : undefined} footer={footer} testID="tx-detail">
      {t && status ? (
        <>
          <View style={styles.amount} accessible accessibilityLabel={`${t.amount > 0 ? 'Plus' : 'Minus'} ${nairaAccessibilityLabel(Math.abs(t.amount) as typeof t.amount)}. Status: ${status.label}`}>
            <Text variant="largeTitle" tabular>
              {formatNaira(t.amount, { signed: true })}
            </Text>
            <StatusBadge kind={status.kind} label={status.label} />
          </View>
          <Text variant="callout">{explanation}</Text>
          <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <KeyValue label="Details" value={t.description} />
            <KeyValue label="Reference" value={t.id.toUpperCase()} />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  amount: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: layout.cardRadius, padding: layout.container, gap: spacing.sm },
});
