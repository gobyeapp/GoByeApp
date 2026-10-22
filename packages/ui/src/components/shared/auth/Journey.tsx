import { createContext, forwardRef, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, TextInput, View, type LayoutChangeEvent, type TextInputProps } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { passwordChecks, passwordStrength, type SocialProvider } from '@gobye/core';
import { OrDivider, SocialButtons } from './AuthKit';
import { BRAND_NAME, BrandMark } from '../../../brand';
import { Icon, type IconName } from '../../../icons/Icon';
import { brand, fontFamily, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/useTheme';
import { Button } from '../../Button';
import { Text } from '../../Text';

/**
 * The website's "Join the waitlist" journey, rebuilt for the app (owner: "adopt the waitlist… down to the
 * button and all"): a plum hero with the route progress and a car that drives from stop to stop, one
 * question per step, big fields, choice tiles, a round back button beside the tangerine CTA, and a
 * pass at the end. Colours are the website's (styles.css .sheet-hero, .route, .ctile, .pass).
 */

export const PLUM = { deep: '#2A1233', mid: '#4B2159', glowWarm: '#FF751F', glowCool: '#9B50B4', eyebrow: '#FFC59E' };
const EASE = Easing.bezier(0.3, 0.8, 0.2, 1);

/** Plum gradient with a warm glow top-right and a violet glow bottom-left (website .sheet-hero). */
export function PlumBackground({ radius = 0 }: { radius?: number }) {
  return (
    <Svg style={[StyleSheet.absoluteFill, { borderRadius: radius }]} preserveAspectRatio="none" viewBox="0 0 100 100" pointerEvents="none">
      <Defs>
        <LinearGradient id="plum" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={PLUM.deep} />
          <Stop offset="1" stopColor={PLUM.mid} />
        </LinearGradient>
        <RadialGradient id="warm" cx="100" cy="0" rx="90" ry="120" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={PLUM.glowWarm} stopOpacity={0.45} />
          <Stop offset="0.6" stopColor={PLUM.glowWarm} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="cool" cx="0" cy="100" rx="70" ry="90" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={PLUM.glowCool} stopOpacity={0.45} />
          <Stop offset="0.7" stopColor={PLUM.glowCool} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#plum)" />
      <Rect x="0" y="0" width="100" height="100" fill="url(#cool)" />
      <Rect x="0" y="0" width="100" height="100" fill="url(#warm)" />
    </Svg>
  );
}

/** Route progress: a track with a tangerine fill, four stops and a car chip that drives to the current step. */
export function RouteProgress({ step, labels, arrived }: { step: number; labels: string[]; arrived?: boolean }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const p = useSharedValue(0);
  const target = labels.length > 1 ? step / (labels.length - 1) : 0;
  useEffect(() => {
    p.value = reduce ? target : withTiming(target, { duration: 600, easing: EASE });
  }, [target, reduce, p]);
  const inner = Math.max(0, w - 20);
  const fill = useAnimatedStyle(() => ({ width: inner * p.value }));
  const car = useAnimatedStyle(() => ({ transform: [{ translateX: 10 + inner * p.value - 16 }] }));
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  return (
    <View
      style={styles.route}
      onLayout={onLayout}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step + 1} of ${labels.length}: ${labels[step]}`}
      accessibilityValue={{ min: 1, max: labels.length, now: step + 1 }}
    >
      <View style={styles.track}>
        <Animated.View style={[styles.fill, fill]}>
          <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 1">
            <Defs>
              <LinearGradient id="rf" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFC59E" />
                <Stop offset="1" stopColor={brand.tangerine} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="1" fill="url(#rf)" />
          </Svg>
        </Animated.View>
      </View>
      {labels.map((_, i) => (
        <View key={i} style={[styles.stop, { left: 10 + (inner * i) / Math.max(1, labels.length - 1) - 5, backgroundColor: i <= step ? brand.tangerine : 'rgba(255,255,255,0.28)' }]} />
      ))}
      <Animated.View style={[styles.car, { backgroundColor: arrived ? brand.tangerine : '#FFFFFF' }, car]}>
        <Icon name="car" variant="filled" size={18} color={arrived ? '#FFFFFF' : PLUM.mid} />
      </Animated.View>
      <View style={styles.labels}>
        {labels.map((l, i) => (
          <Text key={l} variant="caption" style={[styles.label, { textAlign: i === 0 ? 'left' : i === labels.length - 1 ? 'right' : 'center', color: i === step ? '#FFFFFF' : 'rgba(255,255,255,0.62)' }]}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** The plum header: close, eyebrow, title and the route. */
export function JourneyHero({ eyebrow, title, step, labels, onClose, topInset, arrived, compact, collapsed }: { eyebrow?: string; title: string; step: number; labels: string[]; onClose: () => void; topInset: number; arrived?: boolean; compact?: boolean; collapsed?: boolean }) {
  if (collapsed) {
    // While typing: a slim bar (title, step count, thin progress) so the field and keyboard get the room.
    const p = labels.length > 1 ? step / (labels.length - 1) : 0;
    return (
      <View style={[styles.heroSlim, { paddingTop: topInset + spacing.sm }]}>
        <PlumBackground />
        <View style={styles.slimRow}>
          <Text style={styles.slimTitle} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" style={styles.slimStep}>
            {step + 1} / {labels.length} · {labels[step]}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={({ pressed }) => [styles.xSlim, { opacity: pressed ? 0.7 : 1 }]}>
            <Icon name="close" size={15} color="#FFFFFF" />
          </Pressable>
        </View>
        <View style={styles.slimTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.slimFill, { width: `${Math.max(6, p * 100)}%` }]} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.hero, { paddingTop: topInset + (compact ? spacing.sm : spacing.lg) }, compact && styles.heroCompact]}>
      <PlumBackground />
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={({ pressed }) => [styles.x, { top: topInset + spacing.md, opacity: pressed ? 0.7 : 1 }]} testID="journey-close">
        <Icon name="close" size={17} color="#FFFFFF" />
      </Pressable>
      {eyebrow ? (
        <Text variant="caption" style={styles.eyebrow}>
          {eyebrow}
        </Text>
      ) : null}
      <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]} accessibilityRole="header">
        {title}
      </Text>
      <RouteProgress step={step} labels={labels} arrived={arrived} />
    </View>
  );
}

/** Keyboard open or not (Will* events on iOS for a smoother hand-off, Did* on Android). */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const showE = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showE, () => setOpen(true));
    const b = Keyboard.addListener(hideE, () => setOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return open;
}

const KeyboardOpenContext = createContext(false);
/** Inside a JourneyFlow step: true while the keyboard is up (steps hide extras so the field stays in view). */
export const useJourneyKeyboard = () => useContext(KeyboardOpenContext);

/**
 * A whole journey screen with no scrolling (owner: "everything should be a focus point"): the plum hero,
 * one step in view at a time on a sliding track that fills the space between hero and actions, then the
 * round back button beside the tangerine CTA. On short phones the hero compacts.
 */
export function JourneyFlow({
  eyebrow,
  title,
  labels,
  step,
  steps,
  onClose,
  onBack,
  cta,
  footnote,
}: {
  eyebrow?: string;
  title: string;
  labels: string[];
  step: number;
  steps: ReactNode[];
  onClose: () => void;
  onBack: () => void;
  cta: { title: string; onPress: () => void; loading?: boolean; loadingLabel?: string; disabled?: boolean; testID?: string };
  footnote?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const compact = height < 740;
  const typing = useKeyboardOpen();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (!w) return;
    x.value = reduce ? -step * w : withTiming(-step * w, { duration: 500, easing: EASE });
  }, [step, w, reduce, x]);
  const track = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  // Web QA build only: a browser scrolls an overflow-hidden box to show a focused input, which would
  // shift the track. Keep the viewport pinned (native views never scroll themselves).
  const viewportRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = viewportRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const pin = () => {
      if (node.scrollLeft) node.scrollLeft = 0;
    };
    node.addEventListener('scroll', pin);
    return () => node.removeEventListener('scroll', pin);
  }, []);

  return (
    <KeyboardOpenContext.Provider value={typing}>
    <KeyboardAvoidingView style={[styles.flowRoot, { backgroundColor: colors.background }]} behavior="padding">
      <JourneyHero eyebrow={eyebrow} title={title} step={step} labels={labels} onClose={onClose} topInset={insets.top} compact={compact} collapsed={typing} />
      <View ref={viewportRef} style={styles.viewport} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <Animated.View style={[styles.flowTrack, { width: w * steps.length || undefined }, track]}>
          {steps.map((node, i) => (
            <View
              key={i}
              style={[styles.flowStepBox, { width: w || undefined, maxWidth: w || undefined }]}
              accessibilityElementsHidden={i !== step}
              importantForAccessibility={i === step ? 'auto' : 'no-hide-descendants'}
              pointerEvents={i === step ? 'auto' : 'none'}
            >
              {/* A safety net only: steps are sized to fit, but with the keyboard up on a small phone the rider can still reach everything. */}
              <ScrollView contentContainerStyle={[styles.flowStep, { paddingTop: typing ? 16 : compact ? 18 : 26 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
                {node}
              </ScrollView>
            </View>
          ))}
        </Animated.View>
      </View>
      <View style={[styles.flowActions, { paddingBottom: typing ? spacing.sm : Math.max(insets.bottom, spacing.md) + (compact ? 0 : 4) }]}>
        <View style={styles.flowRow}>
          {step > 0 ? <RoundBack onPress={onBack} disabled={cta.loading} /> : null}
          <Button variant="brand" title={cta.title} loading={cta.loading} loadingLabel={cta.loadingLabel} disabled={cta.disabled} onPress={cta.onPress} style={styles.flex} testID={cta.testID} />
        </View>
        {footnote && !typing ? <View style={styles.flowFoot}>{footnote}</View> : null}
      </View>
    </KeyboardAvoidingView>
    </KeyboardOpenContext.Provider>
  );
}

/** One quiet line under the CTA: what's simulated in this preview. */
export function PreviewNote({ text = 'Preview · simulated' }: { text?: string }) {
  return (
    <View style={styles.preview} accessible accessibilityLabel={text}>
      <Icon name="info" size={12} color="textSecondary" />
      <Text variant="caption" weight="regular" color="textSecondary">
        {text}
      </Text>
    </View>
  );
}

/** Apple / Google, then "or". Hidden while the keyboard is up so the field being typed in stays in view. */
export function SocialFirst({ onPress, busy }: { onPress: (p: SocialProvider) => void; busy: SocialProvider | null }) {
  const typing = useJourneyKeyboard();
  if (typing) return null;
  return (
    <>
      <SocialButtons onPress={onPress} busy={busy} />
      <OrDivider tight />
    </>
  );
}

/** Only while not typing (secondary links and notes). */
export function WhenNotTyping({ children }: { children: ReactNode }) {
  return useJourneyKeyboard() ? null : <>{children}</>;
}

/**
 * Live password feedback for a new password: a three-part strength bar with its word on the right,
 * then the rule as three ticks that turn green as they're met (same rule as `validatePassword`).
 */
export function PasswordRules({ password, testID }: { password: string; testID?: string }) {
  const { colors } = useTheme();
  const strength = passwordStrength(password);
  const meta = {
    empty: { bars: 0, label: '', tone: colors.textSecondary },
    weak: { bars: 1, label: 'Too weak', tone: colors.danger },
    okay: { bars: 2, label: 'Good', tone: colors.warning },
    strong: { bars: 3, label: 'Strong', tone: colors.success },
  }[strength];
  const checks = passwordChecks(password);
  return (
    <View style={[styles.pwCard, { backgroundColor: colors.surfaceMuted }]} testID={testID}>
      <View style={styles.pwHead} accessible accessibilityLabel={meta.label ? `Password strength: ${meta.label}` : 'Password strength'}>
        <Text variant="footnote" weight="semibold" color="textSecondary">
          Strength
        </Text>
        <Text variant="footnote" weight="semibold" style={{ color: meta.tone }}>
          {meta.label}
        </Text>
      </View>
      <View style={styles.pwBars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[1, 2, 3].map((b) => (
          <StrengthBar key={b} on={b <= meta.bars} color={meta.tone} track={colors.border} />
        ))}
      </View>
      <View style={styles.pwChecks}>
        {checks.map((c) => (
          <View key={c.id} style={styles.pwCheck} accessible accessibilityLabel={`${c.label}: ${c.met ? 'done' : 'not yet'}`} testID={testID ? `${testID}-${c.id}${c.met ? '-met' : ''}` : undefined}>
            <Icon name="checkCircle" variant={c.met ? 'filled' : 'regular'} size={16} color={c.met ? 'success' : 'textSecondary'} />
            <Text variant="footnote" weight={c.met ? 'semibold' : 'regular'} color={c.met ? 'text' : 'textSecondary'}>
              {c.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function StrengthBar({ on, color, track }: { on: boolean; color: string; track: string }) {
  const reduce = useReducedMotion();
  const fill = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    fill.value = withTiming(on ? 1 : 0, { duration: reduce ? 0 : 220, easing: Easing.out(Easing.cubic) });
  }, [on, reduce, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View style={[styles.pwBar, { backgroundColor: track }]}>
      <Animated.View style={[styles.pwBarFill, { backgroundColor: color }, style]} />
    </View>
  );
}

/** Step heading + hint, the website's `.q` and `.hint`. */
export function StepTitle({ title, hint }: { title: string; hint?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stepHead}>
      <Text style={[styles.q, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      {hint ? (
        <Text variant="callout" color="textSecondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Website .input-ico.big: tall, rounded, icon on the left that takes the plum tint while focused. */
export const JourneyField = forwardRef<TextInput, TextInputProps & { icon: IconName; label: string; prefix?: string; error?: string; trailing?: ReactNode }>(function JourneyField(
  { icon, label, prefix, error, trailing, onFocus, onBlur, ...input },
  ref,
) {
  const { colors, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  const tint = focused ? (scheme === 'dark' ? '#C79BD6' : PLUM.mid) : colors.textSecondary;
  return (
    <View style={styles.fieldWrap}>
      <View
        style={[
          styles.field,
          {
            backgroundColor: scheme === 'dark' ? colors.surface : '#FFFFFF',
            borderColor: error ? colors.danger : focused ? (scheme === 'dark' ? '#C79BD6' : PLUM.mid) : scheme === 'dark' ? colors.border : '#E7E3EA',
            borderWidth: focused || error ? 1.5 : 1,
          },
        ]}
      >
        <Icon name={icon} size={20} color={tint} />
        {prefix ? (
          <Text variant="headline" style={{ color: colors.text }}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          {...input}
          accessibilityLabel={label}
          accessibilityHint={error}
          placeholderTextColor={scheme === 'dark' ? colors.textSecondary : '#A7A3AA'}
          keyboardAppearance={scheme}
          selectionColor={PLUM.mid}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: colors.text, fontFamily: fontFamily.medium }, { outlineStyle: 'none' } as object]}
        />
        {trailing}
      </View>
      {error ? (
        <View style={styles.err} accessibilityLiveRegion="polite">
          <Icon name="warning" size={14} color="danger" />
          <Text variant="footnote" color="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/** Website .ctile: a choice tile that fills with ink when chosen (tick + colour, not colour alone). */
export function ChoiceTile({ icon, title, subtitle, selected, onPress, wide, testID }: { icon: IconName; title: string; subtitle?: string; selected: boolean; onPress: () => void; wide?: boolean; testID?: string }) {
  const { colors, scheme } = useTheme();
  const ink = scheme === 'dark' ? '#FAFAFA' : '#171717';
  const onInk = scheme === 'dark' ? '#000000' : '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      testID={testID}
      style={({ pressed }) => [
        styles.tile,
        wide && styles.tileWide,
        {
          backgroundColor: selected ? ink : scheme === 'dark' ? colors.surface : '#FFFFFF',
          borderColor: selected ? ink : scheme === 'dark' ? colors.border : '#E7E3EA',
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <Icon name={icon} variant={selected ? 'filled' : 'regular'} size={22} color={brand.tangerine} />
      <View style={styles.flex}>
        <Text variant="headline" style={{ color: selected ? onInk : colors.text }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" weight="medium" style={{ color: selected ? (scheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)') : colors.textSecondary }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <View style={[styles.tick, { backgroundColor: brand.tangerine }]}>
          <Icon name="check" size={13} color="#FFFFFF" />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Website .round-back: a 56 pt round back button that sits beside the CTA. */
export function RoundBack({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const { colors, scheme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Back"
      testID="journey-back"
      style={({ pressed }) => [
        styles.back,
        {
          backgroundColor: pressed ? colors.surfaceMuted : scheme === 'dark' ? colors.surface : '#FFFFFF',
          borderColor: scheme === 'dark' ? colors.border : '#E4E1E6',
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <Icon name="back" size={20} color="text" />
    </Pressable>
  );
}

/**
 * The member pass (website .pass): plum top with the mark, name / place / member since, a perforation, a
 * verified foot. `tag` names the pass ("RIDER PASS", "DRIVER PASS").
 */
export function MemberPass({ name, city, since, note, tag = 'RIDER PASS', placeLabel = 'City', testID = 'rider-pass' }: { name: string; city: string; since: string; note: string; tag?: string; placeLabel?: string; testID?: string }) {
  const { colors, scheme } = useTheme();
  const notch = colors.background;
  return (
    <View style={[styles.pass, { backgroundColor: scheme === 'dark' ? colors.surface : '#FFFFFF', borderColor: scheme === 'dark' ? colors.border : 'rgba(53,26,64,0.08)' }]} testID={testID}>
      <View style={styles.passTop}>
        <PlumBackground />
        <BrandMark size={26} inverse />
        <Text variant="headline" style={styles.passBrand}>
          {BRAND_NAME}
        </Text>
        <Text variant="caption" style={styles.passTag}>
          {tag}
        </Text>
      </View>
      <View style={styles.passBody}>
        <Kv label="Name" value={name} wide />
        <Kv label={placeLabel} value={city} />
        <Kv label="Member since" value={since} />
      </View>
      <View style={styles.passCut} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.passNotch, styles.passNotchL, { backgroundColor: notch }]} />
        <View style={[styles.passDash, { borderColor: scheme === 'dark' ? colors.border : '#E7E1EA' }]} />
        <View style={[styles.passNotch, styles.passNotchR, { backgroundColor: notch }]} />
      </View>
      <View style={styles.passFoot}>
        <View style={[styles.okDot, { backgroundColor: colors.success }]}>
          <Icon name="check" size={14} color="#FFFFFF" />
        </View>
        <Text variant="callout" color="textSecondary" style={styles.flex}>
          {note}
        </Text>
      </View>
    </View>
  );
}

/** Rider name kept for the rider app. */
export const RiderPass = MemberPass;

function Kv({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.kv, wide && styles.kvWide]} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text variant="caption" style={[styles.kvLabel, { color: colors.textSecondary }]}>
        {label.toUpperCase()}
      </Text>
      <Text variant="title3" style={{ color: colors.text }} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  flowRoot: { flex: 1 },
  viewport: { flex: 1, overflow: 'hidden' },
  flowTrack: { flexDirection: 'row', flex: 1 },
  // Each step is exactly one viewport wide: content can never widen it and shift the steps after it.
  flowStepBox: { flexShrink: 0, overflow: 'hidden' },
  flowStep: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  flowActions: { paddingHorizontal: 20, paddingTop: spacing.sm, gap: 6 },
  flowRow: { flexDirection: 'row', gap: 10 },
  flowFoot: { alignItems: 'center' },
  stepHead: { gap: 6, marginBottom: 4 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  q: { fontFamily: 'Inter_700Bold', fontSize: 23, lineHeight: 27, letterSpacing: -0.8 },
  hero: { paddingHorizontal: 24, paddingBottom: 18, overflow: 'hidden' },
  x: { position: 'absolute', right: 18, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', zIndex: 2 },
  eyebrow: { color: PLUM.eyebrow, fontFamily: 'Inter_700Bold', letterSpacing: 3, fontSize: 11 },
  heroCompact: { paddingBottom: 10 },
  heroSlim: { paddingHorizontal: 20, paddingBottom: 10, overflow: 'hidden', gap: 8 },
  slimRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  slimTitle: { flex: 1, color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 17, letterSpacing: -0.4 },
  slimStep: { color: PLUM.eyebrow, fontFamily: 'Inter_600SemiBold' },
  xSlim: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  slimTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.16)', overflow: 'hidden' },
  slimFill: { height: 3, borderRadius: 2, backgroundColor: brand.tangerine },
  heroTitleCompact: { fontSize: 24, lineHeight: 28, marginTop: 4 },
  heroTitle: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 32, letterSpacing: -1.3, marginTop: 8 },
  route: { height: 54, marginTop: 18 },
  track: { position: 'absolute', left: 10, right: 10, top: 15, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.16)', overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, overflow: 'hidden' },
  stop: { position: 'absolute', top: 12, width: 10, height: 10, borderRadius: 5 },
  car: {
    position: 'absolute',
    top: 1,
    left: 0,
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  labels: { position: 'absolute', left: 0, right: 0, top: 38, flexDirection: 'row' },
  label: { flex: 1, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.4, fontSize: 11 },
  fieldWrap: { gap: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 60, borderRadius: 18, paddingHorizontal: 16 },
  input: { flex: 1, minWidth: 0, height: '100%', fontSize: 18 },
  err: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tile: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1 },
  tileWide: { flexBasis: '100%' },
  tick: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  back: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pass: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, shadowColor: '#351A40', shadowOpacity: 0.35, shadowRadius: 26, shadowOffset: { width: 0, height: 20 }, elevation: 8 },
  passTop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 16, overflow: 'hidden' },
  passBrand: { color: '#FFFFFF', letterSpacing: -0.5 },
  passTag: { marginLeft: 'auto', color: PLUM.eyebrow, fontFamily: 'Inter_700Bold', letterSpacing: 2.3, fontSize: 10.5 },
  passBody: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, rowGap: 14 },
  kv: { flexBasis: '50%', gap: 3 },
  kvWide: { flexBasis: '100%' },
  kvLabel: { fontFamily: 'Inter_700Bold', letterSpacing: 1.6, fontSize: 10.5 },
  passCut: { height: 22, justifyContent: 'center' },
  passNotch: { position: 'absolute', width: 22, height: 22, borderRadius: 11, top: 0 },
  passNotchL: { left: -11 },
  passNotchR: { right: -11 },
  passDash: { marginHorizontal: 18, borderTopWidth: 2, borderStyle: 'dashed' },
  passFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
  okDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  pwCard: { borderRadius: 16, padding: spacing.md, gap: 10 },
  pwHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pwBars: { flexDirection: 'row', gap: 6 },
  pwBar: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  pwBarFill: { height: '100%', borderRadius: 3 },
  pwChecks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 6, marginTop: 2 },
  pwCheck: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
