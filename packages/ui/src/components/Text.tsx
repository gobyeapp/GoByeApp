import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { fontFamily, typography, type ColorTokens, type FontWeightToken, type TypographyVariant } from '../theme/tokens';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  color?: keyof ColorTokens;
  weight?: FontWeightToken;
  align?: TextStyle['textAlign'];
  /** Tabular numerals for fares, timers and ETAs. */
  tabular?: boolean;
}

/**
/**
 * Inter text that scales with the system font size (Dynamic Type / Android font scale).
 * Large display sizes are capped lower than body text so the biggest accessibility sizes stay readable
 * without pushing actions off small screens; a caller can still pass its own `maxFontSizeMultiplier`.
 */
const MAX_SCALE: Record<TypographyVariant, number> = {
  largeTitle: 1.4,
  title1: 1.5,
  title2: 1.6,
  title3: 1.8,
  headline: 2,
  body: 2,
  callout: 2,
  subhead: 2,
  footnote: 2,
  caption: 2,
};

export function Text({ variant = 'body', color = 'text', weight, align, tabular, style, maxFontSizeMultiplier, ...rest }: TextProps) {
  const { colors } = useTheme();
  const t = typography[variant];
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_SCALE[variant]}
      style={[
        {
          fontFamily: fontFamily[weight ?? t.weight],
          fontSize: t.fontSize,
          lineHeight: t.lineHeight,
          color: colors[color],
          textAlign: align,
          fontVariant: tabular ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
    />
  );
}
