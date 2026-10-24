import { color, colorLight, layout, type Palette, radius, space, typography } from './tokens.js';

const px = (n: number): string => `${n}px`;

/** Component sizes from `layout` (DESIGN.md §Components / §Accessibility), e.g. `min-h-tap`, `h-button`. */
const sizes = {
  tap: px(layout.minTapTarget),
  button: px(layout.buttonHeight),
  input: px(layout.inputHeight),
} as const;

function mapValues<T, U>(obj: Record<string, T>, fn: (v: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

/** A palette or a set of extras: colour groups one level deep. */
export type ColourGroups = Readonly<Record<string, string | Readonly<Record<string, string>>>>;

/** Flat list of [css-name, value] for every colour token, e.g. ["accent-default", "#FFB63D"]. */
export function colourEntries(palette: ColourGroups = color): Array<[string, string]> {
  return Object.entries(palette).flatMap(([group, value]) =>
    typeof value === 'string'
      ? [[group, value] as [string, string]]
      : Object.entries(value).map(
          ([variant, hex]) => [`${group}-${variant}`, hex] as [string, string],
        ),
  );
}

/** `:root { --color-…: … }` for the web surfaces; pass `colorLight` for the white theme. */
export function cssVariables(palette: Palette = color): string {
  const lines = colourEntries(palette).map(([name, hex]) => `  --color-${name}: ${hex};`);
  return [':root {', ...lines, '}'].join('\n');
}

/** Tailwind / NativeWind preset for a palette. Apps extend it; they never add raw values. */
export function makeTailwindPreset<P extends Palette>(palette: P) {
  return {
    theme: {
      extend: {
        colors: palette,
        spacing: mapValues(space as unknown as Record<string, number>, px),
        borderRadius: mapValues(radius, px),
        fontFamily: {
          display: [typography.family.display, ...typography.family.indicFallback],
          sans: [typography.family.body, ...typography.family.indicFallback],
        },
        fontSize: mapValues(typography.scale, (s) => [
          px(s.size),
          { lineHeight: px(s.lineHeight), fontWeight: s.weight },
        ]),
        letterSpacing: { micro: `${typography.microTrackingEm}em` },
        height: sizes,
        minHeight: sizes,
        width: { tap: sizes.tap },
        minWidth: { tap: sizes.tap },
      },
    },
  } as const;
}

/** The dark preset (DESIGN.md) — the ops console. */
export const tailwindPreset = makeTailwindPreset(color);

/** The white preset (DESIGN-LIGHT.md, ADR-0017) — the client app. */
export const lightTailwindPreset = makeTailwindPreset(colorLight);
