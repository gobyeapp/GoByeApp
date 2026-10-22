/**
 * GoBye design tokens. Documented in docs/DESIGN_SYSTEM.md — change both together.
 * Contrast ratios for every text/background pair are listed in the design system doc.
 */

/**
 * Brand colours (working, 2026-10-21): used ONLY as deliberate accents — logo details, illustrations,
 * route highlights, rewards and occasional emphasis. Never for page backgrounds, everyday controls,
 * navigation or body text. The interface itself is monochrome (black, white and neutral greys).
 */
export const brand = {
  aubergine: '#351A40',
  tangerine: '#FF751F',
  white: '#FFFFFF',
  black: '#000000',
} as const;

/**
 * Semantic colour tokens. Groups: background / surface / text / border / action / status / brand-accent.
 * Screens use these names only — never raw hex values.
 */
export interface ColorTokens {
  /* Backgrounds */
  /** Page background, headers, safe areas and the tab bar. */
  background: string;
  /** Sheets, dialogs and menus (raised over the page). */
  surface: string;
  /** Subtle fills: inputs, grouped content, tiles. */
  surfaceMuted: string;
  /** Neutral fill behind a selected row, chip or option (always paired with a check, radio or weight change). */
  surfaceSelected: string;
  /** Cards on the page. */
  card: string;
  /* Text & icons */
  text: string;
  textSecondary: string;
  /* Borders */
  border: string;
  /* Actions */
  /** Primary action fill (black in light mode, white in dark mode); also focus rings, progress and links. */
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  /** Secondary action fill (pale grey / dark grey). */
  secondary: string;
  secondaryPressed: string;
  onSecondary: string;
  /** Inverse surface for toasts. */
  inverseSurface: string;
  onInverse: string;
  /* Status (always paired with a label or icon) */
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  danger: string;
  dangerSurface: string;
  neutralSurface: string;
  /** Status colours that read on the inverse (toast) surface. */
  successOnInverse: string;
  dangerOnInverse: string;
  /* Overlays */
  scrim: string;
  /* Identity (avatars without a photo) — neutral, not brand-filled */
  identity: string;
  onIdentity: string;
  /* Brand accents */
  accent: string;
  /** Tangerine-family colour that is readable as text on this theme's background. */
  accentText: string;
  /** Route lines on maps (brand highlight). */
  mapRoute: string;
  /** Selected bottom-navigation item (brand: aubergine on white, tangerine on black). */
  navActive: string;
  /** Floating navigation bar surface. */
  navSurface: string;
  /** Contextual brand banner (e.g. wallet prompts) and its text. */
  brandBanner: string;
  onBrandBanner: string;
}

/** Light mode: white page, near-black text, neutral greys; black primary buttons. */
export const lightColors: ColorTokens = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F7F7',
  surfaceSelected: '#F0F0F0',
  card: '#FFFFFF',
  text: '#171717',
  textSecondary: '#666666',
  border: '#E8E8E8',
  primary: '#171717',
  primaryPressed: '#3D3D3D',
  onPrimary: '#FFFFFF',
  secondary: '#F2F2F2',
  secondaryPressed: '#E5E5E5',
  onSecondary: '#171717',
  inverseSurface: '#171717',
  onInverse: '#FFFFFF',
  success: '#15803D',
  successSurface: '#EAF6EE',
  // Dark amber on pale yellow (never bright yellow text on white): 7:1+ contrast.
  warning: '#92400E',
  warningSurface: '#FEF9C3',
  danger: '#C62828',
  dangerSurface: '#FDECEC',
  neutralSurface: '#F2F2F2',
  successOnInverse: '#4ADE80',
  dangerOnInverse: '#F87171',
  scrim: 'rgba(0,0,0,0.45)',
  identity: '#EDEDED',
  onIdentity: '#171717',
  accent: brand.tangerine,
  accentText: '#B4500F',
  mapRoute: brand.tangerine,
  navActive: brand.aubergine,
  navSurface: '#F7F7F7',
  brandBanner: brand.aubergine,
  onBrandBanner: '#FFFFFF',
};

/** Dark mode: true black page, light text; elevation through grey surfaces and borders, not shadows. */
export const darkColors: ColorTokens = {
  background: '#000000',
  surface: '#1A1A1A',
  surfaceMuted: '#111111',
  surfaceSelected: '#262626',
  card: '#1A1A1A',
  text: '#FAFAFA',
  textSecondary: '#A3A3A3',
  border: '#292929',
  primary: '#FAFAFA',
  primaryPressed: '#D4D4D4',
  onPrimary: '#000000',
  secondary: '#262626',
  secondaryPressed: '#333333',
  onSecondary: '#FAFAFA',
  inverseSurface: '#262626',
  onInverse: '#FAFAFA',
  success: '#4ADE80',
  successSurface: '#0F2A1A',
  warning: '#FCD34D',
  warningSurface: '#2B2108',
  danger: '#F87171',
  dangerSurface: '#2C1313',
  neutralSurface: '#1F1F1F',
  successOnInverse: '#4ADE80',
  dangerOnInverse: '#F87171',
  scrim: 'rgba(0,0,0,0.7)',
  identity: '#262626',
  onIdentity: '#FAFAFA',
  accent: '#FF8A40',
  accentText: '#FF9A5C',
  mapRoute: '#FF8A40',
  navActive: brand.tangerine,
  navSurface: '#1A1A1A',
  brandBanner: brand.aubergine,
  onBrandBanner: '#FFFFFF',
};

