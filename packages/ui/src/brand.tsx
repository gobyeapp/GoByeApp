import { useEffect } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from './theme/useTheme';

/**
 * Brand assets — PREVIEW, from Go-Bye_Working_Brand_Assets.zip (2026-10-21).
 * The mark is a raster extracted from the logo concept board ("curved G with destination dot",
 * the preferred direction). It is NOT a vector master; replace with approved exports (Q-008).
 * Illustrations are the pack's separate 3D-style renders, resized to 512 px WebP.
 */

/** Display name used in UI copy. The concept boards spell "Go-Bye"; naming is open (Q-046). */
export const BRAND_NAME = 'GoBye';

export const brandImages = {
  mark: require('../assets/brand/mark.png'),
  markInverse: require('../assets/brand/mark-inverse.png'),
  sedan: require('../assets/brand/sedan.webp'),
  wallet: require('../assets/brand/wallet.webp'),
  gift: require('../assets/brand/reward-gift.webp'),
  destination: require('../assets/brand/destination.webp'),
} as const;

/**
 * Onboarding scenes — INTERIM. Cropped from the photographic tiles of the brand pack's
 * "brand-applications" concept board (512 px source). Replace with commissioned photography /
 * footage before launch (ASSET_INVENTORY, Q-050).
 */
export const onboardingImages = {
  pickupMeet: require('../assets/onboarding/pickup-meet.webp'),
  carLivery: require('../assets/onboarding/car-livery.webp'),
  riderWindow: require('../assets/onboarding/rider-window.webp'),
} as const;
export type OnboardingImageName = keyof typeof onboardingImages;

export type IllustrationName = 'sedan' | 'wallet' | 'gift' | 'destination';

/** Logo mark; switches to the light variant on dark backgrounds. Decorative unless labelled. */
export function BrandMark({ size = 32, inverse, label }: { size?: number; inverse?: boolean; label?: string }) {
  const { scheme } = useTheme();
  const useInverse = inverse ?? scheme === 'dark';
  return (
    <Image
      source={useInverse ? brandImages.markInverse : brandImages.mark}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessible={!!label}
      accessibilityLabel={label}
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * 3D-style illustration. Always decorative: the surrounding text carries the meaning.
 * Gentle motion (2026-10-21): a slow float with a slight tilt so the renders feel alive. Each instance
 * starts at a different phase so several on one screen don't move in lockstep. Reduce Motion → still.
 * Pass `still` where motion would distract (e.g. very small sizes).
 */
export function Illustration({ name, size = 160, style, still }: { name: IllustrationName; size?: number; style?: StyleProp<ImageStyle>; still?: boolean }) {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce || still) return;
    t.value = withDelay(Math.floor(Math.random() * 900), withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(t);
  }, [reduce, still, t]);
  const amp = Math.max(2, size * 0.035);
  const motion = useAnimatedStyle(() => ({
    transform: [{ translateY: -amp + t.value * amp * 2 }, { rotate: `${-1.5 + t.value * 3}deg` }],
  }));
  return (
    <Animated.Image
      source={brandImages[name]}
      style={[{ width: size, height: size }, style, motion]}
      resizeMode="contain"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      accessibilityIgnoresInvertColors
    />
  );
}
