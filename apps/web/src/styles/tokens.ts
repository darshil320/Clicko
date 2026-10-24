import {
  colorLight,
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
 * CSS building blocks derived from @clickco/design-tokens (white theme, ADR-0017).
 * This is the ONLY web module allowed to hold numbers that are not tokens: every ratio, fluid
 * range and ambient duration below is named and derived here, and the style modules use them.
 */
export const px = (n: number): string => `${n}px`;
export const ms = (n: number): string => `${n}ms`;
export const v = (name: string): string => `var(--color-${name})`;
export const S = space;
export const L = layout;
export const R = radius;
export const T = typography.scale;
export const ICON = icon;

/** The site palette. The marketing website is a white-theme surface (ADR-0017). */
export const palette = colorLight;
export const shadows = elevation;
export const shadow = (level: keyof typeof elevation): string => `var(--shadow-${level})`;

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

/* ── Fluid web type ─────────────────────────────────────────────────────────────────────────
 * DESIGN.md defines a mobile scale only. The web display scale grows from those steps at a
 * small phone to a ratio of the display step at the content max width (DESIGN-LIGHT §Whitespace).
 */
const FLUID_FROM = 360;
const FLUID_TO = sectionSpace.contentMax;

/** `clamp()` from `min` px at a small phone to `max` px at the content max width. */
export const fluid = (min: number, max: number): string =>
  `clamp(${px(min)},calc(${px(min)} + ${max - min} * ((100vw - ${px(FLUID_FROM)}) / ${FLUID_TO - FLUID_FROM})),${px(max)})`;

/** Unitless line heights: big type sits tight, reading text breathes. */
export const leading = { display: 1.04, heading: 1.1, title: 1.3, lead: 1.55, prose: 1.7 } as const;
/** Negative tracking for big headings, in em. */
export const tracking = { display: -0.035, heading: -0.025, title: -0.01 } as const;

interface FluidStep {
  readonly min: number;
  readonly max: number;
  readonly leading: number;
  readonly tracking: number;
  readonly weight: string;
}

const d = T.display.size;
export const webType = {
  /** Home hero: 32 → 56. */
  hero: {
    min: d,
    max: (d * 7) / 4,
    leading: leading.display,
    tracking: tracking.display,
    weight: T.display.weight,
  },
  /** Page heroes (city, category, legal): 28 → 48. */
  page: {
    min: (d * 7) / 8,
    max: (d * 3) / 2,
    leading: leading.heading,
    tracking: tracking.heading,
    weight: T.display.weight,
  },
  /** Section headings: 28 → 44. */
  section: {
    min: (d * 7) / 8,
    max: (d * 11) / 8,
    leading: leading.heading,
    tracking: tracking.heading,
    weight: T.display.weight,
  },
  /** Prices and step numerals: 24 → 32. */
  figure: {
    min: T.h1.size,
    max: d,
    leading: leading.heading,
    tracking: tracking.heading,
    weight: T.h1.weight,
  },
  /** Card and sub-section titles: 17 → 20. */
  title: {
    min: T.h3.size,
    max: T.h2.size,
    leading: leading.title,
    tracking: tracking.title,
    weight: T.h3.weight,
  },
  /** Lead paragraphs: 17 → 20, regular weight. */
  lead: {
    min: T.h3.size,
    max: T.h2.size,
    leading: leading.lead,
    tracking: 0,
    weight: T.body.weight,
  },
} as const satisfies Record<string, FluidStep>;

export const fluidType = (step: FluidStep): string =>
  `font-size:${fluid(step.min, step.max)};line-height:${step.leading};font-weight:${step.weight};letter-spacing:${step.tracking}em`;

/** Legal and long-form prose: the h3 size with a comfortable measure (DESIGN-LIGHT §Whitespace). */
export const prose = { size: T.h3.size, leading: leading.prose } as const;

/** Stroke widths: 1px hairlines, 2px focus rings and markers. */
export const stroke = { hairline: 1, thick: 2 } as const;

/* ── Layout ─────────────────────────────────────────────────────────────────────────────── */

/** Section rhythm and widths (DESIGN-LIGHT §Whitespace). */
export const rhythm = sectionSpace;
export const measure = {
  prose: sectionSpace.readingMax,
  page: sectionSpace.contentMax,
  /** The hero headline runs wider than prose so the first sentence fits one line at 56px. */
  hero: (sectionSpace.readingMax * 3) / 2,
  /** The hero quote card. */
  stage: (sectionSpace.readingMax * 3) / 4,
} as const;
/** sm = tablet, lg = desktop. */
export const bp = { sm: 640, lg: 960 } as const;
export const mq = (min: number): string => `@media (min-width:${px(min)})`;
/** Height of the header bar. */
export const headerHeight = S[14] + S[2];
/** Width of the "booked" column in the lead-time table. */
export const bandWhenColumn = S[14] * 4;

export const hairline = (colour = 'border-subtle'): string =>
  `${px(stroke.hairline)} solid ${v(colour)}`;

/** A token colour at partial strength, for glass, glows and selection. */
export const tint = (name: string, percent: number): string =>
  `color-mix(in srgb,${v(name)} ${percent}%,transparent)`;

/* ── Effects ────────────────────────────────────────────────────────────────────────────── */

/** The glass header, the hero dot grid and the soft amber glow. */
export const fx = {
  glassPercent: 86,
  glassBlur: S[3],
  glassSaturate: 1.8,
  dotGap: S[6],
  dotRadius: stroke.hairline,
  dotFade: 72,
  glowSize: sectionSpace.readingMax,
  glowPercent: 26,
  glowBlur: S[10],
  glowAspect: 2,
  marqueeFade: 12,
  selectionPercent: 40,
  focusHaloPercent: 45,
  noticeTint: 6,
  noticeEdge: 24,
  disabledOpacity: 0.7,
} as const;

/* ── Motion (DESIGN-LIGHT §Motion) — consumers wrap every use in `motionOk`. ─────────────── */

export const motionOk = '@media (prefers-reduced-motion:no-preference)';
export const ease = motion.easeOut;
export const motionMs = motion;
/** Hover lift: a quarter of the reveal rise. */
export const liftPx = motion.revealRisePx / 4;
/** Reveal blur, "light" per DESIGN-LIGHT. */
export const revealBlurPx = S[1];
/** Hero entrance stagger between lines. */
export const staggerMs = motion.fastMs / 2;
/** Scroll-driven reveal window, as % of the element's entry into the viewport. */
export const revealRange = { from: 5, to: 55 } as const;

/** Slow ambient loops (seconds), for the city marquee, the live dot and the floating cards. */
export const ambient = {
  marqueeS: 48,
  pulseS: 2.4,
  pulseScale: 2.6,
  pulseOpacity: 0.55,
  floatS: 7,
  floatPx: motion.revealRisePx * 0.75,
} as const;
