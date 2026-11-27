import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text, radii, spacing, useTheme, useToast } from '@gobye/ui';
import { useHaptics } from '@/state/haptics';

/**
 * One line of bank details: a small label over the value (D-084). The value is the thing people need,
 * so it is the largest text in the row; "Copy" is a quiet pill beside it. Without `copy`, the same layout
 * with no button (bank, account name), so every row in a group lines up.
 */
export function CopyRow({ label, value, copyValue, spoken, testID, copy = true }: { label: string; value: string; copyValue?: string; spoken?: string; testID?: string; copy?: boolean }) {
  const toast = useToast();
  const haptic = useHaptics();
  const { colors } = useTheme();
  const doCopy = async () => {
    await Clipboard.setStringAsync(copyValue ?? value);
    haptic('selection');
    toast(`${label} copied`, 'success');
  };
  return (
    <View style={styles.row}>
      <View style={styles.flex} accessible accessibilityLabel={`${label}, ${spoken ?? value}`}>
        <Text variant="caption" color="textSecondary">
          {label}
        </Text>
        <Text variant={copy ? 'headline' : 'callout'} weight={copy ? 'bold' : 'medium'} tabular selectable>
          {value}
        </Text>
      </View>
      {copy ? (
        <Pressable
          onPress={doCopy}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${label}`}
          hitSlop={8}
          style={({ pressed }) => [styles.copy, { backgroundColor: pressed ? colors.secondaryPressed : colors.card, borderColor: colors.border }]}
          testID={testID}
        >
          <Icon name="copy" size={14} color="text" />
          <Text variant="footnote" weight="semibold">
            Copy
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth },
});
