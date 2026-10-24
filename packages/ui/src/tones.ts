import type { PlanTier } from '@clickco/contracts';
import { palette } from './palette';

/**
 * Foreground tones every primitive shares. Each maps to exactly one colour token.
 * There is deliberately no "accent" foreground: on white the amber accent is a FILL with
 * text/on-accent on top, never text or an icon stroke (1.8:1 — ADR-0017, DESIGN-LIGHT).
 */
export type Tone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'onAccent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'emergency';

export const TEXT_TONE_CLASS: Readonly<Record<Tone, string>> = {
  primary: 'text-text-primary',
  secondary: 'text-text-secondary',
  tertiary: 'text-text-tertiary',
  onAccent: 'text-text-on-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  emergency: 'text-emergency-default',
};

/** For props that need a colour value rather than a class (SVG icons, spinners, switches). */
export const TONE_COLOR: Readonly<Record<Tone, string>> = {
  primary: palette.text.primary,
  secondary: palette.text.secondary,
  tertiary: palette.text.tertiary,
  onAccent: palette.text['on-accent'],
  success: palette.success,
  warning: palette.warning,
  danger: palette.danger,
  emergency: palette.emergency.default,
};

/**
 * Status badge: a pill with a coloured dot and matching text. Status colours are only
 * readable as text on solid white (tokens.test.ts), so their pills are white with a hairline;
 * the accent pill is amber-tinted with dark on-accent text.
 */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'emergency';

export interface BadgeStyle {
  readonly surface: string;
  readonly text: Tone;
  readonly dot: string;
}

const WHITE_PILL = 'bg-surface-base border-border-subtle';

export const BADGE_TONE_CLASS: Readonly<Record<BadgeTone, BadgeStyle>> = {
  neutral: { surface: WHITE_PILL, text: 'secondary', dot: 'bg-text-tertiary' },
  accent: {
    surface: 'bg-accent-subtle border-accent-subtle',
    text: 'onAccent',
    dot: 'bg-accent-default',
  },
  success: { surface: WHITE_PILL, text: 'success', dot: 'bg-success' },
  warning: { surface: WHITE_PILL, text: 'warning', dot: 'bg-warning' },
  danger: { surface: WHITE_PILL, text: 'danger', dot: 'bg-danger' },
  emergency: {
    surface: 'bg-emergency-subtle border-emergency-subtle',
    text: 'emergency',
    dot: 'bg-emergency-default',
  },
};

/** Left-edge accents for cards. */
export type EdgeTone =
  | 'accent'
  | 'emergency'
  | 'warning'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'strong';

export const EDGE_CLASS: Readonly<Record<EdgeTone, string>> = {
  accent: 'border-l-accent-default',
  emergency: 'border-l-emergency-default',
  warning: 'border-l-warning',
  primary: 'border-l-text-primary',
  secondary: 'border-l-text-secondary',
  tertiary: 'border-l-text-tertiary',
  strong: 'border-l-border-strong',
};

/**
 * Tier colours. DESIGN.md says "tier-coloured" but defines no tier palette, so tiers map
 * onto existing tokens until the Figma tier palette lands: the label ladder rises from grey to
 * ink, and Professional (the default recommendation) carries the one accent — as an amber
 * dot and edge (fills), never amber text.
 */
export interface TierStyle {
  readonly text: Tone;
  readonly edge: EdgeTone;
  readonly dot: string;
}

export const TIER_TONE: Readonly<Record<PlanTier, TierStyle>> = {
  BASIC: { text: 'tertiary', edge: 'tertiary', dot: 'bg-text-tertiary' },
  SEMI_PRO: { text: 'secondary', edge: 'secondary', dot: 'bg-text-secondary' },
  PROFESSIONAL: { text: 'primary', edge: 'accent', dot: 'bg-accent-default' },
  EXPERT: { text: 'primary', edge: 'primary', dot: 'bg-text-primary' },
  SIGNATURE: { text: 'primary', edge: 'strong', dot: 'bg-text-primary' },
};

export const TIER_LABEL: Readonly<Record<PlanTier, string>> = {
  BASIC: 'Basic',
  SEMI_PRO: 'Semi-Pro',
  PROFESSIONAL: 'Professional',
  EXPERT: 'Expert',
  SIGNATURE: 'Signature',
};
