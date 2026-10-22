import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatNaira, kobo, naira, type DepositInstructions, type Kobo, type WalletTransaction } from '@gobye/core';
import { Button, Divider, Icon, Sheet, SimulatedBadge, StatusBadge, Text, TextField, layout, radii, spacing, useTheme } from '@gobye/ui';
import { CopyRow } from '@/features/common/CopyRow';
import { useHaptics } from '@/state/haptics';
import { DEPOSIT_OPTIONS, useWallet } from '@/state/wallet';
import { TX_STATUS } from './TransactionRow';

const MAX_DEPOSIT = naira(500_000);

type Step = 'amount' | 'instructions';

/**
 * "Add money" (brief §10). Explains the action in a sheet like the bank reference, but only asks the
 * passenger to make a bank transfer — GoBye never requests bank history, income or loan data.
 * The credit stays Pending until the provider confirms it; "I've sent it" only checks status.
 */
export function DepositSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const haptic = useHaptics();
  const wallet = useWallet();
  const [step, setStep] = useState<Step>('amount');
  const [selected, setSelected] = useState<Kobo | null>(DEPOSIT_OPTIONS[1]);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [instructions, setInstructions] = useState<DepositInstructions | null>(null);
  const [status, setStatus] = useState<WalletTransaction['status']>('pending');
  const [checking, setChecking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  useEffect(() => {
    if (!visible) {
      setStep('amount');
      setInstructions(null);
      setStatus('pending');
      setError(undefined);
      setCustom('');
      setSelected(DEPOSIT_OPTIONS[1]);
      setConfirmDiscard(false);
    }
  }, [visible]);

  const amount: Kobo | null = custom ? kobo(Number(custom) * 100) : selected;

  const start = async () => {
    if (!amount || amount <= 0) return setError('Enter an amount greater than ₦0.');
    if (amount > MAX_DEPOSIT) return setError(`The most you can add at once is ${formatNaira(MAX_DEPOSIT)}.`);
    setError(undefined);
    setBusy(true);
    try {
      const ins = await wallet.startDeposit(amount);
      setInstructions(ins);
      setStep('instructions');
    } catch {
      setError('Couldn’t start the deposit. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!instructions || checking) return;
    setChecking(true);
    try {
      const s = await wallet.checkDeposit(instructions.transactionId);
      setStatus(s);
      haptic(s === 'successful' ? 'success' : s === 'failed' ? 'error' : 'selection');
    } finally {
      setChecking(false);
    }
  };

  // Closing with a typed amount asks first, so a half-entered amount isn't lost by accident (brief §16).
  const requestClose = () => {
    if (step === 'amount' && custom && !confirmDiscard) return setConfirmDiscard(true);
    onClose();
  };

  if (step === 'amount') {
    return (
      <Sheet
        visible={visible}
        onClose={requestClose}
        title="Add money"
        subtitle="By bank transfer from your bank."
        hero={<HeroTile icon="wallet" />}
        footer={
          confirmDiscard ? (
            <View style={[styles.confirm, { backgroundColor: colors.surfaceMuted }]} accessibilityLiveRegion="polite">
              <Text variant="subhead" weight="semibold">
                Discard this amount?
              </Text>
              <View style={styles.confirmRow}>
                <Button title="Keep editing" variant="secondary" size="md" style={styles.flex} onPress={() => setConfirmDiscard(false)} />
                <Button title="Discard" variant="destructive" size="md" style={styles.flex} onPress={onClose} testID="deposit-discard" />
              </View>
            </View>
          ) : (
            <Button title="Continue" accessibilityLabel={amount ? `Continue with ${formatNaira(amount)}` : 'Continue'} onPress={start} loading={busy} disabled={!amount} testID="deposit-continue" />
          )
        }
      >
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Amount">
          {DEPOSIT_OPTIONS.map((opt) => {
            const on = !custom && selected === opt;
            return (
              <Pressable
                key={opt}
                onPress={() => {
                  setSelected(opt);
                  setCustom('');
                  setError(undefined);
                  haptic('selection');
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={formatNaira(opt)}
                style={[styles.chip, { backgroundColor: on ? colors.surfaceSelected : colors.surfaceMuted, borderColor: on ? colors.primary : 'transparent' }]}
              >
                <Text variant="subhead" weight="semibold" tabular>
                  {formatNaira(opt)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          label="Or enter an amount"
          prefix="₦"
          keyboardType="number-pad"
          value={custom}
          onChangeText={(t) => {
            setCustom(t.replace(/[^\d]/g, '').slice(0, 7));
            setError(undefined);
          }}
          error={error}
          helper={`Up to ${formatNaira(MAX_DEPOSIT)}`}
          testID="deposit-amount"
        />
        {/* Optional explanation, collapsed by default. */}
        <View style={[styles.group, { backgroundColor: colors.surfaceMuted }]}>
          <Pressable
            onPress={() => setHowOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: howOpen }}
            style={styles.howToggle}
            testID="deposit-how"
          >
            <Icon name="info" size="sm" color="textSecondary" />
            <Text variant="footnote" weight="semibold" color="textSecondary" style={styles.flex}>
              How it works
            </Text>
            <Icon name={howOpen ? 'chevronUp' : 'chevronDown'} size="sm" color="textSecondary" />
          </Pressable>
          {howOpen ? (
            <>
              <View style={[styles.groupDivider, { backgroundColor: colors.border }]} />
              <View style={styles.groupBody}>
                <Explain icon="check" text="Transfer to the account we show you." />
                <Explain icon="check" text="Your balance updates once it’s confirmed." />
                <Explain icon="check" text="We never see your bank history." />
              </View>
            </>
          ) : null}
        </View>
      </Sheet>
    );
  }

  const st = TX_STATUS[status];
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Transfer details"
      subtitle="Send the exact amount from your banking app."
      hero={<HeroTile icon="bank" />}
      footer={
        status === 'successful' ? (
          <Button title="Done" onPress={onClose} />
        ) : (
          <>
            <Button title={status === 'failed' ? 'Check again' : 'I’ve sent it'} onPress={check} loading={checking} disabled={checking} testID="deposit-check" />
            <Button title="Later" variant="tertiary" onPress={onClose} />
          </>
        )
      }
    >
      {instructions ? (
        <>
          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            <StatusBadge kind={st.kind} label={status === 'pending' ? 'Awaiting confirmation' : status === 'successful' ? 'Added to your wallet' : st.label} />
            {instructions.isSimulated ? <SimulatedBadge /> : null}
          </View>
          <View style={[styles.group, { backgroundColor: colors.surfaceMuted }]}>
            <Text variant="footnote" weight="semibold" color="textSecondary" style={styles.groupTitle}>
              Send to
            </Text>
            <View style={[styles.groupDivider, { backgroundColor: colors.border }]} />
            <View style={styles.groupBody}>
              <View style={styles.kv}>
                <Text variant="callout" color="textSecondary">Bank</Text>
                <Text variant="callout" weight="semibold" style={styles.kvValue}>{instructions.bankName}</Text>
              </View>
              <View style={styles.kv}>
                <Text variant="callout" color="textSecondary">Account name</Text>
                <Text variant="callout" weight="semibold" style={styles.kvValue}>{instructions.accountName}</Text>
              </View>
              <Divider />
              <CopyRow label="Account number" value={instructions.accountNumber} testID="copy-account" />
              <CopyRow label="Exact amount" value={formatNaira(instructions.amount)} copyValue={String(Math.round(instructions.amount / 100))} />
              <CopyRow label="Reference" value={instructions.reference} />
            </View>
          </View>
          <Text variant="footnote" color="textSecondary">
            Details expire at{' '}
            {new Date(instructions.expiresAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}.
          </Text>
          {status === 'failed' ? (
            <Text variant="footnote" color="danger">
              We couldn’t confirm this transfer. Don’t send it again. If money left your account, contact Support.
            </Text>
          ) : (
            <Text variant="footnote" color="textSecondary">
              We add it to your wallet once the transfer is confirmed.
            </Text>
          )}
        </>
      ) : null}
    </Sheet>
  );
}

function HeroTile({ icon }: { icon: 'wallet' | 'bank' }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.hero, { backgroundColor: colors.brandBanner }]}>
      <Icon name={icon} variant="filled" size="lg" color={colors.onBrandBanner} />
    </View>
  );
}

function Explain({ icon, text }: { icon: 'check'; text: string }) {
  return (
    <View style={styles.explainRow}>
      <Icon name={icon} size="sm" color="text" />
      <Text variant="footnote" color="textSecondary" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radii.pill, justifyContent: 'center', borderWidth: 1.5 },
  explainRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  confirm: { borderRadius: layout.controlRadius, padding: layout.container, gap: spacing.xs },
  confirmRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  statusRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' },
  hero: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  group: { borderRadius: layout.cardRadius, overflow: 'hidden' },
  groupTitle: { paddingHorizontal: layout.container, paddingVertical: spacing.md },
  howToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: layout.container },
  groupDivider: { height: StyleSheet.hairlineWidth },
  groupBody: { paddingHorizontal: layout.container, paddingVertical: spacing.sm, gap: spacing.sm },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, minHeight: 32 },
  kvValue: { flexShrink: 1, textAlign: 'right' },
});
