import { color, layout, radius, space, typography } from './tokens.js';

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

/** Flat list of [css-name, value] for every colour token, e.g. ["accent-default", "#FFB63D"]. */
export function colourEntries(): Array<[string, string]> {
  return Object.entries(color).flatMap(([group, value]) =>
    typeof value === 'string'
      ? [[group, value] as [string, string]]
      : Object.entries(value).map(
          ([variant, hex]) => [`${group}-${variant}`, hex] as [string, string],
        ),
  );
}

/** `:root { --color-…: … }` for the web surfaces (admin, portal, web). */
export function cssVariables(): string {
  const lines = colourEntries().map(([name, hex]) => `  --color-${name}: ${hex};`);
  return [':root {', ...lines, '}'].join('\n');
}

/** Tailwind / NativeWind preset. Apps extend it; they never add raw values. */
export const tailwindPreset = {
  theme: {
    extend: {
      colors: color,
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
