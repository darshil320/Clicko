import { icon } from '@clickco/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { TONE_COLOR, type Tone } from './tones';

export type { LucideIcon } from 'lucide-react-native';

export interface IconProps {
  readonly icon: LucideIcon;
  /** text/secondary unless active (DESIGN.md §Iconography). */
  readonly tone?: Tone;
  readonly size?: 'default' | 'large';
  /** Decorative by default; pass a label when the icon alone carries meaning. */
  readonly accessibilityLabel?: string;
}

const LARGE_SCALE = 2;

/** Lucide, 20px, 1.5px stroke — the token defaults, applied everywhere. */
export function Icon({
  icon: Glyph,
  tone = 'secondary',
  size = 'default',
  accessibilityLabel,
}: IconProps) {
  const px = size === 'large' ? icon.size * LARGE_SCALE : icon.size;
  const glyph = <Glyph size={px} color={TONE_COLOR[tone]} strokeWidth={icon.strokeWidth} />;
  // Accessibility props live on a View: on web, react-native-svg would leak them onto the <svg>.
  if (accessibilityLabel === undefined) return glyph;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {glyph}
    </View>
  );
}
