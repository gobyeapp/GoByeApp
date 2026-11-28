import { Pressable, StyleSheet, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing } from '../../theme/tokens';
import { Text } from '../Text';

/**
 * The paint colours a driver can pick for their car (D-108), and the car picture in each one. Picking
 * from a fixed list (instead of typing) means the rider's screen can always show the car in that colour.
 * The pictures are made by tools/tint-cars.py from the white render; add a colour in both places.
 */
export const VEHICLE_COLOURS = [
  { id: 'white', name: 'White', hex: '#F5F5F5' },
  { id: 'silver', name: 'Silver', hex: '#BFC3C9' },
  { id: 'grey', name: 'Grey', hex: '#74787F' },
  { id: 'black', name: 'Black', hex: '#1B1B1D' },
  { id: 'blue', name: 'Blue', hex: '#2456A6' },
  { id: 'red', name: 'Red', hex: '#B3261E' },
  { id: 'wine', name: 'Wine', hex: '#6E1423' },
  { id: 'green', name: 'Green', hex: '#2E7D4F' },
  { id: 'brown', name: 'Brown', hex: '#6B4A3A' },
  { id: 'gold', name: 'Gold', hex: '#C4A24A' },
  { id: 'yellow', name: 'Yellow', hex: '#F0C419' },
  { id: 'orange', name: 'Orange', hex: '#E8731A' },
] as const;
export type VehicleColourId = (typeof VEHICLE_COLOURS)[number]['id'];

const ALIASES: Record<string, VehicleColourId> = { gray: 'grey', maroon: 'wine', burgundy: 'wine', ash: 'grey', cream: 'white', navy: 'blue', beige: 'gold' };

/** The listed colour for what a driver typed or picked ("Silver", "gray", "Maroon"), or null if it isn't one. */
export function vehicleColour(name: string | undefined | null) {
  const k = (name ?? '').trim().toLowerCase();
  const id = (ALIASES[k] ?? k) as VehicleColourId;
  return VEHICLE_COLOURS.find((c) => c.id === id) ?? null;
}

const CAR_ART: Record<VehicleColourId, ImageSourcePropType> = {
  white: require('../../../assets/brand/sedan.webp'),
  silver: require('../../../assets/cars/sedan-silver.webp'),
  grey: require('../../../assets/cars/sedan-grey.webp'),
  black: require('../../../assets/cars/sedan-black.webp'),
  blue: require('../../../assets/cars/sedan-blue.webp'),
  red: require('../../../assets/cars/sedan-red.webp'),
  wine: require('../../../assets/cars/sedan-wine.webp'),
  green: require('../../../assets/cars/sedan-green.webp'),
  brown: require('../../../assets/cars/sedan-brown.webp'),
  gold: require('../../../assets/cars/sedan-gold.webp'),
  yellow: require('../../../assets/cars/sedan-yellow.webp'),
  orange: require('../../../assets/cars/sedan-orange.webp'),
};

/** The car picture in this colour; the white one when the colour isn't on the list. */
export const carArt = (colourName: string | undefined | null): ImageSourcePropType => CAR_ART[vehicleColour(colourName)?.id ?? 'white'];

/** Pick the car's colour from swatches. The value is the colour's name ("Silver"). */
export function ColourPicker({ label, value, onChange, error, testID }: { label: string; value: string; onChange: (name: string) => void; error?: string; testID?: string }) {
  const { colors } = useTheme();
  const chosen = vehicleColour(value)?.id;
  return (
    <View style={styles.root} accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID}>
      <Text variant="subhead" weight="medium">
        {label}
        {chosen ? (
          <Text variant="subhead" color="textSecondary">
            {'  '}
            {vehicleColour(value)!.name}
          </Text>
        ) : null}
      </Text>
      <View style={styles.grid}>
        {VEHICLE_COLOURS.map((c) => {
          const on = c.id === chosen;
          return (
            <Pressable key={c.id} onPress={() => onChange(c.name)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={c.name} testID={testID ? `${testID}-${c.id}` : undefined} hitSlop={4} style={[styles.ring, { borderColor: on ? colors.text : 'transparent' }]}>
              <View style={[styles.dot, { backgroundColor: c.hex, borderColor: colors.borderStrong }]} />
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text variant="footnote" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  ring: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 32, height: 32, borderRadius: 16, borderWidth: 1 },
});
