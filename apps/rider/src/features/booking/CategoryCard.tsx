import { Pressable, StyleSheet, View } from 'react-native';
import { formatDuration, formatNaira, nairaAccessibilityLabel, type CategoryConfig, type Kobo } from '@gobye/core';
import { Illustration, Text, layout, spacing, useTheme } from '@gobye/ui';

/**
 * Vehicle category option (brief §5). Categories and names come from admin config — at launch
 * exactly one car category is enabled. Shows a car render appropriate to the category; the actual
 * vehicle (colour, model, plate) is shown once a driver is matched.
 */
export function CategoryCard({
  category,
  fare,
  etaSeconds,
  available,
  reason,
  selected,
  single,
  onSelect,
}: {
  category: CategoryConfig;
  fare: Kobo | null;
  etaSeconds?: number;
  available: boolean;
  reason?: string;
  selected: boolean;
  /** Only one category enabled: render as an informative card, not a radio choice. */
  single?: boolean;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  const subtitle = available ? `${category.seats} seats · ${formatDuration(etaSeconds ?? 300)} away` : (reason ?? 'Unavailable right now');
  const label = `${category.name}. ${subtitle}.${fare !== null ? ` ${nairaAccessibilityLabel(fare)}.` : ''}`;
  return (
    <Pressable
      onPress={onSelect}
      disabled={!available || single}
      accessibilityRole={single ? undefined : 'radio'}
      accessibilityState={single ? undefined : { selected, disabled: !available }}
      accessible
      accessibilityLabel={label}
      testID={`vehicle-${category.id}`}
      style={[
        styles.card,
        {
          backgroundColor: selected ? colors.surfaceSelected : colors.card,
          borderColor: selected ? colors.primary : colors.border,
          opacity: available ? 1 : 0.55,
        },
      ]}
    >
      <Illustration name={category.image} size={84} style={styles.art} />
      <View style={styles.flex}>
        <Text variant="headline">{category.name}</Text>
        <Text variant="footnote" color="textSecondary">
          {category.description}
        </Text>
        <Text variant="footnote" color="textSecondary">
          {subtitle}
        </Text>
      </View>
      {fare !== null ? (
        <Text variant="title3" tabular>
          {formatNaira(fare)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: layout.cardRadius, borderWidth: 1.5, paddingVertical: spacing.sm, paddingRight: layout.container, paddingLeft: spacing.sm, minHeight: 96 },
  art: { marginVertical: -spacing.xs },
});
