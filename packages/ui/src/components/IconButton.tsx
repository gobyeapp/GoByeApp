import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { minTouch, radii, shadows, type ColorTokens } from '../theme/tokens';

export interface IconButtonProps {
  icon: IconName;
  /** Required: icon-only controls must have a spoken label. */
  accessibilityLabel: string;
  onPress: () => void;
  variant?: 'plain' | 'filled' | 'floating';
  iconVariant?: 'regular' | 'filled';
  color?: keyof ColorTokens;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'plain',
  iconVariant,
  color = 'text',
  disabled,
  style,
  testID,
}: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        variant !== 'plain' && { backgroundColor: pressed ? colors.surfaceMuted : variant === 'filled' ? colors.surfaceMuted : colors.surface },
        variant === 'plain' && pressed && { backgroundColor: colors.surfaceMuted },
        variant === 'floating' && shadows.float,
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      <Icon name={icon} variant={iconVariant} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: minTouch,
    height: minTouch,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
