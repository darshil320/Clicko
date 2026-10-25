/**
 * Clickco design tokens — the ONLY place raw colour values may appear.
 * Source: docs/DESIGN.md (tokens.test.ts fails if they drift).
 * Everything else (Tailwind preset, CSS variables) is derived from this file.
 */

export const color = {
  surface: { base: '#0A0A0B', raised: '#141416', overlay: '#1C1C1F' },
  border: { subtle: '#26262A', strong: '#3A3A40' },
  text: { primary: '#FAFAFA', secondary: '#A1A1AA', tertiary: '#71717A', 'on-accent': '#1A1206' },
  accent: { default: '#FFB63D', hover: '#FFC55C', subtle: '#2A1F0A' },
  /** Emergency tier ONLY — never a generic error red. */
  emergency: { default: '#FF4D4F', subtle: '#2A1214' },
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
} as const;

/**
 * ADR-0017 — the white theme (client app, marketing website, upload portal). Same keys as
 * `color`, so a surface switches theme by switching palette. Source: docs/DESIGN-LIGHT.md.
 */
export const colorLight = {
  surface: { base: '#FFFFFF', raised: '#FAFAF8', overlay: '#FFFFFF' },
  border: { subtle: '#ECECE7', strong: '#D6D6CF' },
  text: { primary: '#0E0E10', secondary: '#52525B', tertiary: '#71717A', 'on-accent': '#1A1206' },
  accent: { default: '#FFB63D', hover: '#F5A524', subtle: '#FFF5E1' },
  emergency: { default: '#C8262D', subtle: '#FFF1F1' },
  success: '#15803D',
  warning: '#B45309',
  danger: '#DC2626',
} as const satisfies { readonly [K in keyof typeof color]: unknown };

/**
 * ADR-0018 — Daylight, the marketing website's palette. Same keys as `colorLight`, so the web
 * styles keep their semantic variables: warm paper ground, linen bands, white cards.
 * Source: docs/DESIGN-DAYLIGHT.md. The client app and the portal stay on `colorLight`.
 */
export const colorDaylight = {
  surface: { base: '#FBFAF7', raised: '#F3EFE7', overlay: '#FFFFFF' },
  border: { subtle: '#E8E3D9', strong: '#D3CCBF' },
  text: { primary: '#141210', secondary: '#4B4640', tertiary: '#6E675D', 'on-accent': '#1A1206' },
  accent: { default: '#FFB63D', hover: '#F5A524', subtle: '#FFF1D6' },
  emergency: { default: '#C8262D', subtle: '#FFF1F1' },
  success: '#15803D',
  warning: '#B45309',
  danger: '#DC2626',
} as const satisfies { readonly [K in keyof typeof color]: unknown };

/** Website-only colours beside `colorDaylight` (DESIGN-DAYLIGHT §Colour — extras, photographs). */
export const daylightExtras = {
  /** Amber as text: links and the italic accent word. Plain amber is never text. */
  accent: { text: '#8A5000' },
  sage: { default: '#DCE5D6', deep: '#3A5535' },
  clay: { default: '#F3DED3', deep: '#934328' },
  haze: { default: '#DDE6EE', deep: '#2C5170' },
  darkroom: { default: '#121110', text: '#F6F2EA', muted: '#A39C90' },
  /** Placeholder photographs only, never UI. */
  photo: {
    sun: '#FFC56B',
    ember: '#D9703A',
    rose: '#E6B3A1',
    leaf: '#7E9A6E',
    sea: '#7FA3BF',
    cream: '#F6EBD9',
    dusk: '#3B3330',
  },
} as const;

export type Palette = typeof color | typeof colorLight | typeof colorDaylight;

/** Light theme only: soft shadows (the dark theme uses surface layering instead). */
export const elevation = {
  sm: '0 1px 2px rgba(14,14,16,0.04)',
  md: '0 2px 8px rgba(14,14,16,0.04), 0 8px 24px rgba(14,14,16,0.06)',
  lg: '0 24px 64px rgba(14,14,16,0.10)',
} as const;

/** Daylight (ADR-0018): the lift under photos floating in the hero collage. */
export const daylightElevation = {
  photo: '0 40px 80px -32px rgba(20,18,16,0.35)',
} as const;

/** Daylight (ADR-0018): photo frames and tiles, and full-width panels. Cards keep `radius.lg`. */
export const daylightRadius = { photo: 28, panel: 40 } as const;

/**
 * Daylight (ADR-0018) web type: a serif display, the existing body sans, a mono for labels and
 * camera captions, and fluid display steps from a small phone to the content max width.
 */
export const daylightType = {
  /**
   * ADR-0020: one premium geometric sans for headlines and UI, and a serif italic kept only for
   * the one accent phrase in a headline.
   */
  family: { display: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans', accent: 'Instrument Serif' },
  weight: { display: 700, label: 600 },
  trackingEm: { display: -0.035, label: 0.1 },
  /** The serif accent runs a touch larger to match the sans x-height. */
  accentScale: 1.08,
  fluid: {
    hero: { min: 40, max: 76, leading: 1 },
    page: { min: 36, max: 60, leading: 1.04 },
    section: { min: 32, max: 52, leading: 1.06 },
    figure: { min: 28, max: 40, leading: 1.1 },
  },
} as const;

/** Web vertical rhythm between sections, and content widths (DESIGN-LIGHT §Whitespace). */
export const sectionSpace = {
  mobile: 48,
  tablet: 80,
  desktop: 120,
  contentMax: 1120,
  readingMax: 680,
} as const;

/** DESIGN-LIGHT §Motion. Consumers must honour prefers-reduced-motion. */
export const motion = {
  fastMs: 160,
  revealMs: 240,
  heroMs: 600,
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  revealRisePx: 8,
} as const;

/** 4pt base. Keys are Tailwind steps (1 = 4px). */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  14: 56,
} as const;

export const layout = {
  screenPaddingX: space[5],
  cardPadding: space[4],
  cardGap: space[3],
  ctaGapAboveInset: space[4],
  minTapTarget: 44,
  buttonHeight: 52,
  inputHeight: 52,
} as const;

export const radius = { sm: 8, md: 12, lg: 16, full: 999 } as const;

type Weight = '400' | '500' | '600' | '700';
interface TypeStep {
  readonly size: number;
  readonly lineHeight: number;
  readonly weight: Weight;
}

export const typography = {
  family: {
    display: 'Inter Tight',
    body: 'Inter',
    indicFallback: ['Noto Sans Devanagari', 'Noto Sans Gujarati'],
  },
  scale: {
    display: { size: 32, lineHeight: 38, weight: '700' },
    h1: { size: 24, lineHeight: 30, weight: '700' },
    h2: { size: 20, lineHeight: 26, weight: '600' },
    h3: { size: 17, lineHeight: 24, weight: '600' },
    body: { size: 15, lineHeight: 22, weight: '400' },
    bodyStrong: { size: 15, lineHeight: 22, weight: '600' },
    caption: { size: 13, lineHeight: 18, weight: '400' },
    micro: { size: 11, lineHeight: 14, weight: '500' },
  } satisfies Record<string, TypeStep>,
  /** micro is uppercase with 0.06em tracking. */
  microTrackingEm: 0.06,
} as const;

export const icon = { size: 20, strokeWidth: 1.5 } as const;
