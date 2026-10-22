import { Image } from 'expo-image';
import { Component, type ReactNode } from 'react';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_NAME, BrandMark, Button, Text, layout, spacing, useTheme } from '@gobye/ui';
import { useSession } from '@/state/session';

/** The road clip in both appearances: rendered from the website's 3D footer on white (light) and on black (dark). */
const ROAD = {
  light: { video: require('../../assets/video/road-light.mp4'), poster: require('../../assets/video/road-light-poster.jpg') },
  dark: { video: require('../../assets/video/road-dark.mp4'), poster: require('../../assets/video/road-dark-poster.jpg') },
} as const;

/**
 * D02a Welcome (driver), matching the rider welcome: the website's 3D road as a silent seamless loop
 * (a clip for Light and for Dark; the still poster under Reduce Motion), the promise, then two ways in.
 */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { colors: c, scheme } = useTheme();
  const road = ROAD[scheme === 'dark' ? 'dark' : 'light'];
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const { markWelcomeSeen } = useSession();
  const compact = height < 700;
  // The clip is near-square with the road across its middle; a band about 0.62 × width tall keeps the road and trims dead sky.
  const stageH = Math.round(Math.min(width * 0.62, height * 0.34));

  const go = (to: '/auth/signup' | '/auth/signin') => {
    markWelcomeSeen();
    router.push(to);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel={`${BRAND_NAME} Driver`}>
        <BrandMark size={32} inverse={scheme === 'dark'} />
        <Text style={[styles.word, { color: c.text }]}>{BRAND_NAME}</Text>
        <View style={[styles.tag, { backgroundColor: c.surfaceMuted }]}>
          <Text variant="caption" weight="semibold" color="textSecondary">
            Driver
          </Text>
        </View>
      </View>

      {/* Equal flexible space above and below the road, so it sits centred between the brand and the headline on any height. */}
      <View style={styles.spacer} />
      <View style={[styles.stage, { height: stageH }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Image source={road.poster} style={StyleSheet.absoluteFill} contentFit="cover" />
        {reduce ? null : (
          <VideoGuard>
            {/* Keyed by appearance, so switching Light/Dark swaps the clip. */}
            <RoadLoop key={scheme} source={road.video} />
          </VideoGuard>
        )}
      </View>
      <View style={styles.spacer} />

      <Animated.View entering={reduce ? undefined : FadeInDown.duration(360)} style={styles.copy}>
        <Text variant="largeTitle" style={[styles.headline, compact && styles.headlineCompact, { color: c.text }]} accessibilityRole="header">
          Drive more.{'\n'}Keep it all.
        </Text>
        <Text variant={compact ? 'callout' : 'body'} style={{ color: c.textSecondary }}>
          0% commission. You keep every fare.
        </Text>
      </Animated.View>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm }]}>
        <Button variant="brand" title="Create account" onPress={() => go('/auth/signup')} testID="welcome-create" />
        <Button title="Sign in" variant="secondary" onPress={() => go('/auth/signin')} testID="welcome-signin" />
      </View>
    </View>
  );
}

/** The looping road. Its own component so a player failure can be contained by `VideoGuard`. */
function RoadLoop({ source }: { source: number }) {
  const player = useVideoPlayer(source, (p) => {
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
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: layout.page, paddingTop: spacing.lg },
  tag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  word: { fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  spacer: { flex: 1, minHeight: spacing.md },
  stage: { overflow: 'hidden' },
  copy: { paddingHorizontal: layout.page, gap: spacing.md, marginBottom: spacing.xxl },
  headline: { fontSize: 34, lineHeight: 41, letterSpacing: -1 },
  headlineCompact: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  actions: { paddingHorizontal: layout.page, gap: spacing.md },
});
