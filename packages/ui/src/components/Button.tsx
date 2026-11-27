import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { darkColors, lightColors, minTouch, spacing } from '../theme/tokens';
import { Text } from './Text';

/** `primary` and `brand` are the same button: the website's tangerine call to action (D-102). */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'brand';

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
  /** Filled glyph for the leading icon (brand logos such as Apple and Google read better solid). */
  leadingIconFilled?: boolean;
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
 * GoBye button. Pill shape, 56 pt tall at `lg`.
 * Primary (D-102): the website's call to action. A soft tangerine gradient (lighter at the top), a warm
 * glow under it and a dark label. No arrow chip.
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
  leadingIconFilled,
  trailingIcon,
  trailingText,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
  appearance,
}: ButtonProps) {
  const theme = useTheme();
  const colors = appearance ? (appearance === 'dark' ? darkColors : lightColors) : theme.colors;
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const inactive = disabled || loading;

  // A disabled primary button switches to a neutral fill with readable grey text, instead of a faded
  // colour that looks half-enabled in dark mode (device feedback 2026-10-21).
  const disabledPrimary = disabled && !loading && (variant === 'primary' || variant === 'brand');
  const palette = {
    brand: disabledPrimary
      ? { bg: colors.secondary, pressed: colors.secondary, fg: 'textSecondary' as const, border: 'transparent' }
      : { bg: BRAND_CTA.fill, pressed: BRAND_CTA.pressed, fg: 'text' as const, border: 'transparent' },
    primary: disabledPrimary
      ? { bg: colors.secondary, pressed: colors.secondary, fg: 'textSecondary' as const, border: 'transparent' }
      : { bg: colors.primary, pressed: colors.primaryPressed, fg: 'onPrimary' as const, border: 'transparent' },
    secondary: { bg: colors.secondary, pressed: colors.secondaryPressed, fg: 'onSecondary' as const, border: colors.border },
    tertiary: { bg: 'transparent', pressed: colors.surfaceMuted, fg: 'primary' as const, border: 'transparent' },
    destructive: { bg: colors.dangerSurface, pressed: colors.secondaryPressed, fg: 'danger' as const, border: 'transparent' },
  }[variant];
  const brandOn = (variant === 'brand' || variant === 'primary') && !disabledPrimary;
  // Label colour: the call to action always uses its dark ink on tangerine, in both themes.
  const fg = brandOn ? BRAND_CTA.ink : colors[palette.fg];
  // No arrow chip on the main button (owner, D-102): the label alone says what happens.
  const chipIcon: IconName | undefined = variant === 'primary' || variant === 'brand' ? undefined : trailingIcon;
  const height = size === 'lg' ? 56 : minTouch;
  const chip = !!chipIcon && !loading;
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
          backgroundColor: brandOn ? BRAND_CTA.fill : pressed ? palette.pressed : palette.bg,
          borderColor: palette.border,
          borderWidth: palette.border === 'transparent' ? 0 : StyleSheet.hairlineWidth,
          opacity: disabled && !loading && !disabledPrimary ? 0.45 : 1,
        },
        brandOn && (pressed ? styles.glowPressed : styles.glow),
      ]}
    >
      {({ pressed }) => (
        <>
      {brandOn ? <Gradient pressed={pressed} /> : null}
      {loading && loadingLabel ? (
        <View style={styles.row}>
          <ActivityIndicator color={fg} accessibilityElementsHidden />
          <Text variant="headline" style={[styles.title, { color: fg }]}>
            {loadingLabel}
          </Text>
        </View>
      ) : loading ? (
        <ActivityIndicator color={fg} accessibilityElementsHidden />
      ) : (
        <View style={styles.row}>
          {leadingIcon ? <Icon name={leadingIcon} variant={leadingIconFilled ? 'filled' : 'regular'} size="sm" color={fg} /> : null}
          <Text variant="headline" style={[styles.title, { color: fg }]}>
            {title}
          </Text>
          {trailingText ? (
            // The amount sits in its own box, so the eye separates "what happens" from "how much" (D-102).
            <View style={[styles.amount, { backgroundColor: brandOn ? '#FFFFFF' : disabledPrimary ? colors.border : colors.surfaceMuted }]}>
              <Text variant="headline" tabular style={{ color: brandOn ? BRAND_CTA.ink : fg }}>
                {trailingText}
              </Text>
            </View>
          ) : null}
        </View>
      )}
      {chipIcon && !loading ? (
        <View
          style={[styles.chip, { width: chipSize, height: chipSize, borderRadius: chipSize / 2, marginTop: -chipSize / 2, right: (height - chipSize) / 2, backgroundColor: brandOn ? '#FFFFFF' : disabledPrimary ? colors.border : fg }, brandOn && styles.chipShadow]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name={chipIcon} size={size === 'lg' ? 18 : 16} color={brandOn ? BRAND_CTA.ink : disabledPrimary ? colors.textSecondary : colors.background} />
        </View>
      ) : null}
        </>
      )}
    </Pressable>
    </Animated.View>
  );
}

/** The website's call to action (styles.css .btn-primary): light at the top, brand tangerine at the bottom. */
const BRAND_CTA = { top: '#FFB07A', fill: '#FF751F', pressedTop: '#FF9A5A', pressed: '#EE6710', ink: '#1C0E05' };

/** The gradient is a drawing behind the label, clipped to the pill by the button's own rounded corners. */
function Gradient({ pressed }: { pressed: boolean }) {
  return (
    <View style={styles.gradient} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="gobye-cta" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={pressed ? BRAND_CTA.pressedTop : BRAND_CTA.top} />
            <Stop offset="1" stopColor={pressed ? BRAND_CTA.pressed : BRAND_CTA.fill} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#gobye-cta)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradient: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 999, overflow: 'hidden' },
  glow: { shadowColor: '#FF751F', shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  glowPressed: { shadowColor: '#FF751F', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  chipShadow: { shadowColor: '#7A2E00', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  title: { textAlign: 'center', letterSpacing: -0.1 },
  amount: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: 999 },
  chip: { position: 'absolute', top: '50%', alignItems: 'center', justifyContent: 'center' },
});
