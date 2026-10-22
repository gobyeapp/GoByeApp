import { router } from 'expo-router';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNaira, type DriverTrip } from '@gobye/core';
import { EmptyState, Icon, StatusBadge, Text, layout, spacing, useTheme } from '@gobye/ui';
import { formatDay, formatTime } from '@/features/common/format';
import { SimNote } from '@/features/common/SimNote';
import { useDriver } from '@/state/driver';

const tripTime = (t: DriverTrip) => t.completedAt ?? t.cancelledAt ?? t.acceptedAt;

/** D16 Trip history, newest first, grouped by day. */
export default function Trips() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { history, historySeeded } = useDriver();
  const sorted = [...history].sort((a, b) => tripTime(b) - tripTime(a));
  const sections: { title: string; data: DriverTrip[] }[] = [];
  for (const t of sorted) {
    const title = formatDay(tripTime(t));
    const last = sections[sections.length - 1];
    if (last?.title === title) last.data.push(t);
    else sections.push({ title, data: [t] });
  }

  return (
    <SectionList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}
      sections={sections}
      keyExtractor={(t) => t.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <Text variant="title2" accessibilityRole="header" style={styles.title}>
          Trips
        </Text>
      }
      ListEmptyComponent={<EmptyState icon="activity" title="No trips yet" body="Trips you complete show up here with their fares." />}
      ListFooterComponent={historySeeded ? <View style={styles.footer}><SimNote>Earlier trips are sample data for the preview.</SimNote></View> : null}
      renderSectionHeader={({ section }) => (
        <Text variant="footnote" weight="medium" color="textSecondary" style={styles.section}>
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => {
        const cancelled = item.stage === 'cancelled';
        return (
          <Pressable
            onPress={() => router.push(`/history/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${formatTime(tripTime(item))}, ${item.pickup.title} to ${item.destination.title}, ${cancelled ? 'cancelled' : formatNaira(item.fare)}`}
            style={({ pressed }) => [styles.row, { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={[styles.icon, { backgroundColor: colors.card }]}>
              <Icon name={cancelled ? 'closeCircle' : 'car'} size="sm" color={cancelled ? 'textSecondary' : 'text'} />
            </View>
            <View style={styles.flex}>
              <Text variant="subhead" weight="semibold" numberOfLines={1}>
                {item.destination.title}
              </Text>
              <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                {formatTime(tripTime(item))} · from {item.pickup.title}
              </Text>
            </View>
            {cancelled ? (
              <StatusBadge kind="neutral" label={item.cancelReason === 'rider_no_show' ? 'No show' : 'Cancelled'} />
            ) : (
              <View style={styles.end}>
                <Text variant="headline" tabular>
                  {formatNaira(item.fare)}
                </Text>
                {item.paymentStatus === 'pending' ? <StatusBadge kind="pending" label="Pending" /> : null}
              </View>
            )}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.page, paddingBottom: spacing.xxl, gap: spacing.sm },
  title: { paddingTop: spacing.xs, marginBottom: spacing.sm },
  section: { marginTop: spacing.lg, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: layout.controlRadius, minHeight: 64 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  end: { alignItems: 'flex-end', gap: 2 },
  footer: { marginTop: spacing.lg },
});
