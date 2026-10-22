import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { EmptyState, Icon, Screen, SkeletonGroup, SkeletonRow, Text, layout, spacing, useTheme, type IconName } from '@gobye/ui';
import type { AppNotification, NotificationKind } from '@gobye/core';
import { PageHeader, SettingsGroup } from '@/features/account/ui';
import { useAccount } from '@/state/account';

const ICON: Record<NotificationKind, IconName> = { trip: 'car', payment: 'wallet', promo: 'gift', safety: 'shield', account: 'account' };
const dateFmt = (ms: number) => new Date(ms).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * R23 Notifications inbox, reached from the bell (Home, Wallet). Unread items carry the only unread
 * marker in the app; opening the inbox marks them read. Alert settings live in Account → Notification preferences.
 */
export default function Notifications() {
  const { notifications, markNotificationsRead, ready } = useAccount();
  useEffect(() => {
    const t = setTimeout(markNotificationsRead, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const unread = notifications.filter((n) => !n.read);
  const read = notifications.filter((n) => n.read);
  return (
    <Screen
      header={
        <PageHeader
          title="Notifications"
          onBack={() => router.back()}
          trailing={
            unread.length ? (
              <Pressable onPress={markNotificationsRead} accessibilityRole="button" hitSlop={8} style={styles.markRead} testID="mark-read">
                <Text variant="subhead" weight="semibold">
                  Mark all read
                </Text>
              </Pressable>
            ) : null
          }
        />
      }
    >
      {!ready ? (
        <SkeletonGroup label="Loading notifications">
          {[0, 1, 2].map((i) => (
            <SkeletonRow key={i} trailing={false} />
          ))}
        </SkeletonGroup>
      ) : notifications.length === 0 ? (
        <EmptyState icon="notification" title="You’re all caught up" body="Trip, payment and offer updates appear here." />
      ) : (
        <>
          {unread.length ? (
            <SettingsGroup title="New" inset={48}>
              {unread.map((n) => (
                <NotificationRow key={n.id} n={n} />
              ))}
            </SettingsGroup>
          ) : null}
          {read.length ? (
            <SettingsGroup title="Earlier" inset={48}>
              {read.map((n) => (
                <NotificationRow key={n.id} n={n} />
              ))}
            </SettingsGroup>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function NotificationRow({ n }: { n: AppNotification }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${n.read ? '' : 'New. '}${n.title}. ${n.body}. ${dateFmt(n.createdAt)}`}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
        <Icon name={ICON[n.kind]} size="sm" color="text" />
        {!n.read ? <View style={[styles.dot, { backgroundColor: colors.navActive, borderColor: colors.card }]} /> : null}
      </View>
      <View style={styles.texts}>
        <View style={styles.top}>
          <Text variant="callout" weight={n.read ? 'medium' : 'semibold'} style={styles.flex}>
            {n.title}
          </Text>
          <Text variant="caption" color="textSecondary">
            {dateFmt(n.createdAt)}
          </Text>
        </View>
        <Text variant="footnote" color="textSecondary">
          {n.body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: layout.iconGap, paddingVertical: spacing.md, alignItems: 'flex-start' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: -1, right: -1, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  markRead: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.xs },
  top: { flexDirection: 'row', gap: spacing.sm, alignItems: 'baseline' },
});
