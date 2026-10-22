import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '../theme/useTheme';
import { layout, spacing } from '../theme/tokens';

/**
 * Loading skeletons (2026-10-21). One shared pulse drives every block inside a `SkeletonGroup`, so a
 * whole screen breathes together instead of flickering block by block. Reduce Motion → static blocks.
 * Skeletons mirror the real layout (same heights, gaps and radii) so nothing jumps when data arrives.
 * The group is announced once to screen readers ("Loading …"); the blocks themselves are hidden.
 */

const PulseContext = createContext<SharedValue<number> | null>(null);

export function SkeletonGroup({ label, children, style }: { label: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduce, pulse]);
  return (
    <PulseContext.Provider value={reduce ? null : pulse}>
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} style={style} testID="skeleton">
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {children}
        </View>
      </View>
    </PulseContext.Provider>
  );
}

/** A single grey block. Use inside SkeletonGroup (falls back to a static block on its own). */
export function Bone({ width = '100%', height = 14, radius = 6, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { colors, scheme } = useTheme();
  const pulse = useContext(PulseContext);
  const animated = useAnimatedStyle(() => ({ opacity: pulse ? 1 - pulse.value * 0.45 : 1 }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: scheme === 'dark' ? colors.surfaceSelected : colors.secondary }, animated, style]} />;
}

/** Placeholder for a list row: icon box + two text lines + trailing value. */
export function SkeletonRow({ trailing = true, avatar = false }: { trailing?: boolean; avatar?: boolean }) {
  return (
    <View style={styles.row}>
      <Bone width={layout.iconBox} height={layout.iconBox} radius={avatar ? layout.iconBox / 2 : 12} />
      <View style={styles.rowText}>
        <Bone width="62%" height={14} />
        <Bone width="38%" height={11} />
      </View>
      {trailing ? (
        <View style={styles.rowTrailing}>
          <Bone width={64} height={14} />
          <Bone width={48} height={11} />
        </View>
      ) : null}
    </View>
  );
}

/** Placeholder for a card block with a title line and N body lines. */
export function SkeletonCard({ lines = 3, height, style }: { lines?: number; height?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card, minHeight: height }, style]}>
      <Bone width="45%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} width={i === lines - 1 ? '70%' : '100%'} height={12} />
      ))}
    </View>
  );
}

/** Placeholder text block: a heading and supporting lines. */
export function SkeletonText({ lines = 2, heading = true }: { lines?: number; heading?: boolean }) {
  return (
    <View style={styles.text}>
      {heading ? <Bone width="55%" height={22} radius={8} /> : null}
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} width={i === lines - 1 ? '65%' : '92%'} height={12} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 64, paddingVertical: spacing.sm },
  rowText: { flex: 1, gap: spacing.xs + 2 },
  rowTrailing: { alignItems: 'flex-end', gap: spacing.xs + 2 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: layout.cardRadius, padding: layout.container, gap: spacing.sm },
  text: { gap: spacing.sm },
});
