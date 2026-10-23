import type { PlanTier } from '@clickco/contracts';
import { color } from '@clickco/design-tokens';

/** Foreground tones every primitive shares. Each maps to exactly one colour token. */
export type Tone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'onAccent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'emergency';

export const TEXT_TONE_CLASS: Readonly<Record<Tone, string>> = {
  primary: 'text-text-primary',
  secondary: 'text-text-secondary',
  tertiary: 'text-text-tertiary',
  accent: 'text-accent-default',
  onAccent: 'text-text-on-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  emergency: 'text-emergency-default',
};

/** For props that need a colour value rather than a class (SVG icons, spinners, switches). */
export const TONE_COLOR: Readonly<Record<Tone, string>> = {
  primary: color.text.primary,
  secondary: color.text.secondary,
  tertiary: color.text.tertiary,
  accent: color.accent.default,
  onAccent: color.text['on-accent'],
  success: color.success,
  warning: color.warning,
  danger: color.danger,
  emergency: color.emergency.default,
};

/** Status badge: tinted background + matching text (DESIGN.md §Components). */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'emergency';

export const BADGE_TONE_CLASS: Readonly<Record<BadgeTone, { bg: string; text: Tone }>> = {
  neutral: { bg: 'bg-surface-overlay', text: 'secondary' },
  accent: { bg: 'bg-accent-subtle', text: 'accent' },
  // DESIGN.md has no *-subtle token for these three; the tint is the token at 15% opacity.
  success: { bg: 'bg-success/15', text: 'success' },
  warning: { bg: 'bg-warning/15', text: 'warning' },
  danger: { bg: 'bg-danger/15', text: 'danger' },
  emergency: { bg: 'bg-emergency-subtle', text: 'emergency' },
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
 * onto existing tokens until the Figma tier palette lands: the ladder rises from grey to
 * white, Professional (the default recommendation) carries the one accent.
 */
export const TIER_TONE: Readonly<Record<PlanTier, { text: Tone; edge: EdgeTone }>> = {
  BASIC: { text: 'tertiary', edge: 'tertiary' },
  SEMI_PRO: { text: 'secondary', edge: 'secondary' },
  PROFESSIONAL: { text: 'accent', edge: 'accent' },
  EXPERT: { text: 'primary', edge: 'primary' },
  SIGNATURE: { text: 'primary', edge: 'strong' },
};

export const TIER_LABEL: Readonly<Record<PlanTier, string>> = {
  BASIC: 'Basic',
  SEMI_PRO: 'Semi-Pro',
  PROFESSIONAL: 'Professional',
  EXPERT: 'Expert',
  SIGNATURE: 'Signature',
};
