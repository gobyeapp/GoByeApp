import { StyleSheet, View } from 'react-native';
import type { RelayConnection } from '@gobye/core';
import { Text } from '../Text';
import { useTheme } from '../../theme/useTheme';

const LABEL: Record<RelayConnection, string> = {
  off: 'Demo · this phone only',
  connecting: 'Demo · connecting…',
  online: 'Demo · connected',
  offline: 'Demo · relay unreachable',
};

/**
 * Where the demo's data lives (D-049): connected to the shared demo relay (so the other app and the
 * admin see it), connecting, unreachable, or this phone only. Always paired with text, never colour alone.
 */
export function ConnectionPill({ state, host, testID }: { state: RelayConnection; host?: string | null; testID?: string }) {
  const { colors } = useTheme();
  const dot = state === 'online' ? colors.success : state === 'offline' ? colors.danger : state === 'connecting' ? colors.warning : colors.textSecondary;
  const label = LABEL[state] + (host && state !== 'off' ? ` · ${host}` : '');
  return (
    <View style={[styles.pill, { backgroundColor: colors.surfaceMuted }]} accessible accessibilityLabel={label} testID={testID}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text variant="caption" weight="semibold" color="textSecondary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, maxWidth: '100%' },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
