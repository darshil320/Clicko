import type { ElevationLevel } from './elevation';

export type CardTone = 'default' | 'accent' | 'emergency' | 'warning';
export type CardPadding = 'default' | 'compact' | 'list';

/**
 * DESIGN-LIGHT: calm cards — surface/raised on a 1px border/subtle with a soft `sm` shadow.
 * Tinted cards (accent, emergency, warning) sit flat on their tint.
 */
export const CARD_TONE_CLASS: Readonly<Record<CardTone, string>> = {
  default: 'bg-surface-raised border-border-subtle',
  accent: 'bg-accent-subtle border-accent-default/25',
  emergency: 'bg-emergency-subtle border-emergency-default/15',
  warning: 'bg-warning/10 border-warning/20',
};

export const CARD_ELEVATION: Readonly<Record<CardTone, ElevationLevel | 'none'>> = {
  default: 'sm',
  accent: 'none',
  emergency: 'none',
  warning: 'none',
};

/**
 * 20 inside by default (DESIGN-LIGHT: cards keep 16–24); compact tiles 12; "list" cards hold
 * ListRows, whose own 12px rhythm supplies the vertical air.
 */
export const CARD_PADDING_CLASS: Readonly<Record<CardPadding, string>> = {
  default: 'p-5',
  compact: 'p-3',
  list: 'px-5 py-2',
};

export const CARD_BASE_CLASS = 'rounded-lg border';
