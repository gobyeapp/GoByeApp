import { StyleSheet, View } from 'react-native';
/** Structural vehicle shape (matches @gobye/core Vehicle) so the design system stays independent of core. */
export interface VehicleLike {
  colour: string;
  make: string;
  model: string;
  plate: string;
  /** Ride category id (keke, go, comfort, xl); picks which vehicle is drawn. */
  category?: string;
}
import { Illustration } from '../../brand';
import { Text } from '../Text';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { carArt, vehicleColour } from './vehicleColours';


/**
 * Vehicle summary for transport screens (brief §5, §7). The picture is the driver's ride type (keke, car,
 * comfort or XL, D-110) in the driver's own colour (D-108); the text (colour, make and model,
 * registration) is the actual vehicle. The make and exact shape in the picture are not the driver's own.
 */
export function VehicleSummary({ vehicle, size = 'md' }: { vehicle: VehicleLike; size?: 'sm' | 'md' | 'lg' }) {
  const { colors } = useTheme();
  const swatch = vehicleColour(vehicle.colour)?.hex ?? colors.textSecondary;
  // The car is drawn in the driver's own colour, so it is easier to spot at the kerb (D-108).
  const car = carArt(vehicle.colour, vehicle.category);
  const art = size === 'lg' ? 172 : size === 'md' ? 120 : 72;
  const label = `${vehicle.colour} ${vehicle.make} ${vehicle.model}, registration ${vehicle.plate}`;
  if (size === 'lg') {
    // car.jpg: car centred, then one line "Colour Make Model · PLATE" with the plate kept legible.
    return (
      <View style={styles.root} accessible accessibilityLabel={label}>
        <Illustration name="sedan" source={car} size={art} style={styles.art} />
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
      <Illustration name="sedan" source={car} size={art} style={size === 'sm' ? undefined : styles.art} />
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
