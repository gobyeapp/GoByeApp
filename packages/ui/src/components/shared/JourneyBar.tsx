import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from '../../icons/Icon';
import { brand } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

const KNOB = 28;

/**
 * Route-coloured progress bar with a vehicle knob (car.jpg / estimate.jpg). Driven only by trip data
 * (ETA-based progress); it never represents a fare. Moves with a short 250 ms ease, instantly under
 * Reduce Motion. `end` adds a destination ring at the far end (trip in progress).
 */
export function JourneyBar({ value, icon = 'car', label, end }: { value: number; icon?: IconName; label: string; end?: boolean }) {
  const { colors, scheme } = useTheme();
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const v = Math.max(0, Math.min(1, value));
  const x = useSharedValue(0);
  useEffect(() => {
    const target = v * Math.max(0, w - KNOB);
    x.value = reduce ? target : withTiming(target, { duration: 250, easing: Easing.out(Easing.quad) });
  }, [v, w, reduce, x]);
  const fill = useAnimatedStyle(() => ({ width: x.value + KNOB / 2 }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  return (
    <View
      onLayout={onLayout}
      style={styles.wrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
    >
      <View style={[styles.track, { backgroundColor: scheme === 'dark' ? colors.surfaceSelected : colors.secondary }]}>
        <Animated.View style={[styles.fill, { backgroundColor: colors.mapRoute }, fill]} />
      </View>
      {end ? (
        <View style={[styles.end, { borderColor: colors.mapRoute, backgroundColor: colors.background }]}>
          <View style={[styles.endDot, { backgroundColor: colors.mapRoute }]} />
        </View>
      ) : null}
      <Animated.View style={[styles.knob, { backgroundColor: colors.mapRoute, borderColor: colors.background }, knob]}>
        <Icon name={icon} variant="filled" size={14} color={brand.white} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: KNOB, justifyContent: 'center' },
  track: { height: 12, borderRadius: 6, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 6 },
  knob: { position: 'absolute', left: 0, width: KNOB, height: KNOB, borderRadius: KNOB / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  end: { position: 'absolute', right: 0, width: 22, height: 22, borderRadius: 11, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  endDot: { width: 6, height: 6, borderRadius: 3 },
});
