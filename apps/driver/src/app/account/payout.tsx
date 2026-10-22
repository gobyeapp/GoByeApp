import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NIGERIAN_BANKS, validateAccountNumber, validateName } from '@gobye/core';
import { Button, PageHeader, RadioRow, Screen, Sheet, Text, TextField, spacing, useToast } from '@gobye/ui';
import { SimNote } from '@/features/common/SimNote';
import { useDriver } from '@/state/driver';

/**
 * Payout account: where riders send bank transfers and where wallet earnings are withdrawn to.
 * The account name must match the driver's name (checked by the backend with a name lookup; simulated).
 */
export default function Payout() {
  const d = useDriver();
  const toast = useToast();
  const p = d.application.personal;
  const [bank, setBank] = useState(d.payout?.bankName ?? '');
  const [number, setNumber] = useState(d.payout?.accountNumber ?? '');
  const [name, setName] = useState(d.payout?.accountName ?? (p ? `${p.firstName} ${p.lastName}` : ''));
  const [pick, setPick] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const save = () => {
    const n = validateAccountNumber(number);
    const a = validateName(name, 'Account name');
    setErrors({ bank: bank ? undefined : 'Choose your bank.', number: n.ok ? undefined : n.error, name: a.ok ? undefined : a.error });
    if (!bank || !n.ok || !a.ok) return;
    d.setPayout({ bankName: bank, accountNumber: n.value, accountName: a.value });
    toast('Payout account saved', 'success');
    router.back();
  };

  return (
    <Screen header={<PageHeader title="Payout account" onBack={() => router.back()} />} footer={<Button title="Save" onPress={save} testID="payout-save" />}>
      <View style={styles.fields}>
        <Text variant="callout" color="textSecondary">
          Riders who pay by bank transfer send the fare here, and your GoBye Wallet earnings are withdrawn here.
        </Text>
        <TextField label="Bank" value={bank} placeholder="Choose your bank" onPressIn={() => setPick(true)} showSoftInputOnFocus={false} caretHidden error={errors.bank} leadingIcon="bank" testID="payout-bank" />
        <TextField label="Account number" value={number} onChangeText={(t) => setNumber(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder="10 digits" error={errors.number} testID="payout-number" />
        <TextField label="Account name" value={name} onChangeText={setName} helper="Must match the name on your licence." error={errors.name} />
        <SimNote>Account name lookup is simulated in this preview.</SimNote>
      </View>
      <Sheet visible={pick} onClose={() => setPick(false)} title="Choose your bank">
        {NIGERIAN_BANKS.map((b) => (
          <RadioRow
            key={b}
            title={b}
            selected={bank === b}
            onSelect={() => {
              setBank(b);
              setPick(false);
            }}
          />
        ))}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({ fields: { gap: spacing.lg, paddingTop: spacing.sm } });
