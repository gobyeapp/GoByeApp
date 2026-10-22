import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, RiderPass, spacing, Text, useTheme } from '@gobye/ui';
import { resetTo } from '@/features/navigation/reset';
import { useHaptics } from '@/state/haptics';
import { useSession } from '@/state/session';

/**
 * End of Create account: the rider pass (website waitlist result). The pass rises in with a slight
 * tilt that settles (still under Reduce Motion), then "Start riding" opens Home.
 */
export default function RiderPassScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const haptic = useHaptics();
  const { user, homeCity } = useSession();
  const y = useSharedValue(reduce ? 0 : 26);
  const rot = useSharedValue(reduce ? 0 : -2);
  const o = useSharedValue(reduce ? 1 : 0);

  useEffect(() => {
    haptic('success');
    if (reduce) return;
    o.value = withTiming(1, { duration: 300 });
    y.value = withSpring(0, { damping: 11, stiffness: 140, mass: 0.8 });
    rot.value = withDelay(80, withTiming(0, { duration: 700, easing: Easing.bezier(0.25, 1.3, 0.5, 1) }));
  }, [reduce, haptic, o, y, rot]);
  const passStyle = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }, { rotate: `${rot.value}deg` }] }));

  const name = user ? `${user.firstName} ${user.lastName}`.trim() : 'GoBye rider';
  const since = new Date(user?.createdAt ?? Date.now()).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + spacing.xxl, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
      <Animated.View entering={reduce ? undefined : FadeIn.duration(300)} style={styles.head}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          You’re in, {user?.firstName ?? 'rider'}.
        </Text>
        <Text variant="body" color="textSecondary">
          Your number is verified and your account is ready. Here’s your rider pass.
        </Text>
      </Animated.View>
      <Animated.View style={[styles.pass, passStyle]}>
        <RiderPass name={name} city={homeCity ?? 'Lagos'} since={since} note="Phone verified. Book your first ride whenever you’re ready." />
      </Animated.View>
      <Button variant="brand" title="Start riding" onPress={() => resetTo('/(tabs)')} testID="pass-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, gap: spacing.xxl },
  head: { gap: spacing.sm },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 33, letterSpacing: -1 },
  pass: { flex: 1, justifyContent: 'center' },
});