/**
 * @deprecated The Jade / Aubergine preview switch was retired on 2026-10-21 (monochrome system, D-034).
 * Kept so older stored settings still type-check; it no longer changes colours.
 */
export type BrandDirection = 'jade' | 'aubergine';

export const paletteFor = (_direction: BrandDirection, scheme: 'light' | 'dark'): ColorTokens => (scheme === 'dark' ? darkColors : lightColors);

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  screen: 20,
} as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** Minimum interactive size — satisfies Apple 44pt and Android 48dp. */
export const minTouch = 48;

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type FontWeightToken = keyof typeof fontFamily;

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  weight: FontWeightToken;
}

/** Mirrors Apple's default Dynamic Type "Large" sizes. */
/**
 * Type scale (UI audit 2026-10-21): tightened so headings no longer dominate small screens.
 * Page titles 24, hero headlines 28, body 16. All sizes scale with the system text size
 * (Text caps the multiplier per variant so layouts stay intact at large accessibility sizes).
 */
export const typography = {
  largeTitle: { fontSize: 28, lineHeight: 34, weight: 'bold' },
  title1: { fontSize: 24, lineHeight: 30, weight: 'bold' },
  title2: { fontSize: 20, lineHeight: 26, weight: 'semibold' },
  title3: { fontSize: 18, lineHeight: 24, weight: 'semibold' },
  headline: { fontSize: 16, lineHeight: 22, weight: 'semibold' },
  body: { fontSize: 16, lineHeight: 22, weight: 'regular' },
  callout: { fontSize: 15, lineHeight: 20, weight: 'regular' },
  subhead: { fontSize: 14, lineHeight: 19, weight: 'medium' },
  footnote: { fontSize: 13, lineHeight: 18, weight: 'regular' },
  caption: { fontSize: 12, lineHeight: 16, weight: 'medium' },
} as const satisfies Record<string, TypeStyle>;

export type TypographyVariant = keyof typeof typography;

export const iconSizes = { xs: 16, sm: 20, md: 24, lg: 28, xl: 32 } as const;
export type IconSize = keyof typeof iconSizes;

export const motion = {
  fast: 150,
  base: 250,
  slow: 400,
  /** Standard easing control points: Easing.bezier(0.2, 0, 0, 1) */
  easing: [0.2, 0, 0, 1] as const,
} as const;

/**
 * Layout & alignment rules (brief §14, alignment reference "b"):
 * - Page content sits `page` (20) from the screen edge.
 * - Grouped containers sit at the page edge; their content is inset by `container` (16).
 * - Row icons sit centred in a fixed `iconBox` (40); text starts `iconGap` (12) after it, so text keeps a
 *   constant distance from its own icon at every nesting level instead of snapping to one universal edge.
 * - Vertical rhythm: `rowGap` between rows, `section` between groups.
 */
export const layout = {
  page: 20,
  container: 16,
  iconBox: 40,
  iconGap: 12,
  rowGap: 8,
  section: 24,
  controlRadius: 14,
  cardRadius: 20,
  sheetRadius: 28,
} as const;

/** Light/Dark/System preference (brief §1). */
export type AppearancePreference = 'system' | 'light' | 'dark';

export const shadows = {
  float: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sheet: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;

/**
 * Elevation for inputs (2026-10-21 input refinement). Layered, low-opacity shadows via `boxShadow`
 * (React Native new architecture and web). Only the primary search input gets `primaryInput`; ordinary
 * fields stay flat so the hierarchy is clear. Dark mode can't show shadows on black, so elevation there
 * comes from a lighter surface plus a faint outline ring.
 */
export const inputElevation = {
  light: {
    rest: { boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.06), 0px 4px 12px rgba(0, 0, 0, 0.06), 0px 12px 28px rgba(0, 0, 0, 0.05)' },
    pressed: { boxShadow: '0px 1px 1px rgba(0, 0, 0, 0.07), 0px 2px 6px rgba(0, 0, 0, 0.05)' },
    focused: { boxShadow: '0px 0px 0px 3px rgba(23, 23, 23, 0.08), 0px 4px 12px rgba(0, 0, 0, 0.06), 0px 12px 28px rgba(0, 0, 0, 0.05)' },
  },
  dark: {
    rest: { boxShadow: '0px 0px 0px 1px rgba(255, 255, 255, 0.05), 0px 10px 28px rgba(0, 0, 0, 0.7)' },
    pressed: { boxShadow: '0px 0px 0px 1px rgba(255, 255, 255, 0.04)' },
    focused: { boxShadow: '0px 0px 0px 3px rgba(250, 250, 250, 0.14), 0px 10px 28px rgba(0, 0, 0, 0.7)' },
  },
  /** Primary search input geometry. */
  primary: { height: 60, radius: 20, action: 40, inset: 10 },
} as const;

