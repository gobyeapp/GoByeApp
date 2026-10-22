import { StyleSheet, View } from 'react-native';
import { Badge, Card, EmptyState, Screen, Text, Wordmark, spacing } from '@gobye/ui';

/** D01 placeholder — the Driver app is Phase 4 (docs/IMPLEMENTATION_PLAN.md). */
export default function DriverHome() {
  return (
    <Screen>
      <View style={styles.header}>
        <Wordmark size={32} />
        <Text variant="title3">Driver</Text>
      </View>
      <EmptyState icon="steering" title="GoBye Driver is coming next" body="Driver sign up, requests and trips are in progress." />
      <Card>
        <Badge label="In development" icon="info" tone="warning" />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ header: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.xxl } });
