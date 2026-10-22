import * as Clipboard from 'expo-clipboard';
import { StyleSheet, View } from 'react-native';
import { Button, Text, spacing, useToast } from '@gobye/ui';
import { useHaptics } from '@/state/haptics';

/** Label + value with a copy control (bank details, referral code/link). */
export function CopyRow({ label, value, copyValue, spoken, testID }: { label: string; value: string; copyValue?: string; spoken?: string; testID?: string }) {
  const toast = useToast();
  const haptic = useHaptics();
  const copy = async () => {
    await Clipboard.setStringAsync(copyValue ?? value);
    haptic('selection');
    toast(`${label} copied`, 'success');
  };
  return (
    <View style={styles.row}>
      <View style={styles.flex} accessible accessibilityLabel={`${label}, ${spoken ?? value}`}>
        <Text variant="footnote" color="textSecondary">
          {label}
        </Text>
        <Text variant="headline" tabular selectable>
          {value}
        </Text>
      </View>
      <Button title="Copy" size="md" variant="secondary" leadingIcon="copy" onPress={copy} accessibilityLabel={`Copy ${label}`} testID={testID} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  flex: { flex: 1 },
});
