import { StyleSheet, View } from 'react-native';
import type { Vehicle } from '@gobye/core';
import { Illustration, Text, spacing, useTheme } from '@gobye/ui';

const COLOUR_SWATCH: Record<string, string> = {
  white: '#F5F5F5',
  black: '#1A1A1A',
  silver: '#C0C3C8',
  grey: '#7C8088',
  gray: '#7C8088',
  blue: '#2F5DA8',
  red: '#B3261E',
  yellow: '#F2C200',
  green: '#2E7D4F',
  brown: '#6D4C3D',
  gold: '#C8A84B',
};

/**
 * Vehicle summary for transport screens (brief §5, §7). The illustration is a generic car render for
 * the category; the text — colour, make/model and registration — is the actual assigned vehicle, and
 * a swatch shows the real colour so the picture never misrepresents it.
 */
export function VehicleSummary({ vehicle, size = 'md' }: { vehicle: Vehicle; size?: 'sm' | 'md' | 'lg' }) {
  const { colors } = useTheme();
  const swatch = COLOUR_SWATCH[vehicle.colour.toLowerCase()] ?? colors.textSecondary;
  const art = size === 'lg' ? 172 : size === 'md' ? 120 : 72;
  const label = `${vehicle.colour} ${vehicle.make} ${vehicle.model}, registration ${vehicle.plate}`;
  if (size === 'lg') {
    // car.jpg: car centred, then one line "Colour Make Model · PLATE" with the plate kept legible.
    return (
      <View style={styles.root} accessible accessibilityLabel={label}>
        <Illustration name="sedan" size={art} style={styles.art} />
        <View style={styles.lgLine}>
          <View style={[styles.swatch, { backgroundColor: swatch, borderColor: colors.textSecondary }]} />
          <Text variant="headline">
            {vehicle.colour} {vehicle.make} {vehicle.model}
          </Text>
          <View style={[styles.dot, { backgroundColor: colors.border }]} />
          <View style={[styles.plate, { borderColor: colors.text }]}>
            <Text variant="subhead" weight="bold" tabular>
              {vehicle.plate}
            </Text>
          </View>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.root, size === 'sm' && styles.rowLayout]} accessible accessibilityLabel={label}>
      <Illustration name="sedan" size={art} style={size === 'sm' ? undefined : styles.art} />
      <View style={[styles.texts, size === 'sm' && styles.textsLeft]}>
        <View style={styles.inline}>
          <View style={[styles.swatch, { backgroundColor: swatch, borderColor: colors.textSecondary }]} />
          <Text variant="subhead" weight="semibold">
            {vehicle.colour} {vehicle.make} {vehicle.model}
          </Text>
        </View>
        <View style={[styles.plate, { borderColor: colors.text, backgroundColor: colors.surface }]}>
          <Text variant="subhead" weight="bold" tabular>
            {vehicle.plate}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.sm },
  rowLayout: { flexDirection: 'row', gap: spacing.md },
  art: { marginVertical: -spacing.lg },
  lgLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  texts: { alignItems: 'center', gap: spacing.xs },
  textsLeft: { alignItems: 'flex-start', flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  plate: { borderWidth: 1.5, borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
});
