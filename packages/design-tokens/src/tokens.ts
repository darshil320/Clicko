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
