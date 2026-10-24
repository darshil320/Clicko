import { icon } from '@clickco/design-tokens';

export type IconSize = 'small' | 'default' | 'medium' | 'large';

/** Multiples of the 20px token: 16 inside small tiles, 28 for hero tiles, 40 for placeholders. */
const SCALE: Readonly<Record<IconSize, number>> = {
  small: 0.8,
  default: 1,
  medium: 1.4,
  large: 2,
};

export function iconPixels(size: IconSize): number {
  return Math.round(icon.size * SCALE[size]);
}
