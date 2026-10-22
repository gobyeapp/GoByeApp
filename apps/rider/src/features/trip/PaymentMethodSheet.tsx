import { Pressable, StyleSheet, View } from 'react-native';
import { enabledMethods, formatNaira, nairaAccessibilityLabel, type Kobo, type PaymentMethod } from '@gobye/core';
import { Bone, Icon, Sheet, SkeletonGroup, Text, layout, spacing, useTheme } from '@gobye/ui';
import { paymentIcon } from '@/features/booking/components';

/**
 * Change payment method (payment-method reference, contextual sheet over the payment screen).
 * Full-width rows with an icon tile, label, supporting line and a radio indicator. Only supported,
 * approved methods are listed (GoBye Wallet and bank transfer, D-023). Insufficient wallet funds are
 * explained in the row before the passenger confirms. Changing the method never changes the fare.
 */
export function PaymentMethodSheet({
  visible,
  onClose,
  methods,
  selectedId,
  walletAvailable,
  walletLoading,
  walletUnknown,
  amount,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  methods: PaymentMethod[];
  selectedId: string;
  walletAvailable: Kobo;
  walletLoading?: boolean;
  /** The balance failed to load: say so rather than showing ₦0 and a false shortfall. */
  walletUnknown?: boolean;
  amount: Kobo;
  onSelect: (m: PaymentMethod) => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title="Pay with" testID="payment-method-sheet">
      <View accessibilityRole="radiogroup" style={styles.list}>
        {enabledMethods(methods).map((m) => {
          const selected = m.id === selectedId;
          const isWallet = m.type === 'wallet';
          const short = isWallet && !walletLoading && !walletUnknown && walletAvailable < amount;
          const detail = isWallet
            ? walletUnknown
              ? 'Balance unavailable'
              : short
              ? `Balance ${formatNaira(walletAvailable)} · ${formatNaira((amount - walletAvailable) as Kobo)} short`
              : `Balance ${formatNaira(walletAvailable)}`
            : 'To your driver’s bank';
          const spoken = isWallet && walletUnknown ? detail : isWallet ? `Balance ${nairaAccessibilityLabel(walletAvailable)}${short ? ', not enough for this trip' : ''}` : detail;
          return (
            <Pressable
              key={m.id}
              onPress={() => onSelect(m)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${m.label}. ${spoken}`}
              testID={`method-${m.type}`}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? colors.surfaceSelected : colors.surfaceMuted,
                  borderColor: selected ? colors.primary : 'transparent',
                },
              ]}
            >
              <View style={[styles.iconTile, { backgroundColor: colors.card }]}>
                <Icon name={paymentIcon(m)} variant={selected ? 'filled' : 'regular'} size="sm" color="text" />
              </View>
              <View style={styles.text}>
                <Text variant="callout" weight={selected ? 'semibold' : 'medium'}>
                  {m.label}
                </Text>
                {isWallet && walletLoading ? (
                  <SkeletonGroup label="Loading wallet balance">
                    <Bone width={110} height={12} />
                  </SkeletonGroup>
                ) : (
                  <Text variant="footnote" color={short ? 'danger' : 'textSecondary'}>
                    {detail}
                  </Text>
                )}
              </View>
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.textSecondary }]}>
                {selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  text: { flex: 1, minWidth: 0, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 72, paddingHorizontal: layout.container, paddingVertical: spacing.md, borderRadius: layout.cardRadius, borderWidth: 1.5 },
  iconTile: { width: layout.iconBox, height: layout.iconBox, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
