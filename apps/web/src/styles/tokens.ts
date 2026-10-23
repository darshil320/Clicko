import { layout, radius, space, typography } from '@clickco/design-tokens';

/** CSS building blocks derived from @clickco/design-tokens. No raw colours or type sizes. */
export const px = (n: number): string => `${n}px`;
export const v = (name: string): string => `var(--color-${name})`;
export const S = space;
export const L = layout;
export const R = radius;
export const T = typography.scale;

type Step = (typeof typography.scale)[keyof typeof typography.scale];

export const type = (step: Step): string =>
  `font-size:${px(step.size)};line-height:${px(step.lineHeight)};font-weight:${step.weight}`;

/** micro is uppercase with 0.06em tracking (DESIGN.md §Typography). */
export const micro = `${type(T.micro)};text-transform:uppercase;letter-spacing:${typography.microTrackingEm}em`;

const quote = (family: string): string => `"${family}"`;
const fallbacks = [
  ...typography.family.indicFallback.map(quote),
  'system-ui',
  '-apple-system',
  '"Segoe UI"',
  'Roboto',
  'sans-serif',
].join(',');

export const fontBody = `${quote(typography.family.body)},${fallbacks}`;
export const fontDisplay = `${quote(typography.family.display)},${quote(typography.family.body)},${fallbacks}`;

/**
 * DESIGN.md defines a mobile type scale only. Wide screens get the display step at 1.5×,
 * derived from the token rather than invented.
 */
export const displayWide = {
  size: (T.display.size * 3) / 2,
  lineHeight: (T.display.lineHeight * 3) / 2,
} as const;

/** Stroke widths: 1px hairlines (DESIGN.md §Elevation), 2px focus rings and tier edges. */
export const stroke = { hairline: 1, thick: 2 } as const;

/**
 * Layout measures and breakpoints. The token set has no container widths or breakpoints yet,
 * so they live here, in one place, until design-tokens grows them.
 */
export const measure = { prose: 760, page: 1120 } as const;
export const bp = { sm: 640, lg: 960 } as const;
export const mq = (min: number): string => `@media (min-width:${px(min)})`;

export const hairline = (colour = 'border-subtle'): string =>
  `${px(stroke.hairline)} solid ${v(colour)}`;
