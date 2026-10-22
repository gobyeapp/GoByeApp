import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View, useWindowDimensions, type ViewToken } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { BrandMark, Button, Icon, Text, brand, layout, onboardingImages, shadows, spacing, useTheme, type IconName, type OnboardingImageName } from '@gobye/ui';
import { useSession } from '@/state/session';

type Scene = {
  kind: 'stack' | 'frame';
  image: OnboardingImageName;
  behind?: OnboardingImageName[];
  title: string;
  body: string;
  alt: string;
  /** Illustrative caption on the front photo (sample content). */
  caption?: { leftLabel: string; left: string; rightLabel: string; right: string };
  chips: IconName[];
};

const SCENES: Scene[] = [
  {
    kind: 'stack',
    image: 'carLivery',
    behind: ['pickupMeet', 'riderWindow'],
    title: 'Your next move starts here.',
    body: 'Book a car in a few taps.',
    alt: 'A GoBye car in the city, with a passenger meeting a driver and a passenger riding comfortably behind it',
    caption: { leftLabel: 'Pickup', left: 'Lekki Phase 1', rightLabel: 'Arriving', right: '4 min' },
    chips: ['route', 'car'],
  },
  {
    kind: 'frame',
    image: 'pickupMeet',
    title: 'A ride that fits your journey.',
    body: 'Take the suggested fare, or offer your own.',
    alt: 'A driver opening the car door for a passenger at pickup',
    chips: ['coin', 'car', 'destination'],
  },
  {
    kind: 'frame',
    image: 'riderWindow',
    title: 'Know who’s coming for you.',
    body: 'See your driver, car and plate before pickup.',
    alt: 'A passenger relaxing in the back of a car',
    chips: ['shield', 'account', 'wallet'],
  },
];

const ADVANCE_MS = 6000;

/**
 * R02 — Onboarding (brief 2026-10-21 §1–2). Logo top-left, progress opposite it; photography in the
 * upper-middle (layered cards on the first scene, one large frame after); a fixed-height text area so the
 * buttons never move; "Get started" and "Already have an account? Log in" anchored at the bottom.
 * Scenes advance gently on their own; with Reduce Motion they are still and advance only by swipe or tap.
 * Photos are interim crops from the brand pack (D-033) until real photography arrives (Q-050).
 */
