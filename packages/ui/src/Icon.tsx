import { icon } from '@clickco/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { type IconSize, iconPixels } from './icon.sizes';
import { TONE_COLOR, type Tone } from './tones';

export type { LucideIcon } from 'lucide-react-native';
export type { IconSize } from './icon.sizes';

export interface IconProps {
  readonly icon: LucideIcon;
  /** text/secondary unless active (DESIGN.md §Iconography). */
  readonly tone?: Tone;
  /** 20px by default; small 16, medium 28, large 40. */
  readonly size?: IconSize;
  /** Decorative by default; pass a label when the icon alone carries meaning. */
  readonly accessibilityLabel?: string;
}

/** Lucide, 1.5px stroke — the token defaults, applied everywhere. */
export function Icon({
  icon: Glyph,
  tone = 'secondary',
  size = 'default',
  accessibilityLabel,
}: IconProps) {
  const glyph = (
    <Glyph size={iconPixels(size)} color={TONE_COLOR[tone]} strokeWidth={icon.strokeWidth} />
  );
  // Accessibility props live on a View: on web, react-native-svg would leak them onto the <svg>.
  if (accessibilityLabel === undefined) return glyph;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {glyph}
    </View>
  );
}
