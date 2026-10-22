import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { minTouch, radii, spacing, type ColorTokens } from '../theme/tokens';
import { Text } from './Text';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  leadingIcon?: IconName;
  leadingIconColor?: keyof ColorTokens;
  /** Circular tinted background behind the leading icon. */
  leadingBadge?: boolean;
  trailing?: 'chevron' | 'none' | ReactNode;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  accessibilityHint?: string;
  testID?: string;
}

export function ListItem({
  title,
  subtitle,
  leadingIcon,
  leadingIconColor,
  leadingBadge,
  trailing = 'none',
  value,
  onPress,
  destructive,
  accessibilityHint,
  testID,
}: ListItemProps) {
  const { colors } = useTheme();
  const content = (
    <>
      {leadingIcon ? (
        <View style={[styles.leading, leadingBadge && { backgroundColor: colors.surfaceMuted }]}>
          <Icon name={leadingIcon} color={leadingIconColor ?? (destructive ? 'danger' : 'text')} />
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text variant="body" weight="medium" color={destructive ? 'danger' : 'text'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textSecondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="subhead" color="textSecondary" tabular>
          {value}
        </Text>
      ) : null}
      {trailing === 'chevron' ? <Icon name="chevronRight" color="textSecondary" /> : trailing === 'none' ? null : trailing}
    </>
  );

  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTouch + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
  },
  leading: { width: 40, height: 40, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
});