export default function Onboarding() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const { completeOnboarding } = useSession();
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const list = useRef<FlatList>(null);

  const finish = () => {
    completeOnboarding();
    router.replace('/auth/phone');
  };
  const goTo = (i: number) => list.current?.scrollToIndex({ index: i, animated: !reduce });

  // Gentle auto-advance (stops after the last scene, when the user swipes, or under Reduce Motion).
  useEffect(() => {
    if (reduce || paused || page >= SCENES.length - 1) return;
    const t = setTimeout(() => goTo(page + 1), ADVANCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, reduce, paused]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]?.index != null) setPage(viewableItems[0].index);
  }).current;

  // Responsive art: the photo takes what's left after the fixed text area and actions, so short
  // screens (e.g. 320×568) keep the full copy and buttons visible instead of clipping the text.
  const artW = width - layout.page * 2;
  const narrow = width < 360;
  const copyH = narrow ? 150 : 160;
  const chrome = insets.top + insets.bottom + 56 + spacing.md + spacing.xl + copyH + 124;
  // Photography takes the space left after the fixed copy and actions (upper-middle, like the reference).
  const artH = Math.max(140, Math.min(artW * 1.25, height * 0.56, height - chrome));

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.background }]}>
      <View style={styles.top}>
        <View accessible accessibilityRole="image" accessibilityLabel="GoBye">
          <BrandMark size={32} />
        </View>
        <Progress
          page={page}
          running={!reduce && !paused}
          onPick={(i) => {
            setPaused(true);
            goTo(i);
          }}
        />
      </View>

      <FlatList
        ref={list}
        data={SCENES}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(s) => s.image}
        onScrollBeginDrag={() => setPaused(true)}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item, index }) => (
          <View style={[styles.slide, { width }]}>
            <View style={{ height: artH, justifyContent: 'center' }}>
              {item.kind === 'stack' ? (
                <StackedCards scene={item} width={artW} height={artH} active={index === page} />
              ) : (
                <PhotoFrame scene={item} width={artW} height={artH} active={index === page} />
              )}
            </View>
            {/* Fixed height keeps the buttons in the same place on every scene. */}
            <View style={[styles.copy, { height: copyH }]}>
              <Text variant={narrow ? 'title1' : 'largeTitle'} align="center" accessibilityRole="header" numberOfLines={3}>
                {item.title}
              </Text>
              <Text variant="body" color="textSecondary" align="center" numberOfLines={4}>
                {item.body}
              </Text>
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <Button title="Get started" onPress={finish} style={styles.pill} testID="onboarding-signup" />
        <Pressable onPress={finish} accessibilityRole="button" accessibilityLabel="Already have an account? Log in" style={styles.login} testID="onboarding-login">
          <Text variant="callout" color="textSecondary">
            Already have an account?{' '}
            <Text variant="callout" weight="semibold" color="primary" style={styles.underline}>
              Log in
            </Text>
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Progress opposite the logo (reference dots): the current scene is a pill that fills during auto advance. */
function Progress({ page: p, running, onPick }: { page: number; running: boolean; onPick: (i: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.progress} accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${p + 1} of ${SCENES.length}`} accessibilityValue={{ min: 1, max: SCENES.length, now: p + 1 }}>
      {SCENES.map((s, i) => (
        <Pressable key={s.image} onPress={() => onPick(i)} hitSlop={{ top: 14, bottom: 14, left: 4, right: 4 }} accessibilityElementsHidden importantForAccessibility="no" testID={`onboarding-dot-${i}`}>
          <View style={[i === p ? styles.dotActive : styles.dot, { backgroundColor: i < p ? colors.primary : colors.border }]}>
            {i === p ? <Segment running={running && p < SCENES.length - 1} /> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** Fill of the active pill: grows over the auto-advance time; full and still otherwise. */
function Segment({ running }: { running: boolean }) {
  const { colors } = useTheme();
  const fill = useSharedValue(running ? 0 : 1);
  useEffect(() => {
    cancelAnimation(fill);
    if (running) {
      fill.value = 0;
      fill.value = withTiming(1, { duration: ADVANCE_MS, easing: Easing.linear });
    } else fill.value = 1;
  }, [running, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return <Animated.View style={[styles.dotFill, { backgroundColor: colors.primary }, style]} />;
}

/** Slow drift on the visible photo (restrained parallax); still under Reduce Motion. */
function useDrift(active: boolean) {
  const reduce = useReducedMotion();
  const drift = useSharedValue(0);
  useEffect(() => {
    if (reduce || !active) {
      cancelAnimation(drift);
      drift.value = 0;
      return;
    }
    drift.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(drift);
  }, [active, reduce, drift]);
  return useAnimatedStyle(() => ({ transform: [{ scale: 1.05 + drift.value * 0.07 }, { translateX: -8 + drift.value * 16 }] }));
}

function Photo({ image, style }: { image: OnboardingImageName; style?: object }) {
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Image source={onboardingImages[image]} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

/** Concentric arcs behind the art (reference), with a tangerine route dot riding the outer arc. */
function Arcs({ width, height }: { width: number; height: number }) {
  const { colors } = useTheme();
  const cx = width / 2;
  const r1 = width * 0.62;
  const r2 = width * 0.86;
  const cy = height * 0.42;
  const dotX = cx + r2 * Math.cos(Math.PI * 0.18);
  const dotY = cy + r2 * Math.sin(Math.PI * 0.18);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Circle cx={cx} cy={cy} r={r1} stroke={colors.border} strokeWidth={1} fill="none" />
        <Circle cx={cx} cy={cy} r={r2} stroke={colors.border} strokeWidth={1} fill="none" />
        {dotY < height - 6 ? <Circle cx={dotX} cy={dotY} r={5} fill={brand.tangerine} /> : null}
      </Svg>
    </View>
  );
}

/** Small round icon chip floating around the photography (reference). Decorative. */
function Chip({ icon, style }: { icon: IconName; style: object }) {
  const { colors, scheme } = useTheme();
  return (
    <View style={[styles.chip, scheme === 'light' && shadows.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]} pointerEvents="none">
      <Icon name={icon} size="sm" color="text" />
    </View>
  );
}

/** Dark fade at the foot of a photo so captions stay readable over any image. */
function PhotoFade() {
  return (
    <Svg style={styles.photoFade} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
      <Defs>
        <LinearGradient id="pf" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.55" stopColor={brand.black} stopOpacity="0" />
          <Stop offset="1" stopColor={brand.black} stopOpacity="0.6" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#pf)" />
    </Svg>
  );
}

/** Scene 1 (onboarding.jpg): one dominant rounded card in front, two partially visible cards behind. */
function StackedCards({ scene, width, height, active }: { scene: Scene; width: number; height: number; active: boolean }) {
  const { colors } = useTheme();
  const drift = useDrift(active);
  const frontH = height * 0.9;
  const frontW = Math.min(width * 0.6, frontH * 0.78);
  const backH = frontH * 0.84;
  const backW = frontW * 0.82;
  const offset = frontW * 0.42;
  const cap = scene.caption;
  return (
    <View style={{ width, height }} accessible accessibilityRole="image" accessibilityLabel={scene.alt}>
      <Arcs width={width} height={height} />
      <View style={[styles.backCard, { width: backW, height: backH, left: width / 2 - backW / 2 - offset, top: (height - backH) / 2 + 6, transform: [{ rotate: '-7deg' }], borderColor: colors.background, backgroundColor: colors.surfaceMuted }]}>
        <Photo image={scene.behind![0]} />
      </View>
      <View style={[styles.backCard, { width: backW, height: backH, left: width / 2 - backW / 2 + offset, top: (height - backH) / 2 + 6, transform: [{ rotate: '7deg' }], borderColor: colors.background, backgroundColor: colors.surfaceMuted }]}>
        <Photo image={scene.behind![1]} />
      </View>
      <View style={[styles.frontCard, { width: frontW, height: frontH, left: (width - frontW) / 2, top: (height - frontH) / 2, backgroundColor: colors.surfaceMuted, borderColor: colors.background }]}>
        <Photo image={scene.image} style={drift} />
        <PhotoFade />
        {cap ? (
          <View style={styles.caption} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.flex}>
              <Text variant="caption" style={styles.capText}>
                {cap.leftLabel}
              </Text>
              <Text variant="headline" style={styles.capText} numberOfLines={1}>
                {cap.left}
              </Text>
            </View>
            <View style={styles.capRight}>
              <Text variant="caption" style={styles.capText}>
                {cap.rightLabel}
              </Text>
              <Text variant="headline" style={styles.capText}>
                {cap.right}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
      <Chip icon={scene.chips[0]} style={{ right: width * 0.06, top: height * 0.02 }} />
      <Chip icon={scene.chips[1]} style={{ left: width * 0.08, bottom: height * 0.02 }} />
    </View>
  );
}

/** Scenes 2 and 3 (onboa.jpg): one large rounded photo frame over two dashed outline frames. */
function PhotoFrame({ scene, width, height, active }: { scene: Scene; width: number; height: number; active: boolean }) {
  const { colors } = useTheme();
  const drift = useDrift(active);
  const frameH = height * 0.86;
  const frameW = Math.min(width * 0.7, frameH * 0.82);
  const left = (width - frameW) / 2;
  const top = (height - frameH) / 2;
  return (
    <View style={{ width, height }} accessible accessibilityRole="image" accessibilityLabel={scene.alt}>
      <Arcs width={width} height={height} />
      <View style={[styles.dashed, { left: left - 26, top: top - 18, width: frameW * 0.86, height: frameH * 0.86, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]} />
      <View style={[styles.dashed, { left: left + frameW * 0.3, top: top + frameH * 0.34, width: frameW * 0.8, height: frameH * 0.74, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]} />
      <View style={[styles.frame, { left, top, width: frameW, height: frameH, backgroundColor: colors.surfaceMuted, borderColor: colors.background }]}>
        <Photo image={scene.image} style={drift} />
      </View>
      <Chip icon={scene.chips[0]} style={{ left: left + frameW - 26, top: top - 18 }} />
      <Chip icon={scene.chips[1]} style={{ left: left - 30, top: top + frameH * 0.72 }} />
      {scene.chips[2] ? <Chip icon={scene.chips[2]} style={{ left: left + frameW + 2, top: top + frameH - 30 }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: layout.page, minHeight: 56 },
  progress: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotActive: { width: 26, height: 7, borderRadius: 4, overflow: 'hidden' },
  dotFill: { height: 7, borderRadius: 4 },
  slide: { paddingHorizontal: layout.page, paddingTop: spacing.md, gap: spacing.xl },
  copy: { gap: spacing.sm, alignItems: 'center', paddingHorizontal: spacing.sm },
  backCard: { position: 'absolute', borderRadius: 26, overflow: 'hidden', borderWidth: 3 },
  frontCard: { position: 'absolute', borderRadius: 30, overflow: 'hidden', borderWidth: 3 },
  frame: { position: 'absolute', borderRadius: 30, overflow: 'hidden', borderWidth: 3 },
  dashed: { position: 'absolute', borderRadius: 30, borderWidth: 1.5, borderStyle: 'dashed', opacity: 0.9 },
  chip: { position: 'absolute', width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  photoFade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  caption: { position: 'absolute', left: 14, right: 14, bottom: 12, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  capRight: { alignItems: 'flex-end' },
  capText: { color: brand.white },
  footer: { paddingHorizontal: layout.page, gap: spacing.xs },
  pill: { borderRadius: 999 },
  login: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
});
