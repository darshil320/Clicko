import { PlanTier } from '@clickco/contracts';
import { colorLight, lightTailwindPreset, typography } from '@clickco/design-tokens';
import { describe, expect, it } from 'vitest';
import { initials } from './avatar.logic';
import { buttonContainerClass, buttonLabelTone, buttonState } from './button.styles';
import { cx } from './cx';
import { FONT_FACES, fontFace, fontFaceFor } from './fonts';
import { multilineTextHeight } from './input.styles';
import {
  BADGE_TONE_CLASS,
  EDGE_CLASS,
  TEXT_TONE_CLASS,
  TIER_LABEL,
  TIER_TONE,
  TONE_COLOR,
} from './tones';

const tokenColourNames = new Set(
  Object.entries(colorLight).flatMap(([group, value]) =>
    typeof value === 'string' ? [group] : Object.keys(value).map((v) => `${group}-${v}`),
  ),
);

/** "text-accent-default" / "bg-success/15" / "border-l-text-primary" → the token name. */
function tokenOf(className: string): string {
  return className.replace(/^(text|bg|border-l|border)-/, '').replace(/\/\d+$/, '');
}

/** Every colour utility in a class list ("bg-surface-base border-border-subtle") → token names. */
const NOT_A_COLOUR = /^border(-l)?(-\d+)?$|^border-transparent$/;
function colourTokensIn(classes: string): string[] {
  return classes
    .split(/\s+/)
    .filter((c) => /^(text|bg|border-l|border)-/.test(c) && !NOT_A_COLOUR.test(c))
    .map(tokenOf);
}

describe('cx', () => {
  it('joins truthy class names only', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
  });
});

describe('font faces', () => {
  it('derives per-weight face names from the token families', () => {
    expect(fontFace('body', '600')).toBe('Inter-SemiBold');
    expect(fontFace('display', '700')).toBe('InterTight-Bold');
  });

  it('sets headings in Inter Tight and body copy in Inter', () => {
    expect(fontFaceFor('h1')).toBe('InterTight-Bold');
    expect(fontFaceFor('h3')).toBe('InterTight-SemiBold');
    expect(fontFaceFor('body')).toBe('Inter-Regular');
    expect(fontFaceFor('bodyStrong')).toBe('Inter-SemiBold');
    expect(fontFaceFor('micro')).toBe('Inter-Medium');
  });

  it('lists each face the app must load exactly once', () => {
    expect([...FONT_FACES].sort()).toEqual([
      'Inter-Medium',
      'Inter-Regular',
      'Inter-SemiBold',
      'InterTight-Bold',
      'InterTight-SemiBold',
    ]);
  });
});

describe('tones only reference design tokens', () => {
  it.each(Object.entries(TEXT_TONE_CLASS))('text tone %s', (_tone, className) => {
    expect(tokenColourNames.has(tokenOf(className))).toBe(true);
  });

  it.each(Object.entries(EDGE_CLASS))('edge tone %s', (_tone, className) => {
    expect(tokenColourNames.has(tokenOf(className))).toBe(true);
  });

  it.each(Object.entries(BADGE_TONE_CLASS))('badge tone %s', (_tone, { surface, dot }) => {
    for (const token of colourTokensIn(`${surface} ${dot}`)) {
      expect(tokenColourNames.has(token), token).toBe(true);
    }
  });

  it('resolves every tone to a white-theme token colour value', () => {
    const values = new Set<string>(
      Object.values(colorLight).flatMap((v): string[] =>
        typeof v === 'string' ? [v] : Object.values(v),
      ),
    );
    for (const value of Object.values(TONE_COLOR)) expect(values.has(value)).toBe(true);
  });

  it('keeps the light preset exposing every colour group the classes use', () => {
    expect(Object.keys(lightTailwindPreset.theme.extend.colors)).toEqual(Object.keys(colorLight));
  });

  it('never offers amber as a foreground (ADR-0017: the accent is a fill)', () => {
    expect(Object.values(TEXT_TONE_CLASS)).not.toContain('text-accent-default');
    expect(Object.values(TONE_COLOR)).not.toContain(colorLight.accent.default);
  });
});

