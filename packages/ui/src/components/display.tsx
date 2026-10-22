import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { layout, minTouch, radii, shadows, spacing, type ColorTokens } from '../theme/tokens';
import { Text } from './Text';
import { Button } from './Button';
import { BRAND_NAME, BrandMark, Illustration, type IllustrationName } from '../brand';

/* ---------- Card ---------- */

export function Card({
  children,
  selected,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { colors, scheme } = useTheme();
  const base = [
    styles.card,
    !selected && scheme === 'light' ? shadows.card : null,
    { backgroundColor: selected ? colors.surfaceSelected : colors.card, borderColor: selected ? colors.primary : colors.border },
    style,
  ];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

/* ---------- Badge ---------- */

export function Badge({ label, icon, tone = 'neutral' }: { label: string; icon?: IconName; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' }) {
  const { colors } = useTheme();
  const map: Record<string, { bg: string; fg: keyof ColorTokens }> = {
    neutral: { bg: colors.surfaceMuted, fg: 'textSecondary' },
    success: { bg: colors.successSurface, fg: 'success' },
    warning: { bg: colors.warningSurface, fg: 'warning' },
    danger: { bg: colors.dangerSurface, fg: 'danger' },
    brand: { bg: colors.identity, fg: 'onIdentity' },
  };
  const t = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size="xs" color={t.fg} /> : null}
      <Text variant="caption" color={t.fg} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Required next to any mock ETA, driver location, payment, verification or safety feature
 * presented as if live (CLAUDE.md rule, BR-104, BR-120).
 */
export function SimulatedBadge({ label = 'Simulated' }: { label?: string }) {
  return <Badge label={label} icon="info" tone="warning" />;
}

/* ---------- Divider ---------- */

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset }} />;
}

/* ---------- Skeleton ---------- */

/** Single skeleton block (legacy API). Prefer SkeletonGroup + Bone/SkeletonRow/SkeletonCard for screens. */
export function Skeleton({ width = '100%', height = 16, radius = radii.sm }: { width?: number | `${number}%`; height?: number; radius?: number }) {
  const { colors, scheme } = useTheme();
  const reduce = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!reduce) opacity.value = withRepeat(withTiming(0.55, { duration: 900 }), -1, true);
  }, [reduce, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: scheme === 'dark' ? colors.surfaceSelected : colors.secondary }, style]}
    />
  );
}

/* ---------- Empty / Error states ---------- */

export function EmptyState({
  icon,
  illustration,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  /** Optional 3D-style brand illustration shown instead of the icon. */
  illustration?: IllustrationName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.state}>
      {illustration ? (
        <Illustration name={illustration} size={120} />
      ) : (
        <View style={[styles.stateIcon, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name={icon} size="xl" color="text" />
        </View>
      )}
      <Text variant="title3" align="center" accessibilityRole="header">
        {title}
      </Text>
      {body ? (
        <Text variant="callout" color="textSecondary" align="center">
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} variant="secondary" size="md" /> : null}
    </View>
  );
}

export function ErrorState({ title = 'Something went wrong', body, onRetry }: { title?: string; body?: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <View style={[styles.stateIcon, { backgroundColor: colors.dangerSurface }]}>
        <Icon name="warning" size="xl" color="danger" />
      </View>
      <Text variant="title3" align="center" accessibilityRole="header">
        {title}
      </Text>
      {body ? (
        <Text variant="callout" color="textSecondary" align="center">
          {body}
        </Text>
      ) : null}
      {onRetry ? <Button title="Try again" leadingIcon="refresh" onPress={onRetry} variant="secondary" size="md" /> : null}
    </View>
  );
}

/* ---------- Wordmark (PREVIEW — concept mark + Inter text; see ASSET_INVENTORY) ---------- */

export function Wordmark({ size = 32, inverse }: { size?: number; inverse?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wordmark} accessible accessibilityRole="header" accessibilityLabel={BRAND_NAME}>
      <BrandMark size={size * 1.05} inverse={inverse} />
      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: size, lineHeight: size * 1.2, letterSpacing: -0.5, color: inverse ? colors.onIdentity : colors.text }}>
        {BRAND_NAME}
      </Text>
    </View>
  );
}

/* ---------- StarRating ---------- */

export function StarRating({ value, onChange, size = 'xl' }: { value: number; onChange: (v: 1 | 2 | 3 | 4 | 5) => void; size?: 'lg' | 'xl' }) {
  return (
    <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel="Rating" accessibilityValue={{ min: 0, max: 5, now: value, text: `${value} of 5 stars` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const next = e.nativeEvent.actionName === 'increment' ? Math.min(5, value + 1) : Math.max(1, value - 1);
        onChange(next as 1 | 2 | 3 | 4 | 5);
      }}
    >
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={4} style={styles.star} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={`star-${n}`}>
          <Icon name="star" variant={n <= value ? 'filled' : 'regular'} size={size} color={n <= value ? 'accent' : 'textSecondary'} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: layout.cardRadius, borderWidth: StyleSheet.hairlineWidth, padding: layout.container },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.pill, alignSelf: 'flex-start' },
  state: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl },
  stateIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs },
  star: { minWidth: minTouch, minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
});
