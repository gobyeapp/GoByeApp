import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { minTouch, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  /** Words shown beside the spinner while loading (e.g. "Paying"), so progress isn't just a spinner. */
  loadingLabel?: string;
  leadingIcon?: IconName;
  trailingText?: string;
  /** Spoken label when it should differ from the title (e.g. include a fare spoken in naira). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled,
  loading,
  loadingLabel,
  leadingIcon,
  trailingText,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;

  // A disabled primary button switches to a neutral fill with readable grey text, instead of a faded
  // green that looks half-enabled in dark mode (device feedback 2026-10-21).
  const disabledPrimary = disabled && !loading && variant === 'primary';
  const palette = {
    primary: disabledPrimary
      ? { bg: colors.secondary, pressed: colors.secondary, fg: 'textSecondary' as const, border: 'transparent' }
      : { bg: colors.primary, pressed: colors.primaryPressed, fg: 'onPrimary' as const, border: 'transparent' },
    secondary: { bg: colors.secondary, pressed: colors.secondaryPressed, fg: 'onSecondary' as const, border: 'transparent' },
    tertiary: { bg: 'transparent', pressed: colors.surfaceMuted, fg: 'primary' as const, border: 'transparent' },
    destructive: { bg: colors.dangerSurface, pressed: colors.secondaryPressed, fg: 'danger' as const, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (trailingText ? `${title}, ${trailingText}` : title)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: size === 'lg' ? 52 : minTouch,
          backgroundColor: pressed ? palette.pressed : palette.bg,
          borderColor: palette.border,
          opacity: disabled && !loading && !disabledPrimary ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading && loadingLabel ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors[palette.fg]} accessibilityElementsHidden />
          <Text variant="headline" color={palette.fg} style={styles.title}>
            {loadingLabel}
          </Text>
        </View>
      ) : loading ? (
        <ActivityIndicator color={colors[palette.fg]} accessibilityElementsHidden />
      ) : (
        <View style={styles.row}>
          {leadingIcon ? <Icon name={leadingIcon} size="sm" color={palette.fg} /> : null}
          <Text variant="headline" color={palette.fg} style={styles.title}>
            {title}
          </Text>
          {trailingText ? (
            <Text variant="headline" color={palette.fg} tabular>
              {trailingText}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  title: { textAlign: 'center' },
});
