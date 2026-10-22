import { memo } from 'react';
import { useTheme } from '../theme/useTheme';
import { iconSizes, type ColorTokens, type IconSize } from '../theme/tokens';
import { iconRegistry, type IconName } from './registry';

export interface GoByeIconProps {
  name: IconName;
  /** Regular (default) for standard/inactive; Filled for selected/active/important status. */
  variant?: 'regular' | 'filled';
  /** Token (xs 16 · sm 20 · md 24 · lg 28 · xl 32) or explicit number. */
  size?: IconSize | number;
  /** Colour token name or explicit colour string. Defaults to `text`. */
  color?: keyof ColorTokens | (string & {});
  /**
   * Icons are decorative by default — the interactive parent carries the accessibility label.
   * Provide `label` only for a standalone meaningful icon (e.g. a status indicator).
   */
  label?: string;
}

function IconBase({ name, variant = 'regular', size = 'md', color = 'text', label }: GoByeIconProps) {
  const { colors } = useTheme();
  const entry = iconRegistry[name];
  const Component = variant === 'filled' ? entry.filled : entry.regular;
  const px = typeof size === 'number' ? size : iconSizes[size];
  const resolved = color in colors ? colors[color as keyof ColorTokens] : color;
  return (
    <Component
      size={px}
      color={resolved}
      accessible={!!label}
      accessibilityLabel={label}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    />
  );
}

export const Icon = memo(IconBase);
export type { IconName };