describe('tiers', () => {
  it('labels and colours every plan tier', () => {
    for (const tier of PlanTier.options) {
      expect(TIER_LABEL[tier]).toBeTruthy();
      expect(TIER_TONE[tier]).toBeDefined();
    }
    expect(TIER_LABEL.SEMI_PRO).toBe('Semi-Pro');
  });

  it('gives the one accent to Professional only — as a dot and an edge, never as text', () => {
    const dotted = PlanTier.options.filter((t) => TIER_TONE[t].dot === 'bg-accent-default');
    const edged = PlanTier.options.filter((t) => TIER_TONE[t].edge === 'accent');
    expect(dotted).toEqual(['PROFESSIONAL']);
    expect(edged).toEqual(['PROFESSIONAL']);
    for (const tier of PlanTier.options) {
      expect(tokenColourNames.has(tokenOf(TIER_TONE[tier].dot))).toBe(true);
    }
  });
});

describe('button styles', () => {
  it('derives the state: disabled beats loading beats pressed', () => {
    expect(buttonState({ disabled: true, loading: true, pressed: true })).toBe('disabled');
    expect(buttonState({ disabled: false, loading: true, pressed: false })).toBe('pressed');
    expect(buttonState({ disabled: false, loading: false, pressed: true })).toBe('pressed');
    expect(buttonState({ disabled: false, loading: false, pressed: false })).toBe('default');
  });

  it('uses the accent surface for primary and hover when pressed', () => {
    expect(buttonContainerClass('primary', 'default', 'default')).toContain('bg-accent-default');
    expect(buttonContainerClass('primary', 'pressed', 'default')).toContain('bg-accent-hover');
    expect(buttonContainerClass('primary', 'disabled', 'default')).not.toContain('accent');
    expect(buttonContainerClass('secondary', 'default', 'default')).toContain('bg-surface-base');
    expect(buttonContainerClass('primary', 'default', 'default')).toContain('h-button');
    expect(buttonContainerClass('ghost', 'default', 'compact')).toContain('min-h-tap');
  });

  it('puts on-accent text on primary and dims every disabled label', () => {
    expect(buttonLabelTone('primary', 'default')).toBe('onAccent');
    expect(buttonLabelTone('secondary', 'default')).toBe('primary');
    expect(buttonLabelTone('ghost', 'default')).toBe('secondary');
    expect(buttonLabelTone('primary', 'disabled')).toBe('tertiary');
  });

  it('draws danger as danger text on a white surface with a danger hairline, never a red fill', () => {
    const idle = buttonContainerClass('danger', 'default', 'default');
    expect(idle).toContain('bg-surface-base');
    expect(idle).toContain('border-danger');
    expect(idle).not.toContain('bg-danger');
    expect(buttonContainerClass('danger', 'pressed', 'default')).toContain('bg-surface-raised');
    expect(buttonContainerClass('danger', 'disabled', 'default')).not.toContain('danger');
    expect(buttonContainerClass('danger', 'default', 'default')).toContain('h-button');
    expect(buttonLabelTone('danger', 'default')).toBe('danger');
    expect(buttonLabelTone('danger', 'pressed')).toBe('danger');
    expect(buttonLabelTone('danger', 'disabled')).toBe('tertiary');
  });
});

describe('input height', () => {
  it('sizes a multiline message box in body lines, from the type tokens', () => {
    expect(multilineTextHeight(true, 4)).toBe(typography.scale.body.lineHeight * 4);
    expect(multilineTextHeight(true, 5.5)).toBe(typography.scale.body.lineHeight * 5);
  });

  it('keeps the 52pt single-line field otherwise', () => {
    expect(multilineTextHeight(false, 4)).toBeNull();
    expect(multilineTextHeight(true, undefined)).toBeNull();
    expect(multilineTextHeight(true, 1)).toBeNull();
  });
});

describe('avatar initials', () => {
  it.each([
    ['Priya Sharma', 'PS'],
    ['Vikram Reddy Kumar', 'VK'],
    ['rahul', 'R'],
    ['  ananya   iyer ', 'AI'],
    ['', ''],
  ])('%s → %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
