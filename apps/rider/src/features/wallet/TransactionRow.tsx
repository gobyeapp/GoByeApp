import { Pressable, StyleSheet, View } from 'react-native';
import { SignedAmount, TxStatusBadge } from '@/features/common/Money';
import { kobo, nairaAccessibilityLabel, type WalletTransaction } from '@gobye/core';
import { Icon, Text, layout, spacing, useTheme, type IconName, type StatusKind } from '@gobye/ui';

export const TX_LABEL: Record<WalletTransaction['type'], string> = {
  top_up: 'Deposit',
  ride_payment: 'Trip payment',
  refund: 'Refund',
  reward: 'Referral reward',
  payout: 'Withdrawal',
};

const TX_ICON: Record<WalletTransaction['type'], IconName> = {
  top_up: 'bank',
  ride_payment: 'car',
  refund: 'refresh',
  reward: 'gift',
  payout: 'wallet',
};

export const TX_STATUS: Record<WalletTransaction['status'], { kind: StatusKind; label: string }> = {
  pending: { kind: 'pending', label: 'Pending' },
  successful: { kind: 'successful', label: 'Successful' },
  failed: { kind: 'failed', label: 'Failed' },
  reversed: { kind: 'reversed', label: 'Reversed' },
};

/** Name that tells deposits, trip payments, refunds and reversals apart (brief §11). */
export function txTitle(tx: WalletTransaction): string {
  if (tx.type === 'ride_payment' && tx.status === 'reversed') return 'Trip payment reversed';
  if (tx.type === 'top_up' && tx.status === 'pending') return 'Deposit in progress';
  return TX_LABEL[tx.type];
}

export function txIcon(tx: WalletTransaction): IconName {
  return tx.status === 'reversed' ? 'refresh' : TX_ICON[tx.type];
}

export const txDate = (ms: number) => new Date(ms).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Pending and failed (or reversed) transactions have a detail view with a next action. */
export const hasDetail = (tx: WalletTransaction) => tx.status !== 'successful';

/** Short relative time for list rows ("Just now", "12 mins ago", "Yesterday", "3 Oct"). */
export function relativeTime(ms: number, now = Date.now()): string {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  if (h < 48) return 'Yesterday';
  return new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

/** What happened, in a few words; never repeats the type and description together. */
export function rowTitle(tx: WalletTransaction): string {
  if (tx.status === 'reversed') return 'Payment reversed';
  if (tx.type === 'top_up') return 'Bank transfer';
  if (tx.type === 'ride_payment') return tx.description;
  return TX_LABEL[tx.type];
}

/**
 * One wallet transaction (refined): small neutral icon, what happened and when on the left; amount and,
 * only when it matters, a status on the right. Completed transactions show no status label. Failed and
 * reversed amounts are struck through because they never changed the balance. Long titles wrap before
 * the amount column, which keeps its own width (brief §17).
 */
export function TransactionRow({ tx, onPress }: { tx: WalletTransaction; onPress?: () => void }) {
  const { colors } = useTheme();
  const status = TX_STATUS[tx.status];
  const showStatus = tx.status !== 'successful';
  const noEffect = tx.status === 'failed' || tx.status === 'reversed';
  const credit = tx.amount > 0;
  const tappable = !!onPress && hasDetail(tx);
  const spoken = `${rowTitle(tx)}, ${txDate(tx.createdAt)}, ${credit ? 'plus' : 'minus'} ${nairaAccessibilityLabel(kobo(Math.abs(tx.amount)))}${showStatus ? `, ${status.label}` : ''}`;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && tappable && { backgroundColor: colors.surfaceMuted }]}
      accessible
      accessibilityLabel={spoken}
      accessibilityRole={tappable ? 'button' : undefined}
      accessibilityHint={tappable ? 'Shows details and what to do next' : undefined}
      disabled={!tappable}
      onPress={onPress}
      testID={`tx-${tx.id}`}
    >
      <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
        <Icon name={txIcon(tx)} size={16} color="text" />
      </View>
      <View style={styles.texts}>
        <Text variant="subhead" weight="medium" numberOfLines={2}>
          {rowTitle(tx)}
        </Text>
        <Text variant="caption" color="textSecondary">
          {relativeTime(tx.createdAt)}
        </Text>
      </View>
      <View style={styles.right}>
        <SignedAmount amount={tx.amount} voided={noEffect} />
        <TxStatusBadge kind={tx.status === 'successful' ? null : status.kind} label={status.label} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: layout.controlRadius },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, minWidth: 0, gap: 3 },
  right: { alignItems: 'flex-end', gap: 3, flexShrink: 0, maxWidth: '48%' },
});
