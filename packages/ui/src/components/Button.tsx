import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { darkColors, lightColors, minTouch, spacing } from '../theme/tokens';
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
  /**
   * Forward-action chip at the end of the button (website hero style): a small round contrasting disc
   * with an icon, e.g. `arrowRight` on "Create account". The title stays optically centred.
   */
  trailingIcon?: IconName;
  trailingText?: string;
  /** Spoken label when it should differ from the title (e.g. include a fare spoken in naira). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Force a palette regardless of the app appearance (e.g. the always-dark welcome screen). */
  appearance?: 'light' | 'dark';
}

/**
 * GoBye button. Pill shape (matches the website and the auth design), 56 pt tall at `lg`.
 * Primary: solid ink (black in light, white in dark) with a soft, low shadow in light mode.
 * Secondary: neutral fill with a hairline edge. Tertiary: text only. Press: a gentle spring to 97 %
 * (none under Reduce Motion) plus the pressed colour, so feedback never relies on motion alone.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled,
  loading,
  loadingLabel,
  leadingIcon,
  trailingIcon,
  trailingText,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
  appearance,
}: ButtonProps) {
  const theme = useTheme();
  const scheme = appearance ?? theme.scheme;
  const colors = appearance ? (appearance === 'dark' ? darkColors : lightColors) : theme.colors;
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const inactive = disabled || loading;

  // A disabled primary button switches to a neutral fill with readable grey text, instead of a faded
  // colour that looks half-enabled in dark mode (device feedback 2026-10-21).
  const disabledPrimary = disabled && !loading && variant === 'primary';
  const palette = {
    primary: disabledPrimary
      ? { bg: colors.secondary, pressed: colors.secondary, fg: 'textSecondary' as const, border: 'transparent' }
      : { bg: colors.primary, pressed: colors.primaryPressed, fg: 'onPrimary' as const, border: 'transparent' },
    secondary: { bg: colors.secondary, pressed: colors.secondaryPressed, fg: 'onSecondary' as const, border: colors.border },
    tertiary: { bg: 'transparent', pressed: colors.surfaceMuted, fg: 'primary' as const, border: 'transparent' },
    destructive: { bg: colors.dangerSurface, pressed: colors.secondaryPressed, fg: 'danger' as const, border: 'transparent' },
  }[variant];
  const raised = variant === 'primary' && !disabledPrimary && scheme === 'light';
  const height = size === 'lg' ? 56 : minTouch;
  const chip = trailingIcon && !loading;
  const chipSize = size === 'lg' ? 40 : 32;

  const pressIn = () => {
    if (!reduce) scale.value = withSpring(0.97, { damping: 18, stiffness: 420, mass: 0.6 });
  };
  const pressOut = () => {
    scale.value = reduce ? withTiming(1, { duration: 0 }) : withSpring(1, { damping: 14, stiffness: 320, mass: 0.6 });
  };

  return (
    // Scale lives on a wrapper (layout `style` from callers goes there too), so the pressable keeps plain styles.
    <Animated.View style={[pressStyle, style]}>
    <Pressable
      testID={testID}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (trailingText ? `${title}, ${trailingText}` : title)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: height,
          paddingHorizontal: chip ? chipSize + spacing.md + 4 : size === 'lg' ? spacing.xxl : spacing.xl,
          backgroundColor: pressed ? palette.pressed : palette.bg,
          borderColor: palette.border,
          borderWidth: palette.border === 'transparent' ? 0 : StyleSheet.hairlineWidth,
          opacity: disabled && !loading && !disabledPrimary ? 0.45 : 1,
        },
        raised && (pressed ? styles.shadowPressed : styles.shadow),
      ]}
    >
      {loading && loadingLabel ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors[palette.fg]} accessibilityElementsHidden />
          <Text variant="headline" style={[styles.title, { color: colors[palette.fg] }]}>
            {loadingLabel}
          </Text>
        </View>
      ) : loading ? (
        <ActivityIndicator color={colors[palette.fg]} accessibilityElementsHidden />
      ) : (
        <View style={styles.row}>
          {leadingIcon ? <Icon name={leadingIcon} size="sm" color={colors[palette.fg]} /> : null}
          <Text variant="headline" style={[styles.title, { color: colors[palette.fg] }]}>
            {title}
          </Text>
          {trailingText ? (
            <Text variant="headline" tabular style={{ color: colors[palette.fg] }}>
              {trailingText}
            </Text>
          ) : null}
        </View>
      )}
      {chip ? (
        <View
          style={[styles.chip, { width: chipSize, height: chipSize, borderRadius: chipSize / 2, marginTop: -chipSize / 2, right: (height - chipSize) / 2, backgroundColor: colors[palette.fg] }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name={trailingIcon} size={size === 'lg' ? 18 : 16} color={variant === 'primary' && !disabledPrimary ? colors.primary : colors.background} />
        </View>
      ) : null}
    </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadow: { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  shadowPressed: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  title: { textAlign: 'center', letterSpacing: -0.1 },
  chip: { position: 'absolute', top: '50%', alignItems: 'center', justifyContent: 'center' },
});
