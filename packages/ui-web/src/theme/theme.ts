import {
  colorLight,
  elevation,
  motion,
  type Palette,
  radius,
  space,
  typography,
} from '@clickco/design-tokens';

/**
 * The shadcn/ui theme, derived from @clickco/design-tokens (ADR-0025 D6, ADR-0017 white theme).
 * Nothing here is a raw value: every colour is a palette token, every size a token step. The
 * stylesheet (`styles.css`) only references these CSS variables; `themeStylesheet()` supplies
 * their values as a `:root` block the app renders in a nonce'd <style> element.
 */

type Group = keyof Palette;
/** A palette token: a flat colour (`success`) or `group.variant` (`surface.base`). */
export type ColourToken = {
  [G in Group]: Palette[G] extends string ? G : `${G}.${Extract<keyof Palette[G], string>}`;
}[Group];

/**
 * shadcn colour variable → palette token. The page is the warm off-white band and cards are
 * white on it (ADR-0017: "calm cards on a warm off-white band"). Amber (`primary`) is a fill
 * with `text/on-accent`; it is never a text colour on white (DESIGN-LIGHT §Colour).
 */
export const SHADCN_COLOURS = {
  background: 'surface.raised',
  foreground: 'text.primary',
  card: 'surface.base',
  'card-foreground': 'text.primary',
  popover: 'surface.overlay',
  'popover-foreground': 'text.primary',
  primary: 'accent.default',
  'primary-hover': 'accent.hover',
  'primary-foreground': 'text.on-accent',
  secondary: 'surface.base',
  'secondary-foreground': 'text.primary',
  muted: 'surface.raised',
  'muted-foreground': 'text.secondary',
  subtle: 'text.tertiary',
  accent: 'accent.subtle',
  'accent-foreground': 'text.primary',
  destructive: 'danger',
  'destructive-foreground': 'surface.base',
  success: 'success',
  'success-foreground': 'surface.base',
  warning: 'warning',
  'warning-foreground': 'surface.base',
  emergency: 'emergency.default',
  'emergency-foreground': 'surface.base',
  'emergency-subtle': 'emergency.subtle',
  border: 'border.subtle',
  input: 'border.strong',
  ring: 'text.tertiary',
  sidebar: 'surface.base',
  'sidebar-foreground': 'text.primary',
  'sidebar-muted-foreground': 'text.secondary',
  'sidebar-accent': 'accent.subtle',
  'sidebar-accent-foreground': 'text.primary',
  'sidebar-border': 'border.subtle',
  'sidebar-ring': 'text.tertiary',
} as const satisfies Record<string, ColourToken>;

export type ShadcnColour = keyof typeof SHADCN_COLOURS;

/**
 * Text-on-surface pairs the kit renders. Each must reach WCAG AA (4.5:1) — theme.test.ts checks.
 * Tone colours are text only on solid surfaces; on a tone tint the text is `foreground`.
 */
export const TEXT_PAIRS: ReadonlyArray<readonly [ShadcnColour, ShadcnColour]> = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['primary-foreground', 'primary-hover'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'background'],
  ['subtle', 'card'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['emergency-foreground', 'emergency'],
  ['destructive', 'card'],
  ['destructive', 'background'],
  ['destructive', 'popover'],
  ['destructive', 'muted'],
  ['success', 'card'],
  ['warning', 'card'],
  ['emergency', 'emergency-subtle'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-muted-foreground', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
];

/** Status tints used by Badge/Alert: `bg-{tone}/{TINT_PERCENT}` under `foreground` text. */
export const TINT_PERCENT = 10;
export const TINTED_TONES: ReadonlyArray<ShadcnColour> = [
  'success',
  'warning',
  'destructive',
  'emergency',
  'primary',
];

/** Resolves a token path against a palette, e.g. `surface.base` → the white surface. */
export function resolveToken(palette: Palette, token: ColourToken): string {
  const [group, variant] = token.split('.') as [Group, string | undefined];
  const entry: unknown = palette[group];
  if (typeof entry === 'string' && variant === undefined) return entry;
  if (typeof entry === 'object' && entry !== null && variant !== undefined) {
    const value = (entry as Record<string, unknown>)[variant];
    if (typeof value === 'string') return value;
  }
  throw new Error(`Unknown colour token: ${token}`);
}

const px = (n: number): string => `${n}px`;

/** Fonts: the token family, then the Indic fallbacks, then the platform UI font. */
function fontStack(family: string): string {
  return [family, ...typography.family.indicFallback]
    .map((f) => `"${f}"`)
    .concat(['system-ui', 'sans-serif'])
    .join(', ');
}

/**
 * Tailwind's size names, mapped to the token type scale (DESIGN.md §Typography). The stylesheet
 * clears Tailwind's own sizes, so these are the only `text-*` sizes that exist.
 */
export const TEXT_STEPS = {
  xs: 'micro',
  sm: 'caption',
  base: 'body',
  lg: 'h3',
  xl: 'h2',
  '2xl': 'h1',
  '3xl': 'display',
} as const satisfies Record<string, keyof typeof typography.scale>;

/** Every non-colour variable the stylesheet reads (`--cc-*`), from the token scales. */
export function scaleVariables(): Record<string, string> {
  const text = Object.entries(TEXT_STEPS).flatMap(([name, step]) => {
    const s = typography.scale[step];
    return [
      [`--cc-text-${name}`, px(s.size)],
      [`--cc-text-${name}-lh`, px(s.lineHeight)],
    ] as const;
  });
  return {
    '--cc-space': px(space[1]),
    '--cc-radius-sm': px(radius.sm),
    '--cc-radius-md': px(radius.md),
    '--cc-radius-lg': px(radius.lg),
    '--cc-shadow-sm': elevation.sm,
    '--cc-shadow-md': elevation.md,
    '--cc-shadow-lg': elevation.lg,
    '--cc-font-body': fontStack(typography.family.body),
    '--cc-font-display': fontStack(typography.family.display),
    '--cc-tracking-micro': `${typography.microTrackingEm}em`,
    '--cc-motion-fast': `${motion.fastMs}ms`,
    '--cc-motion-reveal': `${motion.revealMs}ms`,
    '--cc-ease-out': motion.easeOut,
    ...Object.fromEntries(text),
  };
}

/** `--background`, `--primary`, … for every shadcn colour, resolved from the palette. */
export function colourVariables(palette: Palette = colorLight): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SHADCN_COLOURS).map(([name, token]) => [
      `--${name}`,
      resolveToken(palette, token),
    ]),
  );
}

/** Every CSS variable the kit's stylesheet depends on. */
export function themeVariables(palette: Palette = colorLight): Record<string, string> {
  return { ...colourVariables(palette), ...scaleVariables() };
}

/** The `:root { … }` block to render (nonce'd) in the app's <head>. */
export function themeStylesheet(palette: Palette = colorLight): string {
  const body = Object.entries(themeVariables(palette))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  return `:root{${body}}`;
}
