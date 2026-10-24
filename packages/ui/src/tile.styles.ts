import type { IconSize } from './icon.sizes';
import type { Tone } from './tones';

export type IconTileTone =
  | 'neutral'
  | 'accent'
  | 'accentSubtle'
  | 'success'
  | 'warning'
  | 'emergency';
export type IconTileSize = 'sm' | 'md' | 'lg';
export type IconTileShape = 'rounded' | 'circle';

/** A soft tile behind an icon. The amber fill carries on-accent ink, never an amber stroke. */
export const TILE_TONE: Readonly<
  Record<IconTileTone, { readonly surface: string; readonly icon: Tone }>
> = {
  neutral: { surface: 'bg-surface-base border border-border-subtle', icon: 'secondary' },
  accent: { surface: 'bg-accent-default', icon: 'onAccent' },
  accentSubtle: { surface: 'bg-accent-subtle', icon: 'onAccent' },
  success: { surface: 'bg-success/10', icon: 'success' },
  warning: { surface: 'bg-warning/10', icon: 'warning' },
  emergency: { surface: 'bg-emergency-subtle', icon: 'emergency' },
};

/** 32 / 40 / 56 — all on the 4pt scale. */
export const TILE_SIZE_CLASS: Readonly<Record<IconTileSize, string>> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

const TILE_RADIUS_CLASS: Readonly<Record<IconTileSize, string>> = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
};

export const TILE_ICON_SIZE: Readonly<Record<IconTileSize, IconSize>> = {
  sm: 'small',
  md: 'default',
  lg: 'medium',
};

export function tileShapeClass(size: IconTileSize, shape: IconTileShape): string {
  return shape === 'circle' ? 'rounded-full' : TILE_RADIUS_CLASS[size];
}
