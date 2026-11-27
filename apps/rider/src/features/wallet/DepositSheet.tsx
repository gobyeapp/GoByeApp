import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatNaira, kobo, naira, type DepositInstructions, type DepositMethod, type Kobo, type WalletTransaction } from '@gobye/core';
import { Button, Divider, Icon, Sheet, SimulatedBadge, StatusBadge, Text, TextField, layout, spacing, useTheme } from '@gobye/ui';
import { CopyRow } from '@/features/common/CopyRow';
import { useHaptics } from '@/state/haptics';
import { DEPOSIT_OPTIONS, useWallet } from '@/state/wallet';
import { TX_STATUS } from './TransactionRow';

const MAX_DEPOSIT = naira(500_000);

type Step = 'amount' | 'instructions' | 'card';

const METHODS: { id: DepositMethod; icon: 'card' | 'bank'; title: string; hint: string }[] = [
  { id: 'card', icon: 'card', title: 'Card', hint: 'Instant · Visa, Mastercard or Verve' },
  { id: 'bank_transfer', icon: 'bank', title: 'Bank transfer', hint: 'From your bank app · a few minutes' },
];

/**
 * "Add money" (brief §10, D-093): choose an amount, then how to pay.
 * - Card: paid on the payment provider's own secure page. GoBye never sees or stores a card number.
 * - Bank transfer: the account to send to; the credit stays Pending until the provider confirms it, and
 *   "I've sent it" only checks status.
 * GoBye never requests bank history, income or loan data.
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
  const [method, setMethod] = useState<DepositMethod>('card');
  const [cardError, setCardError] = useState<string | undefined>();

  useEffect(() => {
    if (!visible) {
      setStep('amount');
      setInstructions(null);
      setStatus('pending');
      setError(undefined);
      setCustom('');
      setSelected(DEPOSIT_OPTIONS[1]);
      setConfirmDiscard(false);
      setMethod('card');
      setCardError(undefined);
      setBusy(false);
    }
  }, [visible]);

  const amount: Kobo | null = custom ? kobo(Number(custom) * 100) : selected;

  const start = async () => {
    if (!amount || amount <= 0) return setError('Enter an amount greater than ₦0.');
    if (amount > MAX_DEPOSIT) return setError(`The most you can add at once is ${formatNaira(MAX_DEPOSIT)}.`);
    setError(undefined);
    if (method === 'card') return setStep('card');
    setBusy(true);
    try {
      const ins = await wallet.startDeposit(amount, 'bank_transfer');
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

  // Card: start the payment, then ask the provider until it answers (a few seconds at most).
  const payByCard = async () => {
    if (!amount || busy) return;
    setCardError(undefined);
    setBusy(true);
    try {
      const ins = await wallet.startDeposit(amount, 'card');
      setInstructions(ins);
      let s: WalletTransaction['status'] = 'pending';
      for (let i = 0; i < 8 && s === 'pending'; i++) {
        await new Promise((res) => setTimeout(res, 700));
        s = await wallet.checkDeposit(ins.transactionId);
      }
      if (s === 'successful') {
        haptic('success');
        setStatus('successful');
      } else {
        haptic('error');
        setCardError(s === 'failed' ? 'The payment didn’t go through. You weren’t charged. Try again or use bank transfer.' : 'This is taking longer than usual. Check your wallet in a moment before trying again.');
      }
    } catch {
      setCardError('Couldn’t start the payment. Check your connection and try again.');
    } finally {
      setBusy(false);
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
        subtitle="Choose an amount and how to pay."
        headerAlign="leading"
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
            <Button title="Continue" trailingText={amount ? formatNaira(amount) : undefined} onPress={start} loading={busy} disabled={!amount} testID="deposit-continue" />
          )
        }
      >
        <Text variant="caption" color="textSecondary" style={styles.label}>
          AMOUNT
        </Text>
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
                style={[styles.chip, { backgroundColor: on ? colors.primary : colors.card, borderColor: on ? colors.primary : colors.borderStrong }]}
              >
                <Text variant="headline" tabular color={on ? 'onPrimary' : 'text'}>
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
        <Text variant="caption" color="textSecondary" style={styles.label}>
          PAY WITH
        </Text>
        <View style={styles.methods} accessibilityRole="radiogroup" accessibilityLabel="Pay with">
          {METHODS.map((m) => {
            const on = method === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => {
                  setMethod(m.id);
                  haptic('selection');
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${m.title}. ${m.hint}`}
                style={[styles.method, { backgroundColor: colors.card, borderColor: on ? colors.primary : colors.borderStrong, borderWidth: on ? 1.5 : 1 }]}
                testID={`deposit-method-${m.id}`}
              >
                <View style={[styles.methodIcon, { backgroundColor: colors.surfaceSelected }]}>
                  <Icon name={m.icon} size="sm" color="text" />
                </View>
                <View style={styles.flex}>
                  <Text variant="headline">{m.title}</Text>
                  <Text variant="footnote" color="textSecondary">
                    {m.hint}
                  </Text>
                </View>
                <View style={[styles.radio, { borderColor: on ? colors.primary : colors.borderStrong }]}>{on ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}</View>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    );
  }

  const st = TX_STATUS[status];
  // Done (D-084): the money is in, so the sheet says so. No transfer instructions, no Copy buttons.
  if (status === 'successful' && instructions) {
    return (
      <Sheet visible={visible} onClose={onClose} title="Money added" subtitle={`${formatNaira(instructions.amount)} is in your wallet.`} hero={<HeroTile icon="check" />} footer={<Button title="Done" onPress={onClose} testID="deposit-done" />}>
        <View style={[styles.group, { backgroundColor: colors.surfaceMuted }]} accessibilityLiveRegion="polite">
          <View style={styles.groupBody}>
            <CopyRow copy={false} label="Amount" value={formatNaira(instructions.amount)} />
            <CopyRow copy={false} label="Paid with" value={method === 'card' ? 'Card' : 'Bank transfer'} />
            <CopyRow copy={false} label="Reference" value={instructions.reference} />
          </View>
        </View>
        {instructions.isSimulated ? (
          <View style={styles.statusRow}>
            <SimulatedBadge />
          </View>
        ) : null}
      </Sheet>
    );
  }
  if (step === 'card') {
    return (
      <Sheet
        visible={visible}
        onClose={onClose}
        title="Pay by card"
        subtitle={amount ? `${formatNaira(amount)} to your GoBye wallet.` : undefined}
        headerAlign="leading"
        footer={
          <>
            <Button title={amount ? `Pay ${formatNaira(amount)}` : 'Pay'} leadingIcon="lock" onPress={payByCard} loading={busy} loadingLabel="Confirming payment" disabled={busy} testID="deposit-pay-card" />
            <Button title="Back" variant="tertiary" onPress={() => setStep('amount')} disabled={busy} />
          </>
        }
      >
        <View style={[styles.group, { backgroundColor: colors.surfaceMuted }]}>
          <View style={styles.groupBody}>
            <Explain icon="lock" text="You enter your card on our payment partner’s secure page." />
            <Explain icon="check" text="GoBye never sees or stores your card number." />
            <Explain icon="check" text="Your wallet is topped up as soon as the payment is confirmed." />
          </View>
        </View>
        <View style={styles.statusRow}>
          <SimulatedBadge />
          <Text variant="footnote" color="textSecondary" style={styles.flex}>
            Test build: no card is asked for or charged.
          </Text>
        </View>
        {cardError ? (
          <Text variant="footnote" color="danger" accessibilityLiveRegion="polite" testID="deposit-card-error">
            {cardError}
          </Text>
        ) : null}
      </Sheet>
    );
  }
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Transfer details"
      subtitle="Send the exact amount from your banking app."
      headerAlign="leading"
      footer={
        <>
          <Button title={status === 'failed' ? 'Check again' : 'I’ve sent it'} onPress={check} loading={checking} disabled={checking} testID="deposit-check" />
          <Button title="Later" variant="tertiary" onPress={onClose} />
        </>
      }
    >
      {instructions ? (
        <>
          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            <StatusBadge kind={st.kind} label={status === 'pending' ? 'Awaiting confirmation' : st.label} />
            {instructions.isSimulated ? <SimulatedBadge /> : null}
          </View>
          <View style={[styles.group, { backgroundColor: colors.surfaceMuted }]}>
            {/* What to copy comes first; every row has the same shape (label over value). */}
            <View style={styles.groupBody}>
              <CopyRow label="Account number" value={instructions.accountNumber} testID="copy-account" />
              <CopyRow label="Exact amount" value={formatNaira(instructions.amount)} copyValue={String(Math.round(instructions.amount / 100))} />
              <CopyRow label="Reference" value={instructions.reference} />
              <Divider />
              <CopyRow copy={false} label="Bank" value={instructions.bankName} />
              <CopyRow copy={false} label="Account name" value={instructions.accountName} />
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

function HeroTile({ icon }: { icon: 'wallet' | 'bank' | 'check' }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.hero, { backgroundColor: colors.brandBanner }]}>
      <Icon name={icon} variant="filled" size="lg" color={colors.onBrandBanner} />
    </View>
  );
}

function Explain({ icon, text }: { icon: 'check' | 'lock'; text: string }) {
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
  label: { letterSpacing: 0.8, marginBottom: -spacing.xs },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, height: 48, borderRadius: layout.controlRadius, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  methods: { gap: spacing.sm },
  method: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingHorizontal: layout.container, borderRadius: layout.cardRadius },
  methodIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  explainRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  confirm: { borderRadius: layout.controlRadius, padding: layout.container, gap: spacing.xs },
  confirmRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  statusRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' },
  hero: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  group: { borderRadius: layout.cardRadius, overflow: 'hidden' },
  howToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: layout.container },
  groupDivider: { height: StyleSheet.hairlineWidth },
  groupBody: { paddingHorizontal: layout.container, paddingVertical: spacing.sm, gap: spacing.sm },
});
