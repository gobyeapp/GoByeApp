import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { darkColors, lightColors, minTouch, spacing } from '../theme/tokens';
import { Text } from './Text';

/** `brand`: the website's tangerine CTA (gradient, dark label, white arrow chip) for signature moments such as sign-up. */
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
  const disabledPrimary = disabled && !loading && (variant === 'primary' || variant === 'brand');
  const palette = {
    brand: disabledPrimary
      ? { bg: colors.secondary, pressed: colors.secondary, fg: 'textSecondary' as const, border: 'transparent' }
      : { bg: BRAND_CTA.mid, pressed: BRAND_CTA.mid, fg: 'text' as const, border: BRAND_CTA.border },
    primary: disabledPrimary
      ? { bg: colors.secondary, pressed: colors.secondary, fg: 'textSecondary' as const, border: 'transparent' }
      : { bg: colors.primary, pressed: colors.primaryPressed, fg: 'onPrimary' as const, border: 'transparent' },
    secondary: { bg: colors.secondary, pressed: colors.secondaryPressed, fg: 'onSecondary' as const, border: colors.border },
    tertiary: { bg: 'transparent', pressed: colors.surfaceMuted, fg: 'primary' as const, border: 'transparent' },
    destructive: { bg: colors.dangerSurface, pressed: colors.secondaryPressed, fg: 'danger' as const, border: 'transparent' },
  }[variant];
  const brandOn = variant === 'brand' && !disabledPrimary;
  const raised = variant === 'primary' && !disabledPrimary && scheme === 'light';
  // Label colour: the brand CTA always uses its dark ink on tangerine, in both themes.
  const fg = brandOn ? BRAND_CTA.ink : colors[palette.fg];
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
    <Animated.View style={[pressStyle, brandOn && styles.brandShadow, style]}>
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
          borderWidth: palette.border === 'transparent' ? 0 : brandOn ? 1 : StyleSheet.hairlineWidth,
          overflow: brandOn ? 'hidden' : undefined,
          opacity: disabled && !loading && !disabledPrimary ? 0.45 : 1,
        },
        raised && (pressed ? styles.shadowPressed : styles.shadow),
        brandOn && pressed && { opacity: 0.92 },
      ]}
    >
      {brandOn ? (
        // Website .btn-primary: #ffb27e → #ff9652 → #ff8438 top to bottom, with a 1 px light top edge.
        <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100" pointerEvents="none">
          <Defs>
            <LinearGradient id="gobye-cta" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={BRAND_CTA.top} />
              <Stop offset="0.52" stopColor={BRAND_CTA.mid} />
              <Stop offset="1" stopColor={BRAND_CTA.bottom} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill="url(#gobye-cta)" />
          <Rect x="0" y="0" width="100" height="1.6" fill="#FFFFFF" opacity={0.45} />
        </Svg>
      ) : null}
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
          {leadingIcon ? <Icon name={leadingIcon} size="sm" color={fg} /> : null}
          <Text variant="headline" style={[styles.title, { color: fg }]}>
            {title}
          </Text>
          {trailingText ? (
            <Text variant="headline" tabular style={{ color: fg }}>
              {trailingText}
            </Text>
          ) : null}
        </View>
      )}
      {chip ? (
        <View
          style={[styles.chip, { width: chipSize, height: chipSize, borderRadius: chipSize / 2, marginTop: -chipSize / 2, right: (height - chipSize) / 2, backgroundColor: brandOn ? '#FFFFFF' : disabledPrimary ? colors.border : fg }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name={trailingIcon} size={size === 'lg' ? 18 : 16} color={brandOn ? BRAND_CTA.ink : disabledPrimary ? colors.textSecondary : variant === 'primary' ? colors.primary : colors.background} />
        </View>
      ) : null}
    </Pressable>
    </Animated.View>
  );
}

/** The website CTA palette (styles.css .btn-primary). */
const BRAND_CTA = { top: '#FFB27E', mid: '#FF9652', bottom: '#FF8438', ink: '#1C0E05', border: 'rgba(214, 92, 18, 0.2)' };

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadow: { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  brandShadow: { borderRadius: 999, shadowColor: '#FF751F', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  shadowPressed: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  title: { textAlign: 'center', letterSpacing: -0.1 },
  chip: { position: 'absolute', top: '50%', alignItems: 'center', justifyContent: 'center' },
});
