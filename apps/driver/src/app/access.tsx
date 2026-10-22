import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { DRIVER_ACCESS_PACKAGES, formatNaira, nairaAccessibilityLabel, type DriverAccessPackage } from '@gobye/core';
import { Badge, Button, Icon, RadioRow, Screen, ScreenHeader, Text, layout, spacing, useTheme, useToast } from '@gobye/ui';
import { formatRemaining, passName } from '@/features/common/format';
import { SimNote } from '@/features/common/SimNote';
import { useDriver } from '@/state/driver';
import { useHaptics } from '@/state/settings';
import { useNow } from '@/state/useNow';

/**
 * Access pass (F-D12, D-024): drivers pay a flat daily or monthly fee instead of a per-trip commission.
 * Buying while a pass is active extends it from the current expiry. Prices are provisional.
 */
export default function Access() {
  const { colors } = useTheme();
  const d = useDriver();
  const toast = useToast();
  const haptic = useHaptics();
  const now = useNow(30_000);
  const [selected, setSelected] = useState<DriverAccessPackage['id']>('daily');
  const [busy, setBusy] = useState(false);
  const pkg = DRIVER_ACCESS_PACKAGES.find((p) => p.id === selected)!;

  const buy = async () => {
    setBusy(true);
    const r = await d.buyPackage(pkg);
    setBusy(false);
    if (!r.ok) return Alert.alert('Payment didn’t go through', r.error);
    haptic('success');
    toast(`${pkg.name} active until ${new Date(r.value.expiresAt).toLocaleString('en-NG', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, 'success');
    router.back();
  };

  return (
    <Screen
      header={<ScreenHeader backIcon="close" title="Access pass" onBack={() => router.back()} />}
      footer={
        <Button
          title={`Pay ${formatNaira(pkg.price)}`}
          accessibilityLabel={`Pay ${nairaAccessibilityLabel(pkg.price)} for ${pkg.name}`}
          loading={busy}
          loadingLabel="Paying"
          onPress={buy}
          testID="buy-pass"
        />
      }
    >
      <View style={[styles.hero, { backgroundColor: colors.surfaceMuted }]}>
        <Text variant="largeTitle" tabular>
          0%
        </Text>
        <Text variant="callout" color="textSecondary" align="center">
          commission on every trip. Pay a flat fee for access and keep the whole fare.
        </Text>
      </View>

      {d.subscription && d.hasAccess ? (
        <View style={[styles.current, { borderColor: colors.border }]}>
          <Icon name="checkCircle" variant="filled" size="sm" color="success" />
          <Text variant="subhead" style={styles.flex}>
            {passName(d.subscription)} · {formatRemaining(d.subscription.expiresAt - now)} left. A new pass starts when this one ends.
          </Text>
        </View>
      ) : null}

      <View style={styles.options} accessibilityRole="radiogroup">
        {DRIVER_ACCESS_PACKAGES.map((p) => (
          <RadioRow
            key={p.id}
            title={p.name}
            subtitle={p.id === 'daily' ? '24 hours from when it starts' : '30 days · about ₦2,000 a day'}
            selected={selected === p.id}
            onSelect={() => setSelected(p.id)}
            trailing={
              <View style={styles.price}>
                <Text variant="headline" tabular>
                  {formatNaira(p.price)}
                </Text>
                {p.id === 'monthly' ? <Badge label="Best value" tone="brand" /> : null}
              </View>
            }
            testID={`pkg-${p.id}`}
          />
        ))}
      </View>

      <Text variant="footnote" color="textSecondary">
        Prices are provisional while GoBye prepares to launch. Riders pay you directly by bank transfer or through the GoBye Wallet.
      </Text>
      <View style={styles.sim}>
        <SimNote>No money moves in this preview.</SimNote>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { alignItems: 'center', gap: spacing.xs, padding: spacing.xl, borderRadius: layout.cardRadius, marginTop: spacing.sm },
  current: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: layout.controlRadius, borderWidth: 1, marginTop: spacing.lg },
  options: { gap: spacing.sm, marginVertical: spacing.lg },
  price: { alignItems: 'flex-end', gap: spacing.xs },
  sim: { marginTop: spacing.md },
});
