import type { Tone } from './tones';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonState = 'default' | 'pressed' | 'disabled';
export type ButtonSize = 'default' | 'compact';

/**
 * White theme (DESIGN-LIGHT): primary is the amber fill with on-accent text; secondary is a white
 * surface on a strong hairline; ghost is text only. Disabled never uses amber.
 */
const SURFACE: Readonly<Record<ButtonVariant, Readonly<Record<ButtonState, string>>>> = {
  primary: {
    default: 'bg-accent-default',
    pressed: 'bg-accent-hover',
    disabled: 'bg-border-subtle',
  },
  secondary: {
    default: 'bg-surface-base border border-border-strong',
    pressed: 'bg-surface-raised border border-border-strong',
    disabled: 'bg-surface-base border border-border-subtle',
  },
  ghost: {
    default: 'bg-transparent',
    pressed: 'bg-border-subtle/60',
    disabled: 'bg-transparent',
  },
};

const LABEL_TONE: Readonly<Record<ButtonVariant, Tone>> = {
  primary: 'onAccent',
  secondary: 'primary',
  ghost: 'secondary',
};

const SIZE: Readonly<Record<ButtonSize, string>> = {
  default: 'h-button px-5',
  compact: 'min-h-tap px-4',
};

export function buttonState(input: {
  disabled: boolean;
  loading: boolean;
  pressed: boolean;
}): ButtonState {
  if (input.disabled) return 'disabled';
  if (input.pressed || input.loading) return 'pressed';
  return 'default';
}

export function buttonContainerClass(
  variant: ButtonVariant,
  state: ButtonState,
  size: ButtonSize,
): string {
  return `flex-row items-center justify-center gap-2 rounded-md ${SIZE[size]} ${SURFACE[variant][state]}`;
}

export function buttonLabelTone(variant: ButtonVariant, state: ButtonState): Tone {
  return state === 'disabled' ? 'tertiary' : LABEL_TONE[variant];
}
