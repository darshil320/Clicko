import {
  colorLight,
  colourEntries,
  elevation,
  icon,
  layout,
  motion,
  radius,
  sectionSpace,
  space,
  typography,
} from '@clickco/design-tokens';

/**
 * Helpers shared by the portal stylesheet modules. Every value below comes from
 * @clickco/design-tokens (ADR-0017 white theme) or is derived from one; nothing else in the portal
 * may carry a raw colour, spacing or font size.
 */

export const px = (n: number): string => `${n}px`;
export const ms = (n: number): string => `${n}ms`;
/** A colour token, e.g. c('text-primary') → var(--color-text-primary). */
export const c = (name: string): string => `var(--color-${name})`;

export const t = typography.scale;
export { elevation, icon, layout, motion, radius, sectionSpace, space, typography };

/** Font sizes as `size/line-height` declarations. */
export const font = (step: keyof typeof t): string =>
  `font-size:${px(t[step].size)};line-height:${px(t[step].lineHeight)}`;

/**
 * The token faces first (used when installed: the CSP allows no font CDN), then the platform UI
 * face for Latin, then the token Indic fallbacks, then the generic family.
 */
const quote = (name: string) => `'${name}'`;
const SYSTEM = "ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto";
const tail = `${SYSTEM},${typography.family.indicFallback.map(quote).join(',')},sans-serif`;
export const FONT_BODY = `${quote(typography.family.body)},${tail}`;
export const FONT_DISPLAY = `${quote(typography.family.display)},${quote(typography.family.body)},${tail}`;

/**
 * Portal layout: breakpoints and column widths. The portal is a tool, not a marketing page, so its
 * column sits inside the token content width (sectionSpace.contentMax) for calmer line lengths.
 */
export const bp = { sm: 640 } as const;
export const column = { main: 960, form: 440 } as const;
export const up = (width: number, css: string): string => `@media (min-width:${px(width)}){${css}}`;
export const below = (width: number, css: string): string =>
  `@media (max-width:${px(width - 1)}){${css}}`;

/** The micro label: uppercase with the token tracking. */
export const MICRO = `${font('micro')};font-weight:600;letter-spacing:${typography.microTrackingEm}em;text-transform:uppercase`;

/** Status colours as text are AA on white; on their own tint they are deepened toward text/primary. */
const STATUS = ['success', 'warning', 'danger'] as const;
const TINT = '8%';
const EDGE = '22%';
const INK = '85%';

function statusVars(): string {
  return STATUS.map(
    (s) =>
      `--tint-${s}:color-mix(in srgb,${c(s)} ${TINT},${c('surface-base')});` +
      `--edge-${s}:color-mix(in srgb,${c(s)} ${EDGE},${c('surface-base')});` +
      `--ink-${s}:color-mix(in srgb,${c(s)} ${INK},${c('text-primary')});`,
  ).join('');
}

/** `:root` custom properties: the white palette, elevation, motion and derived status tints. */
export function rootCss(): string {
  const colours = colourEntries(colorLight)
    .map(([name, value]) => `--color-${name}:${value};`)
    .join('');
  return `:root{${colours}${statusVars()}
--edge-accent:color-mix(in srgb,${c('accent-default')} ${EDGE},${c('surface-base')});
--shadow-sm:${elevation.sm};--shadow-md:${elevation.md};--shadow-lg:${elevation.lg};
--ease:${motion.easeOut};--fast:${ms(motion.fastMs)};--reveal:${ms(motion.revealMs)};--hero:${ms(motion.heroMs)};
color-scheme:light}`;
}
