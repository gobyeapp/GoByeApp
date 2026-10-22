import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNaira, nairaAccessibilityLabel, type Kobo, type WalletTransaction } from '@gobye/core';
import {
  Avatar,
  Bone,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  SimulatedBadge,
  SkeletonGroup,
  SkeletonRow,
  Text,
  layout,
  radii,
  shadows,
  spacing,
  useTheme,
  type IconName,
} from '@gobye/ui';
import { PromoCarousel } from '@/features/promo/PromoCarousel';
import { DepositSheet } from '@/features/wallet/DepositSheet';
import { TransactionDetailSheet } from '@/features/wallet/TransactionDetailSheet';
import { TransactionRow } from '@/features/wallet/TransactionRow';
import { useAccount } from '@/state/account';
import { useSession } from '@/state/session';
import { useWallet } from '@/state/wallet';

type Filter = 'all' | 'deposits' | 'trips' | 'other';
const FILTERS: { id: Filter; label: string; match: (t: WalletTransaction) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'deposits', label: 'Deposits', match: (t) => t.type === 'top_up' },
  { id: 'trips', label: 'Trip payments', match: (t) => t.type === 'ride_payment' },
  { id: 'other', label: 'Refunds and reversals', match: (t) => t.status === 'reversed' || (t.type !== 'top_up' && t.type !== 'ride_payment') },
];
const RECENT = 5;

/**
 * Wallet tab, recreated from the approved wallet reference: profile header above one large rounded
 * panel holding a centred balance (decimals quieter), a compact tray of equal action tiles, a contextual
 * brand banner and a rounded history card. Statuses are written out and coloured; only verified
 * transactions change the balance. No charts, swaps or other financial products.
 */
