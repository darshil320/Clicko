import { colorLight, elevation, motion } from '@clickco/design-tokens';
import { describe, expect, it } from 'vitest';
import { CARD_ELEVATION, CARD_PADDING_CLASS, CARD_TONE_CLASS } from './card.styles';
import {
  CHIP_BASE_CLASS,
  CHIP_SELECTED_OVERLAY_CLASS,
  chipBorderClass,
  chipLabelTone,
  chipRadiusClass,
  chipShapeClass,
  chipSublabelTone,
} from './chip.styles';
import { elevationStyle, parseShadow } from './elevation';
import { iconPixels } from './icon.sizes';
import {
  EASE_OUT,
  MAX_STAGGER_STEPS,
  PRESS_OPACITY,
  PRESS_SCALE,
  parseCubicBezier,
  revealDelay,
  STAGGER_MS,
} from './motion';
import { palette } from './palette';
import { TILE_ICON_SIZE, TILE_SIZE_CLASS, TILE_TONE, tileShapeClass } from './tile.styles';
import { BADGE_TONE_CLASS, TONE_COLOR } from './tones';

/** "bg-accent-subtle" / "bg-success/10" → { hex, alpha } from the white palette. */
function resolve(className: string): { hex: string; alpha: number } {
  const match = /^(?:bg|border|text)-([a-z-]+?)(?:\/(\d+))?$/.exec(className);
  if (!match) throw new Error(`Not a colour class: ${className}`);
  const [, name = '', alphaPct] = match;
  const flat = Object.entries(colorLight).flatMap(
    ([group, value]): Array<[string, string]> =>
      typeof value === 'string'
        ? [[group, value]]
        : Object.entries(value).map(([variant, hex]): [string, string] => [
            `${group}-${variant}`,
            hex,
          ]),
  );
  const hex = new Map(flat).get(name);
  if (!hex) throw new Error(`No token for ${className}`);
  return { hex, alpha: alphaPct === undefined ? 1 : Number(alphaPct) / 100 };
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** A tint composited over the white page (how `/10` utilities render). */
function over(base: string, { hex, alpha }: { hex: string; alpha: number }): string {
  const [r, g, b] = channels(hex);
  const [R, G, B] = channels(base);
  const mix = (c: number, C: number) =>
    Math.round(alpha * c + (1 - alpha) * C)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(r, R)}${mix(g, G)}${mix(b, B)}`;
}

/** WCAG 2.x contrast ratio. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = channels(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function backgroundOf(classes: string): string {
  const bg = classes.split(/\s+/).find((c) => c.startsWith('bg-'));
  if (!bg) throw new Error(`No background in "${classes}"`);
  return over(colorLight.surface.base, resolve(bg));
}

describe('palette', () => {
  it('is the white theme (ADR-0017)', () => {
    expect(palette).toBe(colorLight);
    expect(palette.surface.base).toBe('#FFFFFF');
  });
});

describe('elevation', () => {
  it('parses every token into React Native box-shadow layers', () => {
    for (const css of Object.values(elevation)) {
      const layers = parseShadow(css);
      expect(layers.length).toBeGreaterThan(0);
      for (const layer of layers) {
        expect(Number.isFinite(layer.offsetY)).toBe(true);
        expect(layer.blurRadius).toBeGreaterThan(0);
        expect(layer.color).toMatch(/^rgba\(/);
      }
    }
  });

  it('keeps md as its two layers, in order', () => {
    expect(parseShadow(elevation.md)).toEqual([
      { offsetX: 0, offsetY: 2, blurRadius: 8, spreadDistance: 0, color: 'rgba(14,14,16,0.04)' },
      { offsetX: 0, offsetY: 8, blurRadius: 24, spreadDistance: 0, color: 'rgba(14,14,16,0.06)' },
    ]);
  });

  it('maps levels to styles, and "none" to nothing', () => {
    expect(elevationStyle('none')).toEqual({});
    expect(elevationStyle('sm').boxShadow).toEqual(parseShadow(elevation.sm));
    expect(elevationStyle('lg')).toBe(elevationStyle('lg'));
  });

  it('rejects shadows React Native cannot draw', () => {
    expect(() => parseShadow('inset 0 1px 2px red')).toThrow();
  });
});

describe('motion', () => {
  it('derives the ease-out curve from the token', () => {
    expect(EASE_OUT).toEqual([0.22, 1, 0.36, 1]);
    expect(parseCubicBezier(motion.easeOut)).toEqual(EASE_OUT);
    expect(() => parseCubicBezier('ease-out')).toThrow();
  });

  it('staggers list reveals 40 ms apart, capped', () => {
    expect(revealDelay(0)).toBe(0);
    expect(revealDelay(2)).toBe(2 * STAGGER_MS);
    expect(revealDelay(50)).toBe(MAX_STAGGER_STEPS * STAGGER_MS);
    expect(revealDelay(-3)).toBe(0);
    expect(revealDelay(Number.NaN)).toBe(0);
  });

  it('keeps press feedback subtle', () => {
    expect(PRESS_SCALE).toBe(0.98);
    expect(PRESS_OPACITY).toBeGreaterThanOrEqual(0.85);
    expect(PRESS_OPACITY).toBeLessThan(1);
  });
});

describe('status badges are readable on their pills (AA, 4.5:1)', () => {
  it.each(Object.entries(BADGE_TONE_CLASS))('%s', (_tone, { surface, text }) => {
    expect(contrast(TONE_COLOR[text], backgroundOf(surface))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('icon tiles', () => {
  it.each(Object.entries(TILE_TONE))('%s icon stands out from its tile (≥ 3:1)', (_t, tile) => {
    expect(contrast(TONE_COLOR[tile.icon], backgroundOf(tile.surface))).toBeGreaterThanOrEqual(3);
  });

  it('sizes tiles on the 4pt scale and fits the icon inside', () => {
    expect(TILE_SIZE_CLASS).toEqual({ sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' });
    expect(iconPixels(TILE_ICON_SIZE.sm)).toBeLessThan(32);
    expect(iconPixels(TILE_ICON_SIZE.lg)).toBeLessThan(56);
    expect(tileShapeClass('md', 'circle')).toBe('rounded-full');
    expect(tileShapeClass('lg', 'rounded')).toBe('rounded-lg');
  });

  it('derives icon sizes from the 20px token', () => {
    expect(iconPixels('default')).toBe(20);
    expect(iconPixels('small')).toBe(16);
    expect(iconPixels('large')).toBe(40);
  });
});

describe('cards', () => {
  it('float neutral cards on a soft shadow and keep tinted cards flat', () => {
    expect(CARD_TONE_CLASS.default).toBe('bg-surface-raised border-border-subtle');
    expect(CARD_ELEVATION.default).toBe('sm');
    expect(CARD_ELEVATION.accent).toBe('none');
    expect(CARD_PADDING_CLASS.default).toBe('p-5');
    expect(CARD_PADDING_CLASS.list).toBe('px-5 py-2');
  });

  it('keeps body text readable on every card tone', () => {
    for (const classes of Object.values(CARD_TONE_CLASS)) {
      const bg = backgroundOf(classes);
      expect(contrast(colorLight.text.primary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colorLight.text.secondary, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('chips', () => {
  it('meets the tap target and selects with the amber tint and an ink outline', () => {
    expect(CHIP_BASE_CLASS).toContain('min-h-tap');
    expect(CHIP_SELECTED_OVERLAY_CLASS).toContain('bg-accent-subtle');
    expect(CHIP_SELECTED_OVERLAY_CLASS).toContain('border-text-primary');
    expect(chipBorderClass(false, false)).toContain('border-border-subtle');
    expect(chipBorderClass(false, true)).toContain('border-border-strong');
  });

  it('keeps chip text dark in every state — never amber', () => {
    expect(chipLabelTone(true, false)).toBe('onAccent');
    expect(chipLabelTone(false, false)).toBe('primary');
    expect(chipLabelTone(true, true)).toBe('tertiary');
    expect(chipSublabelTone(false, false)).toBe('secondary');
    const selectedBg = backgroundOf(CHIP_SELECTED_OVERLAY_CLASS);
    expect(contrast(TONE_COLOR.onAccent, selectedBg)).toBeGreaterThanOrEqual(7);
  });

  it('shapes date pills as rounded rectangles and single-line chips as pills', () => {
    expect(chipShapeClass(true)).toBe('rounded-lg py-2');
    expect(chipRadiusClass(false)).toBe('rounded-full');
  });
});
