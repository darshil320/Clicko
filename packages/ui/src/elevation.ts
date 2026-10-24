import { elevation } from '@clickco/design-tokens';

/**
 * Light-theme elevation (DESIGN-LIGHT §Elevation) as React Native style. The tokens are CSS
 * box-shadow strings; React Native ≥ 0.76 (new architecture) and react-native-web 0.21 take the
 * structured `boxShadow` form below, so screens never carry a raw shadow value.
 * Pure — no React Native imports — so the parser is unit-tested against the tokens.
 */

export type ElevationLevel = keyof typeof elevation;

/** One layer of `boxShadow` in React Native's structured form. */
export interface ShadowLayer {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blurRadius: number;
  readonly spreadDistance: number;
  readonly color: string;
}

export interface ElevationStyle {
  readonly boxShadow?: readonly ShadowLayer[];
}

const LENGTH = String.raw`(-?\d*\.?\d+)(?:px)?`;
const COLOUR = String.raw`(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})`;
const LAYER = new RegExp(`^${LENGTH}\\s+${LENGTH}\\s+${LENGTH}(?:\\s+${LENGTH})?\\s+${COLOUR}$`);
/** Commas that separate layers — not the ones inside rgba(...). */
const LAYER_SEPARATOR = /,(?![^(]*\))/;

/** "0 1px 2px rgba(…), 0 8px 24px rgba(…)" → one ShadowLayer per comma-separated layer. */
export function parseShadow(css: string): readonly ShadowLayer[] {
  return css.split(LAYER_SEPARATOR).map((raw) => {
    const match = LAYER.exec(raw.trim());
    if (!match) throw new Error(`Unsupported shadow layer: "${raw.trim()}"`);
    const [, x, y, blur, spread, colour] = match;
    return {
      offsetX: Number(x),
      offsetY: Number(y),
      blurRadius: Number(blur),
      spreadDistance: spread === undefined ? 0 : Number(spread),
      color: colour as string,
    };
  });
}

const NONE: ElevationStyle = {};

const STYLES: Readonly<Record<ElevationLevel, ElevationStyle>> = {
  sm: { boxShadow: parseShadow(elevation.sm) },
  md: { boxShadow: parseShadow(elevation.md) },
  lg: { boxShadow: parseShadow(elevation.lg) },
};

/** `style={elevationStyle('sm')}` — cards and inputs `sm`, sheets `md`, modals `lg`. */
export function elevationStyle(level: ElevationLevel | 'none'): ElevationStyle {
  return level === 'none' ? NONE : STYLES[level];
}
