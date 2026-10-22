import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, EmptyState, Illustration, Screen, ScreenHeader, Text, layout, spacing, useTheme } from '@gobye/ui';
import { usePromotion } from '@/features/promo/usePromotions';

/** Offer page: what the promotion is, how it works in three short steps, and one action. */
export default function PromoDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const promo = usePromotion(String(id));
  const { colors } = useTheme();
  if (!promo) {
    return (
      <Screen header={<ScreenHeader title="Offer" onBack={() => router.back()} />}>
        <EmptyState icon="gift" title="This offer has ended" actionLabel="Back to Home" onAction={() => router.replace('/(tabs)')} />
      </Screen>
    );
  }
  return (
    <Screen
      header={<ScreenHeader title="" onBack={() => router.back()} />}
      footer={<Button title={promo.action.label} onPress={() => router.replace(promo.action.route as never)} testID="promo-action" />}
    >
      <View style={styles.body}>
        <View style={[styles.hero, { backgroundColor: colors.brandBanner }]}>
          <Illustration name={promo.art} size={150} />
        </View>
        <View style={styles.copy}>
          <Text variant="title1" accessibilityRole="header">
            {promo.title}
          </Text>
          <Text variant="body" color="textSecondary">
            {promo.body}
          </Text>
        </View>
        <View style={[styles.steps, { backgroundColor: colors.surfaceMuted }]}>
          {promo.details.map((d, i) => (
            <View key={d} style={styles.step}>
              <View style={[styles.num, { backgroundColor: colors.card }]}>
                <Text variant="caption" weight="bold">
                  {i + 1}
                </Text>
              </View>
              <Text variant="callout" style={styles.flex}>
                {d}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { gap: layout.section, paddingBottom: spacing.lg },
  hero: { borderRadius: 24, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  copy: { gap: spacing.xs },
  steps: { borderRadius: 18, padding: layout.container, gap: spacing.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
