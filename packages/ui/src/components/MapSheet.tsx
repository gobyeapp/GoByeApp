import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';
import { radii, shadows, spacing } from '../theme/tokens';

export interface MapSheetProps {
  /** Visible heights in points, ascending (e.g. [220, 420]). Fractions ≤ 1 are treated as screen-height fractions. */
  snapPoints: number[];
  index?: number;
  onIndexChange?: (index: number) => void;
  children: ReactNode;
  /** Rendered above the scroll content inside the draggable area. */
  header?: ReactNode;
  testID?: string;
  /** Add the bottom safe-area inset (false when a tab bar already handles it). */
  safeAreaBottom?: boolean;
}

/**
 * Non-modal bottom sheet over the map (decision D-010). The map stays interactive above it.
 * - Drag the grabber/header to move between snap points.
 * - Screen readers: the grabber is an adjustable control (swipe up/down to expand/collapse).
 * - Reduce Motion: snaps without spring animation.
 */
export function MapSheet({ snapPoints, index = 0, onIndexChange, children, header, testID, safeAreaBottom = true }: MapSheetProps) {
  const { colors, scheme } = useTheme();
  const { height: screenH } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const insets = { bottom: safeAreaBottom ? safe.bottom : 0 };
  const reduce = useReducedMotion();
  const points = snapPoints.map((p) => (p <= 1 ? p * screenH : p) + insets.bottom);
  const maxH = points[points.length - 1];
  const offsetFor = (i: number) => maxH - points[Math.max(0, Math.min(points.length - 1, i))];

  const [current_, setCurrent] = useState(index);
  const translateY = useSharedValue(offsetFor(index));
  const start = useSharedValue(0);
  const current = useSharedValue(index);

  const animateTo = useCallback(
    (i: number) => {
      'worklet';
      const target = maxH - points[i];
      translateY.value = reduce ? withTiming(target, { duration: 0 }) : withSpring(target, { damping: 22, stiffness: 220, mass: 0.9 });
      current.value = i;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maxH, reduce, points.join(',')],
  );

  useEffect(() => {
    const i = Math.max(0, Math.min(points.length - 1, index));
    animateTo(i);
    setCurrent(i);
  }, [index, animateTo, points.length]);

  const notify = useCallback(
    (i: number) => {
      setCurrent(i);
      onIndexChange?.(i);
    },
    [onIndexChange],
  );

  const pan = Gesture.Pan()
    .onStart(() => {
      start.value = translateY.value;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(0, Math.min(maxH - points[0], start.value + e.translationY));
    })
    .onEnd((e) => {
      const projected = translateY.value + e.velocityY * 0.15;
      let best = 0;
      let bestDist = Number.MAX_VALUE;
      points.forEach((p, i) => {
        const d = Math.abs(maxH - p - projected);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      animateTo(best);
      runOnJS(notify)(best);
    });

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  // Pad the content by the off-screen part of the sheet so footers (e.g. the Book button)
  // stay visible at every snap point.
  const contentStyle = useAnimatedStyle(() => ({ paddingBottom: translateY.value + insets.bottom + spacing.lg }));

  const step = (dir: 1 | -1) => {
    const next = Math.max(0, Math.min(points.length - 1, current.value + dir));
    animateTo(next);
    notify(next);
  };

  return (
    <Animated.View
      testID={testID}
      style={[styles.sheet, shadows.sheet, { height: maxH, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0 }, style]}
    >
      <GestureDetector gesture={pan}>
        <View>
          <View
            style={styles.grabberHit}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Sheet handle"
            accessibilityHint="Swipe up or down to expand or collapse"
            accessibilityValue={{ text: current_ >= points.length - 1 ? 'Expanded' : 'Collapsed' }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          </View>
          {header}
        </View>
      </GestureDetector>
      <Animated.View style={[styles.content, contentStyle]}>{children}</Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  grabberHit: { alignItems: 'center', justifyContent: 'center', height: 28 },
  grabber: { width: 40, height: 5, borderRadius: 3 },
  content: { flex: 1, paddingHorizontal: spacing.screen },
});
