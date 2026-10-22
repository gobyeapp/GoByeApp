import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark, Button, Icon, Text, layout, spacing, useTheme, type IconName } from '@gobye/ui';
import { useSession } from '@/state/session';

const POINTS: { icon: IconName; text: string }[] = [
  { icon: 'coin', text: '0% commission. You keep every fare.' },
  { icon: 'chat', text: 'Accept the fare, or counter the rider’s offer.' },
  { icon: 'shield', text: 'Riders confirm a PIN before every trip.' },
];

/** D02a Welcome (driver). Owner's curbside photo, the promise, then one way in: phone sign-in (D-008). */
export default function Welcome() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { markWelcomeSeen } = useSession();
  const reduce = useReducedMotion();
  const photoH = Math.round(Math.min(height * 0.46, 440));

  const start = () => {
    markWelcomeSeen();
    router.push('/auth/phone');
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.photo, { height: photoH + insets.top }]}>
        <Image
          source={require('../../assets/images/welcome.jpg')}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition={{ top: '25%', left: '50%' }}
          accessibilityLabel="A GoBye driver greeting a rider at the kerb at sunset"
        />
        <View style={[styles.badge, { top: insets.top + spacing.md, backgroundColor: colors.background }]}>
          <BrandMark size={22} />
          <Text variant="subhead" weight="semibold">
            GoBye Driver
          </Text>
        </View>
      </View>

      <Animated.View entering={reduce ? undefined : FadeInDown.duration(320)} style={[styles.body, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.copy}>
          <Text variant="largeTitle" accessibilityRole="header">
            Drive more.{'\n'}Keep it all.
          </Text>
          <View style={styles.points}>
            {POINTS.map((p) => (
              <View key={p.icon} style={styles.point}>
                <View style={[styles.pointIcon, { backgroundColor: colors.surfaceMuted }]}>
                  <Icon name={p.icon} size="sm" color="text" />
                </View>
                <Text variant="callout" style={styles.flex}>
                  {p.text}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.actions}>
          <Button title="Get started" onPress={start} testID="welcome-start" />
          <Button title="I already drive with GoBye" variant="tertiary" onPress={start} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  photo: { overflow: 'hidden', borderBottomLeftRadius: layout.sheetRadius, borderBottomRightRadius: layout.sheetRadius },
  badge: { position: 'absolute', left: layout.page, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999 },
  body: { flex: 1, paddingHorizontal: layout.page, paddingTop: spacing.xxl, justifyContent: 'space-between', gap: spacing.xl },
  copy: { gap: spacing.xl },
  points: { gap: spacing.md },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pointIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: spacing.xs },
});
