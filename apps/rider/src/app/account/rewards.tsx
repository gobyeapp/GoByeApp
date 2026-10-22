import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { formatNaira, kobo, nairaAccessibilityLabel, type Referral, type ReferralStatus } from '@gobye/core';
import {
  Bone,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Screen,
  Sheet,
  SimulatedBadge,
  SkeletonGroup,
  SkeletonRow,
  Text,
  layout,
  shadows,
  spacing,
  useTheme,
  useToast,
  type ColorTokens,
} from '@gobye/ui';
import { PageHeader } from '@/features/account/ui';
import { useServiceConfig } from '@/state/config';
import { useHaptics } from '@/state/haptics';
import { useServices } from '@/state/services';
import { useSession } from '@/state/session';

/** Status text colours and labels (written status, never colour alone). */
const STATUS: Record<ReferralStatus, { tone: keyof ColorTokens; label: string }> = {
  invited: { tone: 'textSecondary', label: 'Invited, not signed up yet' },
  qualifying: { tone: 'warning', label: 'Signed up, first paid trip pending' },
  qualified: { tone: 'warning', label: 'Qualified, reward on its way' },
  rewarded: { tone: 'success', label: 'Rewarded' },
  expired: { tone: 'textSecondary', label: 'Expired' },
};

const ago = (ms: number) => {
  const d = Math.max(0, Date.now() - ms);
  const h = Math.floor(d / 3_600_000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
};
/** Only a first name and initial are ever shown for invited people. */
const shortName = (name: string) => {
  const [first, second] = name.trim().split(/\s+/);
  return second ? `${first} ${second[0].toUpperCase()}.` : first;
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

const RECENT = 3;

/**
 * R24 Invite friends (referral.jpg): summary figures first (Invited, Qualified, Total earned in one nested
 * container), then title and explanation, the tile grid, the reward card, the code with Copy and Share,
 * and recent activity.
 * Every term comes from the admin configured programme (`ServiceConfig.referral`); signing up alone
 * never earns a reward.
 */
export default function Referrals() {
  const { colors, scheme } = useTheme();
  const toast = useToast();
  const haptic = useHaptics();
  const { user } = useSession();
  const cfg = useServiceConfig().referral;
  const { referrals } = useServices();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<Referral[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setItems(await referrals.listReferrals());
      setState('ready');
    } catch {
      setState('error');
    }
  }, [referrals]);

  useEffect(() => {
    void load();
  }, [load]);

  const name = user ? `${user.firstName} ${user.lastName}` : 'You';
  const code = `GOBYE${(user?.firstName ?? 'RIDER').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)}${(user?.phone ?? '0000').slice(-3)}`;
  const link = `${cfg.link}/${code}`;
  const count = (...s: ReferralStatus[]) => items.filter((r) => s.includes(r.status)).length;
  const earned = kobo(items.reduce((sum, r) => sum + (r.status === 'rewarded' && r.reward ? r.reward : 0), 0));
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  const visible = showAll ? sorted : sorted.slice(0, RECENT);

  const copyCode = async () => {
    await Clipboard.setStringAsync(code);
    haptic('selection');
    toast('Referral code copied', 'success');
  };
  const share = () => Share.share({ message: `Ride with GoBye. Join with my code ${code}: ${link}` }).catch(() => undefined);

  if (!cfg.enabled) {
    return (
      <Screen header={<PageHeader title="Invite friends" onBack={() => router.back()} />}>
        <EmptyState icon="gift" illustration="gift" title="Referrals aren’t available right now" body="Check back later." />
      </Screen>
    );
  }

  return (
    <Screen header={<PageHeader title="" onBack={() => router.back()} />}>
      {/* Summary first: one shared container, three equal figures. */}
      {state === 'error' ? null : (
        <View style={[styles.summary, { backgroundColor: colors.surfaceMuted }]} testID="referral-summary">
          {state === 'loading' ? (
            <SkeletonGroup label="Loading your rewards" style={styles.summaryRow}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.figure, { backgroundColor: scheme === 'dark' ? colors.surfaceSelected : colors.card }]}>
                  <Bone width={36} height={22} />
                  <Bone width={56} height={11} />
                </View>
              ))}
            </SkeletonGroup>
          ) : (
            <View style={styles.summaryRow}>
              <Figure value={String(items.length)} label="Invited" />
              <Figure value={String(count('qualified', 'rewarded'))} label="Qualified" />
              <Figure value={formatNaira(earned)} label="Total earned" spoken={nairaAccessibilityLabel(earned)} />
            </View>
          )}
        </View>
      )}

      {/* Title and plain explanation */}
      <View style={styles.intro}>
        <Text variant="title2" accessibilityRole="header">
          Invite friends
        </Text>
        <Text variant="callout" color="textSecondary">
          Earn when a friend takes their first paid trip.
        </Text>
        <SimulatedBadge label="Preview terms" />
      </View>

      {/* Tile grid with the passenger at its centre (referral visual) */}
      <TileGrid you={initials(name)} friends={items.filter((r) => r.status !== 'expired').map((r) => initials(r.name))} />

      {/* Reward card */}
      <Pressable
        onPress={() => setTermsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Earn ${nairaAccessibilityLabel(cfg.referrerReward)} per friend. When they complete their first paid trip. See how it works`}
        style={({ pressed }) => [
          styles.rewardCard,
          { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
          scheme === 'light' && shadows.card,
          pressed && { opacity: 0.85 },
        ]}
        testID="reward-card"
      >
        <View style={[styles.seal, { backgroundColor: colors.accent }]}>
          <Text variant="subhead" weight="bold" style={{ color: colors.onBrandBanner }} numberOfLines={1} adjustsFontSizeToFit>
            {formatNaira(cfg.referrerReward)}
          </Text>
        </View>
        <View style={styles.flex}>
          <Text variant="headline">Earn {formatNaira(cfg.referrerReward)} per friend</Text>
          <Text variant="footnote" color="textSecondary">
            Paid to your Wallet.
          </Text>
        </View>
        <View style={[styles.arrow, { borderColor: colors.border }]}>
          <Icon name="chevronRight" size="sm" color="text" />
        </View>
      </Pressable>

      {/* Referral code with prominent Copy and Share */}
      <View style={[styles.codeBox, { backgroundColor: colors.surfaceMuted }]}>
        <View style={styles.codeTop}>
          <View style={styles.flex}>
            <Text variant="caption" color="textSecondary">
              Your referral code
            </Text>
            <Text variant="title3" tabular selectable accessibilityLabel={`Your referral code, ${code.split('').join(' ')}`} testID="referral-code">
              {code}
            </Text>
          </View>
        </View>
        <View style={styles.codeActions}>
          <Button title="Copy code" leadingIcon="copy" variant="secondary" size="md" style={[styles.flex, { backgroundColor: colors.card }]} onPress={copyCode} testID="copy-code" />
          <Button title="Share" leadingIcon="share" size="md" style={styles.flex} onPress={share} testID="referral-share" />
        </View>
      </View>

      {/* Recent activity */}
      <View style={styles.section}>
        <Text variant="headline" accessibilityRole="header">
          Recent activity
        </Text>
        {state === 'error' ? (
          <ErrorState title="Couldn’t load your referrals" body="Check your connection and try again." onRetry={() => void load()} />
        ) : state === 'loading' ? (
          <SkeletonGroup label="Loading referral activity">
            {[0, 1, 2].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </SkeletonGroup>
        ) : items.length === 0 ? (
          <EmptyState icon="userAdd" title="No invites yet" body="Friends you invite appear here." actionLabel="Share code" onAction={share} />
        ) : (
          <View>
            {visible.map((r) => {
              const s = STATUS[r.status];
              const reward = r.status === 'rewarded' && r.reward ? r.reward : null;
              return (
                <View
                  key={r.id}
                  style={styles.refRow}
                  accessible
                  accessibilityLabel={`${shortName(r.name)}. ${s.label}. ${ago(r.updatedAt)}${reward ? `. ${nairaAccessibilityLabel(reward)} earned` : ''}`}
                >
                  <View style={[styles.initials, { backgroundColor: r.status === 'rewarded' ? colors.brandBanner : colors.surfaceMuted }]}>
                    <Text variant="subhead" weight="semibold" style={{ color: r.status === 'rewarded' ? colors.onBrandBanner : colors.text }}>
                      {initials(r.name)}
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text variant="callout" weight="medium">
                      {shortName(r.name)}
                    </Text>
                    <Text variant="footnote" color={s.tone}>
                      {s.label}
                    </Text>
                  </View>
                  <View style={styles.right}>
                    {reward ? (
                      <Text variant="subhead" weight="semibold" color="success" tabular>
                        +{formatNaira(reward)} earned
                      </Text>
                    ) : null}
                    <Text variant="caption" color="textSecondary">
                      {ago(r.updatedAt)}
                    </Text>
                  </View>
                </View>
              );
            })}
            {sorted.length > RECENT ? (
              <View style={styles.center}>
                <Pill label={showAll ? 'Show less' : 'View all'} onPress={() => setShowAll((v) => !v)} />
              </View>
            ) : null}
          </View>
        )}
      </View>

      <Sheet visible={termsOpen} onClose={() => setTermsOpen(false)} title="How referrals work" subtitle="Terms can change." footer={<Button title="Share code" leadingIcon="share" onPress={share} />}>
        <Step n={1} title="Share your code" body={`Invites stay valid for ${cfg.inviteExpiryDays} days.`} />
        <Step n={2} title="Your friend signs up with it" body="Signing up alone doesn’t count." />
        <Step n={3} title="They pay for their first trip" body={`${formatNaira(cfg.referrerReward)} is added to your Wallet.`} />
        <Text variant="footnote" color="textSecondary">
          Up to {cfg.maxRewardedReferrals} rewarded friends. Unused rewards expire after {cfg.rewardExpiryDays} days.
        </Text>
      </Sheet>
    </Screen>
  );
}

/** 7 × 3 grid of rounded tiles; the passenger sits in the middle, friends' initials around them. */
function TileGrid({ you, friends }: { you: string; friends: string[] }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const cols = 7;
  const gap = 6;
  const size = Math.min(52, (Math.min(width, 480) - layout.page * 2 - gap * (cols - 1)) / cols);
  const centre = cols + Math.floor(cols / 2);
  const slots = [centre - 2, centre + 2, 2, 18, 5, 15];
  return (
    <View style={[styles.grid, { gap }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: cols * 3 }, (_, i) => {
        const friendIndex = slots.indexOf(i);
        const friend = friendIndex >= 0 ? friends[friendIndex] : undefined;
        const isYou = i === centre;
        const filled = (i + Math.floor(i / cols)) % 2 === 0;
        return (
          <View
            key={i}
            style={[
              styles.tile,
              {
                width: size,
                height: size,
                borderRadius: size * 0.28,
                backgroundColor: isYou ? colors.brandBanner : filled ? colors.surfaceMuted : colors.background,
                borderColor: colors.border,
                borderWidth: isYou ? 0 : StyleSheet.hairlineWidth,
              },
            ]}
          >
            {isYou ? (
              <Text variant="headline" style={{ color: colors.onBrandBanner }} maxFontSizeMultiplier={1.2}>
                {you}
              </Text>
            ) : friend ? (
              <Text variant="caption" weight="semibold" color="textSecondary" maxFontSizeMultiplier={1.2}>
                {friend}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Pill({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6} style={({ pressed }) => [styles.pill, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceMuted : colors.background }]}>
      <Text variant="subhead" weight="medium">
        {label}
      </Text>
    </Pressable>
  );
}

function Figure({ label, value, spoken }: { label: string; value: string; spoken?: string }) {
  const { colors, scheme } = useTheme();
  return (
    <View style={[styles.figure, { backgroundColor: scheme === 'dark' ? colors.surfaceSelected : colors.card }]} accessible accessibilityLabel={`${label}: ${spoken ?? value}`}>
      <Text variant="title2" tabular numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="footnote" color="textSecondary" align="center" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.refRow} accessible accessibilityLabel={`Step ${n}. ${title}. ${body}`}>
      <View style={[styles.initials, { backgroundColor: colors.surfaceMuted, borderRadius: 20 }]}>
        <Text variant="subhead" weight="bold">
          {n}
        </Text>
      </View>
      <View style={styles.flex}>
        <Text variant="callout" weight="medium">
          {title}
        </Text>
        <Text variant="footnote" color="textSecondary">
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  intro: { gap: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingVertical: spacing.xs },
  tile: { alignItems: 'center', justifyContent: 'center' },
  rewardCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: layout.cardRadius, padding: layout.container },
  seal: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  arrow: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  codeBox: { borderRadius: layout.cardRadius, padding: layout.container, gap: spacing.md },
  codeTop: { flexDirection: 'row', alignItems: 'center' },
  codeActions: { flexDirection: 'row', gap: spacing.sm },
  section: { gap: spacing.md },
  pill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: spacing.lg, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  summary: { borderRadius: 18, padding: 6 },
  summaryRow: { flexDirection: 'row', gap: 6 },
  figure: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 12, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, minHeight: 76 },
  refRow: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 60, paddingVertical: spacing.sm },
  initials: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  right: { alignItems: 'flex-end', gap: 2, flexShrink: 0, maxWidth: '45%' },
  center: { alignItems: 'center', paddingTop: spacing.md },
});
