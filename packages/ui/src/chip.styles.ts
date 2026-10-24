import type { Tone } from './tones';

/**
 * Chips (DESIGN-LIGHT): a white pill on a hairline. Selected = the amber tint with an ink
 * outline — a strong, non-colour cue — and dark on-accent text. Amber is never the text.
 * The selected surface cross-fades in (Chip.tsx), so the selected classes live on an overlay.
 */
export const CHIP_BASE_CLASS = 'min-h-tap min-w-tap items-center justify-center border px-4';

/** Date pills (two lines) are rounded rectangles; single-line chips are pills. */
export function chipRadiusClass(twoLine: boolean): string {
  return twoLine ? 'rounded-lg' : 'rounded-full';
}

export function chipShapeClass(twoLine: boolean): string {
  return twoLine ? `${chipRadiusClass(true)} py-2` : chipRadiusClass(false);
}

export function chipBorderClass(selected: boolean, pressed: boolean): string {
  if (selected) return 'border-transparent bg-surface-base';
  return pressed ? 'border-border-strong bg-surface-base' : 'border-border-subtle bg-surface-base';
}

export const CHIP_SELECTED_OVERLAY_CLASS = 'flex-1 border border-text-primary bg-accent-subtle';

export function chipLabelTone(selected: boolean, disabled: boolean): Tone {
  if (disabled) return 'tertiary';
  return selected ? 'onAccent' : 'primary';
}

export function chipSublabelTone(selected: boolean, disabled: boolean): Tone {
  if (disabled) return 'tertiary';
  return selected ? 'onAccent' : 'secondary';
}
