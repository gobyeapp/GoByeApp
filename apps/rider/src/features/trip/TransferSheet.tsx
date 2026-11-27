import { StyleSheet, View } from 'react-native';
import { formatNaira, nairaAccessibilityLabel, type DriverPayoutAccount, type Kobo } from '@gobye/core';
import { Button, Icon, Sheet, Text, layout, spacing, useTheme } from '@gobye/ui';
import { CopyRow } from '@/features/common/CopyRow';

/**
 * Bank transfer details (2026-10-21 end-of-trip brief). Only what the bank app needs: bank, account
 * name, account number (Copy beside it), exact amount and reference (each copyable). No repeated
 * driver card, no repeated price, no long instructions. "I’ve transferred" only starts a check: the
 * payment stays pending until the transfer is received, never "Paid" on a tap.
 */
export function TransferSheet({
  visible,
  onClose,
  payout,
  amount,
  reference,
  checking,
  onSent,
  onUseWallet,
}: {
  visible: boolean;
  onClose: () => void;
  payout?: DriverPayoutAccount;
  amount: Kobo;
  reference: string;
  checking: boolean;
  onSent: () => void;
  onUseWallet: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Bank transfer"
      testID="transfer-sheet"
      footer={
        payout ? (
          <>
            <Button
              title="I’ve sent the money"
              onPress={onSent}
              loading={checking}
              loadingLabel="Checking transfer"
              disabled={checking}
              accessibilityHint="Starts a check for your transfer. Payment stays pending until it arrives."
              testID="confirm-transfer"
            />
            <Text variant="footnote" color="textSecondary" align="center">
              Pending until we receive it. Send once only.
            </Text>
          </>
        ) : (
          <Button title="Use GoBye Wallet" variant="secondary" onPress={onUseWallet} />
        )
      }
    >
      {payout ? (
        <View style={[styles.group, { backgroundColor: colors.surfaceMuted }]}>
          <CopyRow label="Account number" value={payout.accountNumber} testID="copy-account" />
          <CopyRow label="Amount" value={formatNaira(amount)} copyValue={amount % 100 === 0 ? String(amount / 100) : (amount / 100).toFixed(2)} spoken={nairaAccessibilityLabel(amount)} testID="copy-amount" />
          <CopyRow label="Reference" value={reference} testID="copy-reference" />
          <View style={[styles.rule, { backgroundColor: colors.border }]} />
          <CopyRow copy={false} label="Bank" value={payout.bankName} />
          <CopyRow copy={false} label="Account name" value={payout.accountName} />
        </View>
      ) : (
        <View style={[styles.notice, { backgroundColor: colors.dangerSurface }]} accessible accessibilityLiveRegion="polite">
          <Icon name="warning" variant="filled" size="sm" color="danger" />
          <Text variant="callout" style={styles.flex}>
            This driver can’t receive transfers. Use your wallet.
          </Text>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { borderRadius: layout.cardRadius, paddingHorizontal: layout.container, paddingVertical: spacing.sm, gap: spacing.xxs },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: layout.container, borderRadius: layout.cardRadius },
});
