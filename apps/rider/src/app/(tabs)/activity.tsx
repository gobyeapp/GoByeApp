import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  chargedAmount,
  filterHistory,
  formatDistance,
  formatDuration,
  formatNaira,
  groupByDay,
  matchesFilter,
  nairaAccessibilityLabel,
  needsAttention,
  summariseHistory,
  type HistoryFilter,
  type HistoryPeriod,
  type Kobo,
  type PaymentStatus,
  type TripReceipt,
} from '@gobye/core';
import { SignedAmount, TxStatusBadge } from '@/features/common/Money';
import { EmptyState, Icon, SegmentedControl, SkeletonGroup, SkeletonRow, Text, layout, shadows, spacing, useTheme, type IconName, type StatusKind } from '@gobye/ui';
import { liveBannerCopy, liveRoute } from '@/features/navigation/reset';
import { useAccount } from '@/state/account';
import { useBooking } from '@/state/booking';
import { useHaptics } from '@/state/haptics';
import { useNow } from '@/state/useNow';

/** Completion and payment are separate states (brief §9): every trip shows a written payment status. */
const PAY: Record<PaymentStatus, { kind: StatusKind | null; label: string }> = {
  pending: { kind: 'pending', label: 'Pending' },
  processing: { kind: 'processing', label: 'Confirming' },
  paid: { kind: null, label: 'Paid' },
  failed: { kind: 'failed', label: 'Failed' },
  reversed: { kind: 'reversed', label: 'Reversed' },
  refunded: { kind: 'reversed', label: 'Refunded' },
};

const PERIOD_LABEL: Record<HistoryPeriod, string> = { week: 'this week', month: 'this month', all: 'in total' };

const FILTERS: { id: HistoryFilter; label: string; icon?: IconName }[] = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs attention', icon: 'warning' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  { id: 'bank_transfer', label: 'Bank transfer', icon: 'bank' },
];

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

/**
 * R17 Activities. A ride in progress first, then the history with a period switch (week / month / all),
 * a spend summary for that period, filter chips (needs attention, wallet, bank transfer) and trips grouped
 * by day. Each trip shows route, time, distance, duration, driver, amount and a written payment status.
 */
