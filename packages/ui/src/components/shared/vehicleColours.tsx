import { Pressable, StyleSheet, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing } from '../../theme/tokens';
import { Text } from '../Text';

/**
 * The paint colours a driver can pick for their vehicle (D-108), and the picture of each ride type in each
 * one (D-110). Picking from a fixed list (instead of typing) means the rider's screen can always show the
 * vehicle in that colour. The pictures are rendered by tools/3d/vehicles.py; add a colour in both places.
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

/** The four ride types that have a picture. A ride category id maps onto one ('go' is the car). */
export type VehicleArtType = 'keke' | 'car' | 'comfort' | 'xl';
const ART_TYPE: Record<string, VehicleArtType> = { keke: 'keke', go: 'car', car: 'car', comfort: 'comfort', xl: 'xl' };

// Rendered by tools/3d/vehicles.py: one picture for each ride type in each colour (D-110).
const VEHICLE_ART: Record<VehicleArtType, Record<VehicleColourId, ImageSourcePropType>> = {
  keke: {
    white: require('../../../assets/vehicles/keke-white.webp'),
    silver: require('../../../assets/vehicles/keke-silver.webp'),
    grey: require('../../../assets/vehicles/keke-grey.webp'),
    black: require('../../../assets/vehicles/keke-black.webp'),
    blue: require('../../../assets/vehicles/keke-blue.webp'),
    red: require('../../../assets/vehicles/keke-red.webp'),
    wine: require('../../../assets/vehicles/keke-wine.webp'),
    green: require('../../../assets/vehicles/keke-green.webp'),
    brown: require('../../../assets/vehicles/keke-brown.webp'),
    gold: require('../../../assets/vehicles/keke-gold.webp'),
    yellow: require('../../../assets/vehicles/keke-yellow.webp'),
    orange: require('../../../assets/vehicles/keke-orange.webp'),
  },
  car: {
    white: require('../../../assets/vehicles/car-white.webp'),
    silver: require('../../../assets/vehicles/car-silver.webp'),
    grey: require('../../../assets/vehicles/car-grey.webp'),
    black: require('../../../assets/vehicles/car-black.webp'),
    blue: require('../../../assets/vehicles/car-blue.webp'),
    red: require('../../../assets/vehicles/car-red.webp'),
    wine: require('../../../assets/vehicles/car-wine.webp'),
    green: require('../../../assets/vehicles/car-green.webp'),
    brown: require('../../../assets/vehicles/car-brown.webp'),
    gold: require('../../../assets/vehicles/car-gold.webp'),
    yellow: require('../../../assets/vehicles/car-yellow.webp'),
    orange: require('../../../assets/vehicles/car-orange.webp'),
  },
  comfort: {
    white: require('../../../assets/vehicles/comfort-white.webp'),
    silver: require('../../../assets/vehicles/comfort-silver.webp'),
    grey: require('../../../assets/vehicles/comfort-grey.webp'),
    black: require('../../../assets/vehicles/comfort-black.webp'),
    blue: require('../../../assets/vehicles/comfort-blue.webp'),
    red: require('../../../assets/vehicles/comfort-red.webp'),
    wine: require('../../../assets/vehicles/comfort-wine.webp'),
    green: require('../../../assets/vehicles/comfort-green.webp'),
    brown: require('../../../assets/vehicles/comfort-brown.webp'),
    gold: require('../../../assets/vehicles/comfort-gold.webp'),
    yellow: require('../../../assets/vehicles/comfort-yellow.webp'),
    orange: require('../../../assets/vehicles/comfort-orange.webp'),
  },
  xl: {
    white: require('../../../assets/vehicles/xl-white.webp'),
    silver: require('../../../assets/vehicles/xl-silver.webp'),
    grey: require('../../../assets/vehicles/xl-grey.webp'),
    black: require('../../../assets/vehicles/xl-black.webp'),
    blue: require('../../../assets/vehicles/xl-blue.webp'),
    red: require('../../../assets/vehicles/xl-red.webp'),
    wine: require('../../../assets/vehicles/xl-wine.webp'),
    green: require('../../../assets/vehicles/xl-green.webp'),
    brown: require('../../../assets/vehicles/xl-brown.webp'),
    gold: require('../../../assets/vehicles/xl-gold.webp'),
    yellow: require('../../../assets/vehicles/xl-yellow.webp'),
    orange: require('../../../assets/vehicles/xl-orange.webp'),
  },
};

/**
 * The picture of this ride type in this colour. An unknown colour gives the white one and an unknown
 * (or missing) category gives the car.
 */
export const carArt = (colourName: string | undefined | null, category?: string | null): ImageSourcePropType =>
  VEHICLE_ART[ART_TYPE[category ?? 'go'] ?? 'car'][vehicleColour(colourName)?.id ?? 'white'];

/** The picture that stands for a ride type when no driver is matched yet: a yellow keke, a white car. */
export const categoryArt = (category: string): ImageSourcePropType => carArt(category === 'keke' ? 'yellow' : 'white', category);

/** What to call the vehicle in a sentence: "keke" or "car". */
export const vehicleNoun = (category?: string | null): string => (category === 'keke' ? 'keke' : 'car');

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
