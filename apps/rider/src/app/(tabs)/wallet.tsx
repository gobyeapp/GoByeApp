import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { formatNaira, nairaAccessibilityLabel, simulatedWalletAccount, type Kobo, type WalletTransaction } from '@gobye/core';
import {
  Avatar,
  Bone,
  EmptyState,
  ErrorState,
  Icon,
  PlumBackground,
  SkeletonGroup,
  SkeletonRow,
  Text,
  layout,
  radii,
  spacing,
  useTheme,
  useToast,
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
  { id: 'other', label: 'Refunds', match: (t) => t.status === 'reversed' || (t.type !== 'top_up' && t.type !== 'ride_payment') },
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
  const toast = useToast();
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
  // Hide the balance in public; back to shown when the app restarts.
  const [hidden, setHidden] = useState(false);
  // The header is dark, so the status bar is light, only while this tab is the one showing.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
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

  const account = user ? simulatedWalletAccount(user.id, name) : null;
  const copyAccount = async () => {
    if (!account) return;
    await Clipboard.setStringAsync(account.accountNumber).catch(() => undefined);
    toast(account.isSimulated ? 'Test account number copied. Don’t send real money to it.' : 'Account number copied', 'success');
  };
  const on = colors.onBrandBanner;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const failed = wallet.state === 'error' && wallet.transactions.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {focused ? <StatusBar style="light" /> : null}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={on} />}
      >
        {/* Brand header (D-087): greeting, the balance and the two things people do here. */}
        <View style={[styles.hero, { backgroundColor: colors.brandBanner, paddingTop: insets.top + spacing.md }]}>
          {/* The same plum gradient as the sign-up header (D-088). */}
          <PlumBackground />
          <View style={styles.header}>
            <Pressable onPress={() => router.push('/(tabs)/account')} accessibilityRole="button" accessibilityLabel={`Your account${name ? `, ${name}` : ''}`} style={styles.who}>
              <Avatar uri={user?.photoUri} name={name} size={40} />
              <View style={styles.flex}>
                <Text variant="subhead" weight="regular" style={{ color: on, opacity: 0.8 }}>
                  {greeting}
                </Text>
                <Text variant="subhead" weight="bold" numberOfLines={1} style={{ color: on }}>
                  {user?.firstName || 'Your wallet'}
                </Text>
              </View>
            </Pressable>
            <View>
              <HeroIcon icon="notification" label={unreadCount ? `Notifications, ${unreadCount} new` : 'Notifications'} onPress={() => router.push('/notifications')} />
              {unreadCount ? <View style={[styles.dot, { backgroundColor: colors.accent, borderColor: colors.brandBanner }]} /> : null}
            </View>
            <HeroIcon icon="support" label="Help" onPress={() => router.push('/account/support')} testID="wallet-help" />
          </View>

          <View style={styles.balance}>
            <View style={styles.balanceLabel}>
              <Text variant="subhead" weight="regular" style={{ color: on, opacity: 0.85 }}>
                Available balance
              </Text>
            </View>
            {loading ? (
              <SkeletonGroup label="Loading your balance" style={styles.balanceSkeleton}>
                <Bone width={200} height={40} radius={10} />
              </SkeletonGroup>
            ) : (
              <View style={styles.balanceRow}>
                <Text accessibilityLabel={hidden ? 'Balance hidden' : `Available balance, ${nairaAccessibilityLabel(wallet.available)}`} testID="wallet-available" style={styles.balanceLine}>
                  {/* The currency sign is quieter and smaller, so the figure itself leads (D-093). */}
                  <Text variant="title2" weight="medium" style={[styles.naira, { color: on }]}>
                    ₦{' '}
                  </Text>
                  <Text variant="largeTitle" tabular style={[compact ? styles.balanceCompact : styles.balanceBig, { color: on }]}>
                    {hidden ? '••••••' : whole.replace('₦', '')}
                  </Text>
                  {hidden ? null : (
                    <Text variant="body" tabular style={{ color: on, opacity: 0.75 }}>
                      {kobo}
                    </Text>
                  )}
                </Text>
                <Pressable onPress={() => setHidden((h) => !h)} accessibilityRole="button" accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'} hitSlop={12} testID="wallet-hide">
                  <Icon name={hidden ? 'eyeClose' : 'eye'} size="sm" color={on} />
                </Pressable>
              </View>
            )}
            <View style={styles.balanceMeta}>
              {wallet.reserved > 0 && !hidden ? (
                <View style={[styles.metaChip, styles.glass]} accessible accessibilityLabel={`Reserved for a trip in progress, ${nairaAccessibilityLabel(wallet.reserved)}`}>
                  <Icon name="lock" size="xs" color={on} />
                  <Text variant="footnote" style={{ color: on }}>
                    {formatNaira(wallet.reserved)} reserved
                  </Text>
                </View>
              ) : null}
            </View>
            {/* The rider's own account number, one tap to copy (D-092). While payments are simulated the
                chip beside it says "Test", where a live account says "Active". */}
            {account ? (
              <Pressable
                onPress={copyAccount}
                accessibilityRole="button"
                accessibilityLabel={`${account.isSimulated ? 'Test account' : 'Account'} number ${account.accountNumber.split('').join(' ')}, ${account.bankName}. Copy`}
                hitSlop={8}
                style={({ pressed }) => [styles.accountRow, pressed && { opacity: 0.7 }]}
                testID="wallet-account"
              >
                <Text variant="subhead" weight="regular" tabular style={{ color: on, opacity: 0.9 }}>
                  {account.accountNumber}
                </Text>
                <Icon name="copy" size="xs" color={on} />
                <View style={[styles.accountRule, { backgroundColor: on }]} />
                <View style={[styles.accountState, { backgroundColor: account.isSimulated ? colors.warningSurface : colors.successSurface }]}>
                  <Text variant="caption" weight="semibold" color={account.isSimulated ? 'warning' : 'success'}>
                    {account.isSimulated ? 'Test' : 'Active'}
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.tray}>
            <HeroAction icon="plus" label="Add money" onPress={() => setDepositOpen(true)} testID="wallet-add" />
            <HeroAction
              icon="receipt"
              label={mode === 'history' ? 'Recent' : 'History'}
              onPress={() => {
                setMode(mode === 'history' ? 'recent' : 'history');
                setFilter('all');
              }}
              testID="wallet-history"
            />
          </View>
        </View>

        {/* The page rises over the header with rounded corners. */}
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          {failed ? (
            <ErrorState title="Couldn’t load your wallet" body="Check your connection and try again." onRetry={() => void wallet.refresh()} />
          ) : (
            <>
            {/* A deposit in progress matters now, so it stays above the list. Offers come after it. */}
            {!loading && pendingDeposit ? <DepositCard tx={pendingDeposit} onPress={() => setDetail(pendingDeposit)} /> : null}

            {/* History */}
            <View style={styles.sectionHead}>
              <Text variant="body" weight="bold" accessibilityRole="header" style={styles.flex}>
                {mode === 'recent' ? 'Recent activity' : 'Transaction history'}
              </Text>
              {sorted.length > 0 ? (
                <Pressable
                  onPress={() => {
                    setMode(mode === 'history' ? 'recent' : 'history');
                    setFilter('all');
                  }}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={styles.link}
                >
                  <Text variant="footnote" weight="semibold">
                    {mode === 'history' ? 'Show less' : 'See all'}
                  </Text>
                  <Icon name={mode === 'history' ? 'chevronUp' : 'chevronRight'} size="xs" color="text" />
                </Pressable>
              ) : null}
            </View>
            {mode === 'history' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filters} accessibilityRole="tablist">
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

            {!loading && !pendingDeposit ? <PromoCarousel placement="wallet" testID="wallet-promo" /> : null}

            {wallet.state === 'error' ? (
              <Pressable onPress={() => void wallet.refresh()} accessibilityRole="button" style={[styles.notice, { backgroundColor: colors.dangerSurface }]}>
                <Icon name="warning" size="sm" color="danger" />
                <Text variant="subhead" style={styles.flex}>
                  Couldn’t refresh. Showing saved transactions.
                </Text>
                <Text variant="body" weight="semibold">
                  Retry
                </Text>
              </Pressable>
            ) : null}
            </>
          )}
        </View>
      </ScrollView>
      <DepositSheet visible={depositOpen} onClose={() => setDepositOpen(false)} />
      <TransactionDetailSheet tx={detail} onClose={() => setDetail(null)} onNewDeposit={() => setDepositOpen(true)} />
    </View>
  );
}