export default function Activity() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const haptic = useHaptics();
  const now = useNow(60_000);
  const { history, ready } = useAccount();
  const { booking } = useBooking();
  const live = booking && booking.status !== 'quoted' && booking.status !== 'cancelled' && booking.status !== 'failed' ? booking : null;
  const [period, setPeriod] = useState<HistoryPeriod>('month');
  const [filter, setFilter] = useState<HistoryFilter>('all');

  const inPeriod = useMemo(() => filterHistory(history, { period, filter: 'all', now }), [history, period, now]);
  const shown = useMemo(() => inPeriod.filter((r) => matchesFilter(r, filter)), [inPeriod, filter]);
  const summary = summariseHistory(inPeriod);
  const sections = groupByDay(shown, now);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, inPeriod.filter((r) => matchesFilter(r, f.id)).length])) as Record<HistoryFilter, number>, [inPeriod]);

  const pick = (f: HistoryFilter) => {
    haptic('selection');
    setFilter(f);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}>
      <Text variant="title2" accessibilityRole="header" style={styles.title}>
        Activities
      </Text>

      {live ? (
        <Pressable
          onPress={() => router.push(liveRoute(live.status))}
          accessibilityRole="button"
          accessibilityLabel={`${liveBannerCopy(live, 'Ride in progress').title} to ${live.destination.title}. ${liveBannerCopy(live).action}`}
          style={({ pressed }) => [styles.banner, { backgroundColor: colors.brandBanner }, pressed && { opacity: 0.9 }]}
          testID="activities-live"
        >
          <View style={styles.flex}>
            <Text variant="headline" style={{ color: colors.onBrandBanner }}>
              {liveBannerCopy(live, 'Ride in progress').title}
            </Text>
            <Text variant="footnote" style={{ color: colors.onBrandBanner, opacity: 0.85 }} numberOfLines={1}>
              To {live.destination.title}
            </Text>
          </View>
          <View style={[styles.bannerAction, { backgroundColor: colors.onBrandBanner }]}>
            <Text variant="subhead" weight="semibold" style={{ color: colors.brandBanner }}>
              {liveBannerCopy(live).action}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {!ready ? (
        <SkeletonGroup label="Loading your trips">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonRow key={i} avatar />
          ))}
        </SkeletonGroup>
      ) : history.length === 0 ? (
        <EmptyState icon="activity" illustration="sedan" title="No trips yet" body="Your rides, receipts and payments will show up here." actionLabel="Book a ride" onAction={() => router.navigate('/(tabs)')} />
      ) : (
        <>
          <SegmentedControl
            segments={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
              { value: 'all', label: 'All time' },
            ]}
            value={period}
            onChange={(p) => {
              setPeriod(p);
              setFilter('all');
            }}
            accessibilityLabel="Period"
          />

          {/* Summary for the period. */}
          <View style={[styles.summary, { backgroundColor: colors.surfaceMuted }]} testID="activity-summary">
            <View accessible accessibilityLabel={`${nairaAccessibilityLabel(summary.spent)} spent ${PERIOD_LABEL[period]}`}>
              <Text variant="footnote" color="textSecondary">
                Spent {PERIOD_LABEL[period]}
              </Text>
              <Text style={styles.spent} tabular>
                {formatNaira(summary.spent)}
              </Text>
            </View>
            <View style={styles.stats}>
              <Stat label="Trips" value={String(summary.trips)} />
              <View style={[styles.statSep, { backgroundColor: colors.border }]} />
              <Stat label="Distance" value={summary.distanceMeters ? formatDistance(summary.distanceMeters) : '0 km'} />
              <View style={[styles.statSep, { backgroundColor: colors.border }]} />
              <Stat label="Avg fare" value={summary.average ? formatNaira(summary.average) : '—'} />
            </View>
            {summary.attention ? (
              <Pressable
                onPress={() => pick('attention')}
                accessibilityRole="button"
                style={({ pressed }) => [styles.attention, { backgroundColor: colors.warningSurface, opacity: pressed ? 0.85 : 1 }]}
                testID="activity-attention"
              >
                <Icon name="warning" size="xs" color="warning" />
                <Text variant="footnote" weight="medium" style={styles.flex}>
                  {summary.attention === 1 ? '1 payment needs attention' : `${summary.attention} payments need attention`}
                </Text>
                <Icon name="chevronRight" size={14} color="textSecondary" />
              </Pressable>
            ) : null}
          </View>

          {/* Filters. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll} accessibilityRole="radiogroup" accessibilityLabel="Filter trips">
            {FILTERS.map((f) => (
              <Chip key={f.id} label={f.label} icon={f.icon} count={f.id === 'all' ? undefined : counts[f.id]} selected={filter === f.id} onPress={() => pick(f.id)} testID={`filter-${f.id}`} />
            ))}
          </ScrollView>

          {sections.length === 0 ? (
            <EmptyState
              icon="search"
              title="No trips here"
              body={filter === 'all' ? `You haven’t taken a ride ${PERIOD_LABEL[period]}.` : 'Try another filter or period.'}
              actionLabel={filter !== 'all' || period !== 'all' ? 'Show all trips' : undefined}
              onAction={() => {
                setFilter('all');
                setPeriod('all');
              }}
            />
          ) : (
            sections.map((s) => (
              <View key={s.title} style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text variant="footnote" weight="semibold" color="textSecondary" accessibilityRole="header" style={styles.flex}>
                    {s.title}
                  </Text>
                  {summariseHistory(s.data).spent ? (
                    <Text variant="footnote" color="textSecondary" tabular>
                      {formatNaira(summariseHistory(s.data).spent)}
                    </Text>
                  ) : null}
                </View>
                <DayCard>
                  {s.data.map((item, i) => (
                    <TripRow key={item.bookingId} item={item} first={i === 0} />
                  ))}
                </DayCard>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text variant="headline" tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
      <Text variant="caption" weight="regular" color="textSecondary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Chip({ label, icon, count, selected, onPress, testID }: { label: string; icon?: IconName; count?: number; selected: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const fg = selected ? colors.onPrimary : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? colors.primary : colors.surfaceMuted, borderColor: selected ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <Text variant="subhead" weight={selected ? 'semibold' : 'medium'} style={{ color: fg }}>
        {label}
      </Text>
      {count !== undefined ? (
        <Text variant="caption" tabular style={{ color: selected ? colors.onPrimary : colors.textSecondary, opacity: selected ? 0.8 : 1 }}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

function DayCard({ children }: { children: ReactNode }) {
  const { colors, scheme } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }, scheme === 'light' && shadows.card]}>
      {children}
    </View>
  );
}

function TripRow({ item, first }: { item: TripReceipt; first: boolean }) {
  const { colors } = useTheme();
  const pay = PAY[item.paymentStatus];
  const amount = chargedAmount(item);
  const driver = item.driver?.firstName;
  const meta = [time(item.completedAt), formatDistance(item.distanceMeters), formatDuration(item.durationSeconds), driver].filter(Boolean).join(' · ');
  const attention = needsAttention(item);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/ride/[id]', params: { id: item.bookingId } })}
      accessibilityRole="button"
      accessibilityLabel={`Trip from ${item.pickup.title} to ${item.destination.title}, ${meta}, ${nairaAccessibilityLabel(amount)}, ${pay.label}, ${item.paymentMethod.type === 'wallet' ? 'GoBye Wallet' : 'bank transfer'}`}
      style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.7 }]}
      testID={`trip-${item.bookingId}`}
    >
      <View style={[styles.icon, { backgroundColor: attention ? colors.warningSurface : colors.surfaceMuted }]}>
        <Icon name="car" variant="filled" size="sm" color="text" />
        <View style={[styles.subIcon, { backgroundColor: colors.card }]}>
          <Icon name={item.paymentMethod.type === 'wallet' ? 'wallet' : 'bank'} size={11} color="textSecondary" />
        </View>
      </View>
      <View style={styles.flex}>
        <Text variant="callout" weight="medium" numberOfLines={1}>
          {item.destination.title}
        </Text>
        <Text variant="footnote" color="textSecondary" numberOfLines={1}>
          From {item.pickup.title}
        </Text>
        <Text variant="caption" weight="regular" color="textSecondary" numberOfLines={2} style={styles.meta}>
          {meta}
        </Text>
      </View>
      <View style={styles.right}>
        {/* A trip payment is money out: red with "−". Status only when it isn't a normal paid trip. */}
        <SignedAmount amount={-amount as Kobo} voided={item.paymentStatus === 'failed' || item.paymentStatus === 'reversed'} variant="callout" />
        <TxStatusBadge kind={pay.kind} label={pay.label} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: layout.page, paddingBottom: spacing.xxl, gap: spacing.lg },
  title: { paddingTop: spacing.xs },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: layout.cardRadius, padding: layout.container, minHeight: 72 },
  bannerAction: { borderRadius: 999, paddingHorizontal: spacing.md, minHeight: 34, justifyContent: 'center' },
  summary: { borderRadius: layout.cardRadius, padding: spacing.lg, gap: spacing.lg },
  spent: { fontFamily: 'Inter_700Bold', fontSize: 32, lineHeight: 40, letterSpacing: -0.6 },
  stats: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, gap: 2 },
  statSep: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginHorizontal: spacing.md },
  attention: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 40, borderRadius: layout.controlRadius },
  chipScroll: { marginHorizontal: -layout.page, marginTop: -spacing.xs },
  chips: { gap: spacing.sm, paddingHorizontal: layout.page },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: spacing.md + 2, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs },
  card: { borderRadius: layout.cardRadius, paddingHorizontal: layout.container },
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 76, paddingVertical: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  subIcon: { position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  meta: { marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4, flexShrink: 0, maxWidth: '40%' },
});