export default function Wallet() {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const { width } = useWindowDimensions();
  const wallet = useWallet();
  const { user } = useSession();
  const { unreadCount } = useAccount();
  const [mode, setMode] = useState<'recent' | 'history'>('recent');
  const [filter, setFilter] = useState<Filter>('all');
  const [depositOpen, setDepositOpen] = useState(false);
  const { add } = useLocalSearchParams<{ add?: string }>();
  // Opened from the "Pay in one tap" offer: start the Add money flow once, then clear the parameter.
  useEffect(() => {
    if (add === '1') {
      setDepositOpen(true);
      router.setParams({ add: undefined });
    }
  }, [add]);
  const [detail, setDetail] = useState<WalletTransaction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const compact = width < 360;

  const sorted = useMemo(() => [...wallet.transactions].sort((a, b) => b.createdAt - a.createdAt), [wallet.transactions]);
  const list = useMemo(() => {
    if (mode === 'recent') return sorted.slice(0, RECENT);
    const f = FILTERS.find((x) => x.id === filter)!;
    return sorted.filter(f.match);
  }, [sorted, mode, filter]);
  const pendingDeposit = sorted.find((t) => t.type === 'top_up' && t.status === 'pending');
  const loading = wallet.state === 'loading' && wallet.transactions.length === 0;
  const name = user ? `${user.firstName} ${user.lastName}`.trim() : '';

  const onRefresh = async () => {
    setRefreshing(true);
    await wallet.refresh();
    setRefreshing(false);
  };

  // Balance split so the kobo part can be quieter, as in the reference.
  const whole = formatNaira((Math.floor(wallet.available / 100) * 100) as Kobo);
  const kobo = `.${String(Math.abs(wallet.available) % 100).padStart(2, '0')}`;

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {/* Profile header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.push('/(tabs)/account')} accessibilityRole="button" accessibilityLabel={`Your account${name ? `, ${name}` : ''}`} style={styles.who}>
          <Avatar uri={user?.photoUri} name={name} size={44} />
          <View style={styles.flex}>
            <Text variant="subhead" weight="semibold" numberOfLines={1}>
              {name || 'Your wallet'}
            </Text>
            <Text variant="caption" color="textSecondary">
              GoBye wallet
            </Text>
          </View>
        </Pressable>
        <View>
          <IconButton icon="notification" variant="filled" accessibilityLabel={unreadCount ? `Notifications, ${unreadCount} new` : 'Notifications'} onPress={() => router.push('/notifications')} />
          {unreadCount ? <View style={[styles.dot, { backgroundColor: colors.navActive, borderColor: colors.background }]} /> : null}
        </View>
      </View>

      {wallet.state === 'error' && wallet.transactions.length === 0 ? (
        <View style={[styles.panel, styles.flexPanel, { backgroundColor: colors.surfaceMuted }]}>
          <ErrorState title="Couldn’t load your wallet" body="Check your connection and try again." onRetry={() => void wallet.refresh()} />
        </View>
      ) : (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} />}
        >
          <View style={[styles.panel, { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0 }]}>
            {/* Balance */}
            <View style={styles.balance}>
              <Text variant="subhead" color="textSecondary">
                Available balance
              </Text>
              {loading ? (
                <SkeletonGroup label="Loading your balance" style={styles.balanceSkeleton}>
                  <Bone width={200} height={40} radius={10} />
                </SkeletonGroup>
              ) : (
                <Text accessibilityLabel={`Available balance, ${nairaAccessibilityLabel(wallet.available)}`} testID="wallet-available" style={styles.balanceLine}>
                  <Text variant="largeTitle" tabular style={compact ? styles.balanceCompact : styles.balanceBig}>
                    {whole}
                  </Text>
                  <Text variant="largeTitle" tabular color="textSecondary" style={compact ? styles.balanceCompact : styles.balanceBig}>
                    {kobo}
                  </Text>
                </Text>
              )}
              <View style={styles.balanceMeta}>
                {wallet.reserved > 0 ? (
                  <View style={[styles.metaChip, { backgroundColor: colors.card }]} accessible accessibilityLabel={`Reserved for a trip in progress, ${nairaAccessibilityLabel(wallet.reserved)}`}>
                    <Icon name="lock" size="xs" color="textSecondary" />
                    <Text variant="caption" color="textSecondary">
                      {formatNaira(wallet.reserved)} reserved
                    </Text>
                  </View>
                ) : null}
                <SimulatedBadge />
              </View>
            </View>

            {/* Action tray */}
            <View style={styles.tray}>
              <ActionTile icon="plus" label="Add money" onPress={() => setDepositOpen(true)} testID="wallet-add" />
              <ActionTile
                icon="receipt"
                label="History"
                selected={mode === 'history'}
                onPress={() => {
                  setMode(mode === 'history' ? 'recent' : 'history');
                  setFilter('all');
                }}
                testID="wallet-history"
              />
              <ActionTile icon="support" label="Help" onPress={() => router.push('/account/support')} testID="wallet-help" />
            </View>

            {/* Contextual banner */}
            {!loading ? (
              pendingDeposit ? (
                <DepositCard tx={pendingDeposit} onPress={() => setDetail(pendingDeposit)} />
              ) : (
                <PromoCarousel placement="wallet" testID="wallet-promo" />
              )
            ) : null}

            {/* History */}
            <View style={styles.sectionHead}>
              <Text variant="headline" accessibilityRole="header" style={styles.flex}>
                {mode === 'recent' ? 'Recent activity' : 'Transaction history'}
              </Text>
              {mode === 'recent' && sorted.length > RECENT ? (
                <Pressable onPress={() => setMode('history')} accessibilityRole="button" hitSlop={8} style={styles.link}>
                  <Text variant="footnote" weight="semibold">
                    See all
                  </Text>
                  <Icon name="chevronRight" size="xs" color="text" />
                </Pressable>
              ) : null}
            </View>
            {mode === 'history' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} accessibilityRole="tablist">
                {FILTERS.map((f) => {
                  const on = f.id === filter;
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => setFilter(f.id)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      style={[styles.chip, { backgroundColor: on ? colors.primary : colors.card, borderColor: colors.border }]}
                    >
                      <Text variant="footnote" weight={on ? 'semibold' : 'medium'} color={on ? 'onPrimary' : 'text'}>
                        {f.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            <View style={[styles.history, { backgroundColor: colors.card }, scheme === 'light' && styles.historyLift]}>
              {loading ? (
                <SkeletonGroup label="Loading transactions">
                  {[0, 1, 2, 3].map((i) => (
                    <SkeletonRow key={i} avatar />
                  ))}
                </SkeletonGroup>
              ) : list.length ? (
                list.map((t, i) => (
                  <View key={t.id}>
                    {i > 0 ? <View style={[styles.sep, { backgroundColor: colors.border }]} /> : null}
                    <TransactionRow tx={t} onPress={() => setDetail(t)} />
                  </View>
                ))
              ) : (
                <EmptyState
                  icon="wallet"
                  illustration="wallet"
                  title={filter === 'all' || mode === 'recent' ? 'No transactions yet' : 'Nothing here yet'}
                  body={filter === 'all' || mode === 'recent' ? undefined : 'Try another filter.'}
                  actionLabel={filter === 'all' || mode === 'recent' ? 'Add money' : undefined}
                  onAction={filter === 'all' || mode === 'recent' ? () => setDepositOpen(true) : undefined}
                />
              )}
            </View>

            {wallet.state === 'error' ? (
              <Pressable onPress={() => void wallet.refresh()} accessibilityRole="button" style={[styles.notice, { backgroundColor: colors.dangerSurface }]}>
                <Icon name="warning" size="sm" color="danger" />
                <Text variant="footnote" style={styles.flex}>
                  Couldn’t refresh. Showing saved transactions.
                </Text>
                <Text variant="subhead" weight="semibold">
                  Retry
                </Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      )}
      <DepositSheet visible={depositOpen} onClose={() => setDepositOpen(false)} />
      <TransactionDetailSheet tx={detail} onClose={() => setDetail(null)} onNewDeposit={() => setDepositOpen(true)} />
    </View>
  );
}

/** Equal action tile: white tile on the pale panel, icon over a short label. */
function ActionTile({ icon, label, onPress, selected, testID }: { icon: IconName; label: string; onPress: () => void; selected?: boolean; testID?: string }) {
  const { colors, scheme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      testID={testID}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: pressed ? colors.secondaryPressed : colors.card, borderColor: selected ? colors.text : colors.border },
        scheme === 'light' && !pressed && shadows.card,
      ]}
    >
      <Icon name={icon} variant={selected ? 'filled' : 'regular'} color="text" />
      <Text variant="caption" weight={selected ? 'bold' : 'semibold'} align="center" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Deposit in progress: a calm, trustworthy status card rather than a promo banner. Light surface, soft
 * tangerine outline and status dot, the amount as the focus, a compact Pending badge and a quiet
 * "View status" action. The balance above stays the primary figure.
 */
function DepositCard({ tx, onPress }: { tx: WalletTransaction; onPress: () => void }) {
  const { colors, scheme } = useTheme();
  const kobo = `.${String(Math.abs(tx.amount) % 100).padStart(2, '0')}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Deposit in progress, ${nairaAccessibilityLabel(tx.amount)}. Pending confirmation. View status`}
      testID="funding-banner"
      style={({ pressed }) => [
        styles.deposit,
        {
          backgroundColor: pressed ? colors.surfaceMuted : colors.card,
          borderColor: scheme === 'dark' ? 'rgba(255, 138, 64, 0.35)' : 'rgba(255, 117, 31, 0.32)',
        },
        scheme === 'light' && styles.depositLift,
      ]}
    >
      <View style={styles.depositHead}>
        <View style={[styles.depositDot, { backgroundColor: colors.accent }]} />
        <Text variant="footnote" weight="semibold" color="textSecondary" style={styles.flex}>
          Deposit in progress
        </Text>
        <View style={[styles.pending, { backgroundColor: colors.warningSurface }]}>
          <Text variant="caption" color="warning">
            Pending confirmation
          </Text>
        </View>
      </View>
      <Text tabular style={styles.depositAmount}>
        <Text variant="title1" tabular>
          {formatNaira((Math.floor(tx.amount / 100) * 100) as Kobo)}
        </Text>
        <Text variant="title1" tabular color="textSecondary">
          {kobo}
        </Text>
      </Text>
      <Text variant="footnote" color="textSecondary">
        Your transfer is being confirmed. Your balance updates automatically.
      </Text>
      <View style={styles.depositAction}>
        <Text variant="footnote" weight="semibold">
          View status
        </Text>
        <Icon name="arrowRight" size="xs" color="text" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: layout.page, paddingVertical: spacing.md },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  dot: { position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  panel: { borderRadius: 32, padding: spacing.md, gap: spacing.lg },
  flexPanel: { flex: 1, marginHorizontal: spacing.md, justifyContent: 'center' },
  balance: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  balanceSkeleton: { alignItems: 'center', paddingVertical: spacing.xs },
  balanceLine: { textAlign: 'center' },
  balanceBig: { fontSize: 40, lineHeight: 48, letterSpacing: -1 },
  balanceCompact: { fontSize: 34, lineHeight: 42, letterSpacing: -0.8 },
  balanceMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.pill },
  tray: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, minHeight: 72, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, paddingHorizontal: spacing.xs },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs, marginBottom: -spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  filters: { gap: spacing.sm, paddingHorizontal: spacing.xs },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radii.pill, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  history: { borderRadius: 24, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs, overflow: 'hidden' },
  historyLift: { boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.04)' } as object,
  deposit: { borderRadius: 22, borderWidth: 1, padding: layout.container + 2, gap: spacing.xs },
  depositLift: { boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.04), 0px 6px 16px rgba(0, 0, 0, 0.05)' } as object,
  depositHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  depositDot: { width: 8, height: 8, borderRadius: 4 },
  depositAmount: { marginTop: spacing.xs },
  pending: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  depositAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, alignSelf: 'flex-start', minHeight: 28 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: spacing.xs + spacing.md + 32 + spacing.md, marginRight: spacing.md },
  notice: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, padding: layout.container, borderRadius: layout.cardRadius },
});
