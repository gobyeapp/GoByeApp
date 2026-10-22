import { createContext, createElement, useContext, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { paletteFor, type AppearancePreference, type BrandDirection, type ColorTokens } from './tokens';

export interface Theme {
  scheme: 'light' | 'dark';
  direction: BrandDirection;
  colors: ColorTokens;
}

const BrandDirectionContext = createContext<BrandDirection>('jade');

/** Preview-only: lets the team compare the two candidate palettes on device (final palette pending). */
export function BrandDirectionProvider({ direction, children }: { direction: BrandDirection; children: ReactNode }) {
  return createElement(BrandDirectionContext.Provider, { value: direction }, children);
}

/**
 * Current appearance. Follows the system unless the user chose Light or Dark in Account → Appearance
 * (brief §1, D-028), which is applied through `applyAppearance` (React Native's Appearance override).
 */
export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const direction = useContext(BrandDirectionContext);
  return { scheme, direction, colors: paletteFor(direction, scheme) };
}

/**
 * Apply the user's appearance preference app-wide. Uses React Native's Appearance override so
 * `useColorScheme`, native alerts, the keyboard and the map style all follow it.
 */
export function applyAppearance(pref: AppearancePreference) {
  // react-native-web (QA build only) has no override; there the page follows the browser's scheme.
  if (typeof Appearance.setColorScheme !== 'function') return;
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
}
