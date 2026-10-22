import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, useTheme } from '@gobye/ui';

/**
 * Brief end-of-trip mark (2026-10-21 end-of-trip brief). The check pops in once and a single ring
 * fades outward (about 0.6 s in total). `neutral` marks the end of the journey and says nothing about
 * payment; `success` (green) is reserved for a verified payment. Reduced motion: shown still.
 */
export function CompletionMark({ tone, size = 72 }: { tone: 'neutral' | 'success'; size?: number }) {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const scale = useSharedValue(reduce ? 1 : 0.4);
  const opacity = useSharedValue(reduce ? 1 : 0);
  const ring = useSharedValue(0);

  useEffect(() => {
    if (reduce) return;
    opacity.value = withTiming(1, { duration: 160 });
    scale.value = withSpring(1, { damping: 12, stiffness: 220, mass: 0.7 });
    ring.value = withDelay(120, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [reduce, opacity, scale, ring]);

  const markStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value === 0 ? 0 : 0.35 * (1 - ring.value), transform: [{ scale: 1 + ring.value * 0.6 }] }));

  const bg = tone === 'success' ? colors.success : colors.primary;
  // onPrimary is white in light and black in dark: readable on both the neutral and the green mark.
  const fg = colors.onPrimary;
  const box = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[styles.wrap, box]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {reduce ? null : <Animated.View style={[StyleSheet.absoluteFill, box, { backgroundColor: bg }, ringStyle]} />}
      <Animated.View style={[styles.mark, box, { backgroundColor: bg }, markStyle]}>
        <Icon name="check" size={Math.round(size * 0.46)} color={fg} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  mark: { alignItems: 'center', justifyContent: 'center' },
});
