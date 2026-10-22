import { StyleSheet, View } from 'react-native';
import { SimulatedBadge, Text, spacing } from '@gobye/ui';

/** One line explaining what is simulated in this preview, with the standard badge (never present mock data as live). */
export function SimNote({ children }: { children: string }) {
  return (
    <View style={styles.row}>
      <SimulatedBadge />
      <Text variant="footnote" color="textSecondary" style={styles.flex}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, flex: { flex: 1 } });
