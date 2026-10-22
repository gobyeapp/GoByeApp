import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { earningsToday, formatNaira, nairaAccessibilityLabel, startOfWeek, summariseEarnings, weeklyBreakdown } from '@gobye/core';
import { SegmentedControl, SettingsGroup, SettingsRow, Text, layout, spacing, useTheme } from '@gobye/ui';
import { formatRemaining, passName } from '@/features/common/format';
import { SimNote } from '@/features/common/SimNote';
import { useDriver } from '@/state/driver';
import { useNow } from '@/state/useNow';

type Period = 'today' | 'week';

/**
 * D15 Earnings. Riders pay drivers directly (bank transfer) or through the GoBye Wallet; GoBye takes 0%
 * per trip, so these totals are the full fares. The only platform cost is the access pass.
 */
export default function Earnings() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow(60_000);
  const d = useDriver();
  const [period, setPeriod] = useState<Period>('week');
  const summary = period === 'today' ? earningsToday(d.history, now) : summariseEarnings(d.history, startOfWeek(now));
  const week = weeklyBreakdown(d.history, now);
  const max = Math.max(1, ...week.map((w) => w.total));
  const todayIndex = (new Date(now).getDay() + 6) % 7;
  const hours = summary.trips ? Math.max(1, Math.round((summary.trips * 28) / 60)) : 0;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}>
      <Text variant="title2" accessibilityRole="header" style={styles.title}>
        Earnings
      </Text>
      <SegmentedControl
        segments={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
        ]}
        value={period}
        onChange={setPeriod}
        accessibilityLabel="Earnings period"
      />

      <View style={styles.total} accessible accessibilityLabel={`${period === 'today' ? 'Today' : 'This week'}, ${nairaAccessibilityLabel(summary.total)} from ${summary.trips} trips`}>
        <Text style={styles.amount} tabular testID="earnings-total">
          {formatNaira(summary.total)}
        </Text>
        <Text variant="callout" color="textSecondary">
          {summary.trips} {summary.trips === 1 ? 'trip' : 'trips'} · about {hours} h on trips · 0% commission
        </Text>
      </View>

      {period === 'week' ? (
        <View style={[styles.chart, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Earnings by day this week">
          {week.map((w, i) => (
            <View key={w.day} style={styles.barCol} accessible accessibilityLabel={`${w.day}, ${nairaAccessibilityLabel(w.total)}`}>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { height: `${Math.max(3, (w.total / max) * 100)}%`, backgroundColor: i === todayIndex ? colors.mapRoute : colors.text, opacity: w.total ? 1 : 0.15 }]} />
              </View>
              <Text variant="caption" color={i === todayIndex ? 'text' : 'textSecondary'} weight={i === todayIndex ? 'semibold' : 'medium'}>
                {w.day}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <SettingsGroup title="How you were paid">
        <SettingsRow icon="bank" title="Bank transfer" subtitle="Straight to your account" value={formatNaira(summary.byMethod.bank_transfer)} trailing="none" />
        <SettingsRow icon="wallet" title="GoBye Wallet" subtitle="Withdraw to your bank any time" value={formatNaira(summary.byMethod.wallet)} trailing="none" />
        {summary.pending ? <SettingsRow icon="clock" title="Waiting for payment" value={formatNaira(summary.pending)} trailing="none" /> : null}
      </SettingsGroup>

      <SettingsGroup title="Costs">
        <SettingsRow
          icon="ticket"
          title={passName(d.subscription)}
          subtitle={d.subscription && d.hasAccess ? `${formatRemaining(d.subscription.expiresAt - now)} left` : 'Needed to go online'}
          value={d.hasAccess ? 'Active' : undefined}
          onPress={() => router.push('/access')}
        />
        <SettingsRow icon="coin" title="Commission per trip" value="0%" trailing="none" />
      </SettingsGroup>

      {d.historySeeded ? <SimNote>Earlier trips here are sample data for the preview.</SimNote> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.page, paddingBottom: spacing.xxl, gap: spacing.lg },
  title: { paddingTop: spacing.xs },
  total: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 44, lineHeight: 52, letterSpacing: -1 },
  chart: { flexDirection: 'row', justifyContent: 'space-between', height: 168, padding: spacing.lg, borderRadius: layout.cardRadius },
  barCol: { flex: 1, alignItems: 'center', gap: spacing.sm },
  barTrack: { flex: 1, width: 18, justifyContent: 'flex-end' },
  bar: { width: 18, borderRadius: 6 },
});