/** Round translucent icon button on the brand header. */
function HeroIcon({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} testID={testID} style={({ pressed }) => [styles.heroIcon, styles.glass, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size="sm" color={colors.onBrandBanner} />
    </Pressable>
  );
}

/** One of the two header actions: a translucent button, icon beside a short label. */
function HeroAction({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={({ pressed }) => [styles.tile, styles.glass, pressed && { opacity: 0.75 }]}>
      <Icon name={icon} size="sm" color={colors.onBrandBanner} />
      <Text variant="subhead" weight="medium" numberOfLines={1} style={{ color: colors.onBrandBanner }}>
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
        <Text variant="subhead" weight="semibold" color="textSecondary" style={styles.flex}>
          Deposit in progress
        </Text>
        <View style={[styles.pending, { backgroundColor: colors.warningSurface }]}>
          <Text variant="footnote" color="warning">
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
      <Text variant="subhead" color="textSecondary">
        Your transfer is being confirmed. Your balance updates automatically.
      </Text>
      <View style={styles.depositAction}>
        <Text variant="subhead" weight="semibold">
          View status
        </Text>
        <Icon name="arrowRight" size="xs" color="text" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { paddingHorizontal: layout.page, paddingBottom: spacing.xl + 28, overflow: 'hidden' },
  heroIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  glass: { backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  balanceLabel: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: 'rgba(255, 255, 255, 0.10)' },
  naira: { opacity: 0.6 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // Rises over the header; everything inside starts at the page edge (20).
  sheet: { flex: 1, marginTop: -28, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: layout.page, paddingTop: spacing.xl, gap: spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  dot: { position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  scroll: { paddingBottom: spacing.xl, flexGrow: 1 },
  balance: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  balanceSkeleton: { alignItems: 'center', paddingVertical: spacing.xs },
  balanceLine: { textAlign: 'center' },
  balanceBig: { fontFamily: 'Inter_700Bold', fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  balanceCompact: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  balanceMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  accountRule: { width: StyleSheet.hairlineWidth, height: 14, opacity: 0.5 },
  accountState: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.pill },
  tray: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, height: 46, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: -spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  filters: { gap: spacing.sm, alignItems: 'center' },
  // A horizontal ScrollView grows to fill spare height unless told not to: keep the chip row its own size.
  filterRow: { flexGrow: 0, flexShrink: 0 },
  chip: { height: 32, paddingHorizontal: spacing.md, borderRadius: radii.pill, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  history: { borderRadius: 24, paddingVertical: spacing.xs, overflow: 'hidden' },
  historyLift: { boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.04)' } as object,
  deposit: { borderRadius: 22, borderWidth: 1, padding: layout.container + 2, gap: spacing.xs },
  depositLift: { boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.04), 0px 6px 16px rgba(0, 0, 0, 0.05)' } as object,
  depositHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  depositDot: { width: 8, height: 8, borderRadius: 4 },
  depositAmount: { marginTop: spacing.xs },
  pending: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  depositAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, alignSelf: 'flex-start', minHeight: 28 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md + 32 + spacing.md, marginRight: spacing.md },
  notice: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, padding: layout.container, borderRadius: layout.cardRadius },
});
