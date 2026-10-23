import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { DRIVER_ACCESS_PACKAGES, formatNaira, nairaAccessibilityLabel, type DriverAccessPackage, type SubscriptionPassView } from '@gobye/core';
import { Badge, Button, Icon, RadioRow, Screen, ScreenHeader, Text, layout, spacing, useTheme, useToast } from '@gobye/ui';
import { formatDay, formatRemaining, formatTime, passName } from '@/features/common/format';
import { SimNote } from '@/features/common/SimNote';
import { useDriver } from '@/state/driver';
import { useHaptics } from '@/state/settings';
import { useNow } from '@/state/useNow';

/**
 * Access pass (F-D12, D-024): drivers pay a flat daily or monthly fee instead of a per-trip commission.
 * One pass timeline (D-058), the same response the admin shows: a pass bought while another is active or queued
 * starts when the last queued pass ends, so no paid time is lost. Prices confirmed 2026-10-23: daily ₦2,000 / 24 hours, monthly ₦60,000 / 30 days.
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
    toast(r.value.status === 'scheduled' ? `${pkg.name} queued: starts ${at(r.value.startsAt)}, ends ${at(r.value.endsAt)}` : `${pkg.name} active until ${at(r.value.endsAt)}`, 'success');
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
            {passName(d.subscription)} now · access for {formatRemaining(d.subscription.expiresAt - now)}
            {d.timeline.summary.scheduled ? ` including ${d.timeline.summary.scheduled} queued ${d.timeline.summary.scheduled === 1 ? 'pass' : 'passes'}` : ''}. A pass you buy now starts when your last one ends.
          </Text>
        </View>
      ) : null}

      {d.timeline.passes.length ? (
        <View style={styles.list} accessibilityLabel="Your passes">
          <Text variant="footnote" color="textSecondary">Your passes</Text>
          {d.timeline.passes.slice(0, 6).map((p) => (
            <View key={p.id} style={[styles.passRow, { borderColor: colors.border }]} accessible accessibilityLabel={`${PLAN[p.plan]}, ${STATUS[p.status]}, ${span(p)}`}>
              <View style={styles.flex}>
                <Text variant="subhead">{PLAN[p.plan]}</Text>
                <Text variant="footnote" color="textSecondary">{span(p)}</Text>
              </View>
              <Badge label={STATUS[p.status]} tone={p.status === 'active' ? 'success' : p.status === 'scheduled' ? 'brand' : 'neutral'} />
            </View>
          ))}
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
        Daily gives you exactly 24 hours and monthly exactly 30 days, starting when your payment is confirmed or, if you already have time left, when your last pass ends. GoBye takes 0% of your fares. Riders pay you directly by bank transfer or through the GoBye Wallet.
      </Text>
      <View style={styles.sim}>
        <SimNote>No money moves in this preview.</SimNote>
      </View>
    </Screen>
  );
}

const PLAN = { daily: 'Daily pass', monthly: 'Monthly pass' } as const;
const STATUS = { active: 'Active', scheduled: 'Queued', expired: 'Ended', cancelled: 'Cancelled', refunded: 'Refunded', reversed: 'Reversed' } as const;
const at = (t: number) => `${formatDay(t)} ${formatTime(t)}`;
const span = (p: SubscriptionPassView) => (p.accessEndsAt <= p.startsAt ? `Was to start ${at(p.startsAt)} · no access given` : `${at(p.startsAt)} to ${at(p.accessEndsAt)}`);

const styles = StyleSheet.create({
  list: { gap: spacing.sm, marginTop: spacing.lg },
  passRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: layout.controlRadius, borderWidth: 1 },
  flex: { flex: 1 },
  hero: { alignItems: 'center', gap: spacing.xs, padding: spacing.xl, borderRadius: layout.cardRadius, marginTop: spacing.sm },
  current: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: layout.controlRadius, borderWidth: 1, marginTop: spacing.lg },
  options: { gap: spacing.sm, marginVertical: spacing.lg },
  price: { alignItems: 'flex-end', gap: spacing.xs },
  sim: { marginTop: spacing.md },
});
