import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, MemberPass, spacing, Text, useTheme } from '@gobye/ui';
import { resetTo } from '@/features/navigation/reset';
import { useDriver } from '@/state/driver';
import { useHaptics } from '@/state/settings';
import { useSession } from '@/state/session';

/**
 * End of Create account (driver): the driver pass rises in with a slight tilt that settles (still under
 * Reduce Motion). "Go to my dashboard" saves what the driver already told us (name, email, city) as
 * About you, then opens the Drive tab, where a card shows what's left to register (licence next).
 */
export default function DriverPassScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const haptic = useHaptics();
  const { profile, createdAt } = useSession();
  const { application, updateApplication } = useDriver();
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

  const name = profile ? `${profile.firstName} ${profile.lastName}`.trim() : 'GoBye driver';
  const since = new Date(createdAt ?? Date.now()).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

  const start = () => {
    if (!application.personal && profile?.firstName && profile.lastName && profile.city) {
      updateApplication({ personal: { firstName: profile.firstName, lastName: profile.lastName, email: profile.email || undefined, city: profile.city } }, 'personal');
    }
    resetTo('/(tabs)');
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + spacing.xxl, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
      <Animated.View entering={reduce ? undefined : FadeIn.duration(300)} style={styles.head}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          You’re in, {profile?.firstName ?? 'driver'}.
        </Text>
        <Text variant="body" color="textSecondary">
          Next: your licence, ID and vehicle. It takes about 10 minutes.
        </Text>
      </Animated.View>
      <Animated.View style={[styles.pass, passStyle]}>
        <MemberPass tag="DRIVER PASS" testID="driver-pass" name={name} city={profile?.city ?? 'Lagos'} placeLabel="Drives in" since={since} note="Phone verified. Registration comes next." />
      </Animated.View>
      <Button variant="brand" title="Go to my dashboard" onPress={start} testID="pass-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, gap: spacing.xxl },
  head: { gap: spacing.sm },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 33, letterSpacing: -1 },
  pass: { flex: 1, justifyContent: 'center' },
});
