import { Image } from 'expo-image';
import { Component, type ReactNode } from 'react';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_NAME, BrandMark, Button, Text, darkColors, layout, spacing } from '@gobye/ui';
import { useSession } from '@/state/session';

const VIDEO = require('../../assets/video/road-dark.mp4');
const POSTER = require('../../assets/video/road-dark-poster.jpg');

/** The welcome is always dark (owner design), whatever the app appearance, so it uses the dark tokens directly. */
const c = darkColors;

/**
 * R02 Welcome (owner's "GoBYE Auth Flow" design). The 3D road scene from the website, recorded as a
 * silent 12 s seamless loop (250 KB) so it plays smoothly on any phone; under Reduce Motion the still
 * poster shows instead. No glows or gradients: dark tokens only. Create account or Sign in.
 */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const { completeOnboarding } = useSession();
  // The road takes whatever height is left after the text and buttons (380 on tall phones, 120 on the smallest).
  const compact = height < 700;
  const stage = Math.round(Math.min(380, Math.max(120, height - (compact ? 450 : 470))));


  const go = (to: '/auth/signup' | '/auth/signin') => {
    completeOnboarding();
    router.push(to);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel={BRAND_NAME}>
        <BrandMark size={32} inverse />
        <Text style={[styles.word, { color: c.text }]}>{BRAND_NAME}</Text>
      </View>

      <View style={[styles.stage, { height: stage }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Image source={POSTER} style={StyleSheet.absoluteFill} contentFit="cover" />
        {reduce ? null : (
          <VideoGuard>
            <RoadLoop />
          </VideoGuard>
        )}
        {stage < 200 ? null : (
        <Animated.View entering={reduce ? undefined : FadeIn.delay(400).duration(400)} style={[styles.fare, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="caption" style={{ color: c.textSecondary }}>
            Agreed fare
          </Text>
          <Text variant="title2" tabular style={{ color: c.text }}>
            ₦7,200
          </Text>
        </Animated.View>
        )}
      </View>

      <Animated.View entering={reduce ? undefined : FadeInDown.duration(360)} style={styles.copy}>
        <Text variant="largeTitle" style={[styles.headline, compact && styles.headlineCompact, { color: c.text }]} accessibilityRole="header">
          Your next move starts here.
        </Text>
        <Text variant={compact ? 'callout' : 'body'} style={{ color: c.textSecondary }}>
          City rides, airport transfers and smarter ways to move around Lagos and Abuja, with the fare agreed before you go.
        </Text>
      </Animated.View>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm }]}>
        <Button variant="brand" title="Create account" appearance="dark" onPress={() => go('/auth/signup')} testID="welcome-create" />
        <Button title="Sign in" appearance="dark" variant="secondary" onPress={() => go('/auth/signin')} testID="welcome-signin" />
      </View>
    </View>
  );
}

/** The looping road. Its own component so a player failure can be contained by `VideoGuard`. */
function RoadLoop() {
  const player = useVideoPlayer(VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} />;
}

/** If the video can't play on this device or build, the still poster underneath stays: the welcome never breaks. */
class VideoGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Intentionally silent: the poster is already showing.
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: layout.page, paddingTop: spacing.xl },
  word: { fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  stage: { marginTop: spacing.md, overflow: 'hidden' },
  fare: { position: 'absolute', left: layout.page, top: spacing.xl, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  copy: { paddingHorizontal: layout.page, gap: spacing.md },
  headline: { fontSize: 34, lineHeight: 41, letterSpacing: -1 },
  headlineCompact: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  actions: { marginTop: 'auto', paddingHorizontal: layout.page, gap: spacing.md },
});
