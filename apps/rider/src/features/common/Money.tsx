import { formatNaira, nairaAccessibilityLabel, type Kobo } from '@gobye/core';
import { StatusBadge, Text, type StatusKind, type TypographyVariant } from '@gobye/ui';
import { StyleSheet } from 'react-native';

/**
 * Signed amount with direction colour (2026-10-21): money in = green with "+", money out = red with "−".
 * Direction is independent of processing status, so a pending debit stays red and shows a Pending badge.
 * `voided` (failed or reversed: the balance never changed) is grey and struck through.
 */
export function SignedAmount({ amount, voided, variant = 'subhead' }: { amount: Kobo; voided?: boolean; variant?: TypographyVariant }) {
  const credit = amount > 0;
  return (
    <Text
      variant={variant}
      weight="semibold"
      tabular
      numberOfLines={1}
      color={voided ? 'textSecondary' : credit ? 'success' : 'danger'}
      style={voided ? styles.struck : undefined}
      accessibilityLabel={`${credit ? 'Money in' : 'Money out'}, ${nairaAccessibilityLabel(Math.abs(amount) as Kobo)}${voided ? ', no effect on balance' : ''}`}
    >
      {formatNaira(amount, { signed: true })}
    </Text>
  );
}

/** Status shown only when it matters (never for a normal completed transaction): icon + label + tint. */
export function TxStatusBadge({ kind, label }: { kind: StatusKind | null; label: string }) {
  if (!kind) return null;
  return <StatusBadge kind={kind} label={label} />;
}

const styles = StyleSheet.create({ struck: { textDecorationLine: 'line-through' } });
