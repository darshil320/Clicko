import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  color,
  colorLight,
  colourEntries,
  cssVariables,
  lightTailwindPreset,
  motion,
  radius,
  sectionSpace,
  space,
  tailwindPreset,
  typography,
} from './index.js';

const DESIGN_MD = readFileSync(
  fileURLToPath(new URL('../../../docs/DESIGN.md', import.meta.url)),
  'utf8',
);

/** "accent/default  #FFB63D" lines from docs/DESIGN.md §Colour. */
function designColours(): Array<[string, string]> {
  return [...DESIGN_MD.matchAll(/^([a-z-]+(?:\/[a-z-]+)?)\s+(#[0-9A-Fa-f]{6})\b/gm)].map((m) => [
    m[1] as string,
    (m[2] as string).toUpperCase(),
  ]);
}

function lookup(path: string): string | undefined {
  const [group, variant = 'default'] = path.split('/');
  const entry = (color as Record<string, unknown>)[group as string];
  if (typeof entry === 'string') return entry;
  return (entry as Record<string, string> | undefined)?.[variant];
}

describe('tokens mirror docs/DESIGN.md', () => {
  it('defines exactly the colours in the table — no more, no fewer', () => {
    expect(designColours()).toHaveLength(17);
    expect(colourEntries()).toHaveLength(designColours().length);
  });

  it.each(designColours())('%s is %s', (path, hex) => {
    expect(lookup(path)?.toUpperCase()).toBe(hex);
  });

  it('uses the 4pt spacing scale exactly', () => {
    expect(Object.values(space)).toEqual([4, 8, 12, 16, 20, 24, 32, 40, 56]);
  });

  it('uses the documented radii', () => {
    expect(radius).toEqual({ sm: 8, md: 12, lg: 16, full: 999 });
  });

  it('defines every type-scale step', () => {
    expect(Object.keys(typography.scale)).toEqual([
      'display',
      'h1',
      'h2',
      'h3',
      'body',
      'bodyStrong',
      'caption',
      'micro',
    ]);
    expect(typography.scale.body).toEqual({ size: 15, lineHeight: 22, weight: '400' });
  });
});

describe('derived outputs', () => {
  it('emits a CSS variable per colour token', () => {
    const css = cssVariables();
    expect(css).toContain('--color-accent-default: #FFB63D;');
    expect(css).toContain('--color-surface-base: #0A0A0B;');
    expect(css.startsWith(':root {')).toBe(true);
  });

  it('exposes colours, spacing and radii to Tailwind / NativeWind', () => {
    const theme = tailwindPreset.theme.extend;
    expect(theme.colors.accent.default).toBe('#FFB63D');
    expect(theme.spacing['4']).toBe('16px');
    expect(theme.borderRadius.lg).toBe('16px');
  });

  it('exposes the layout sizes and micro tracking derived from tokens', () => {
    const theme = tailwindPreset.theme.extend;
    expect(theme.minHeight.tap).toBe('44px');
    expect(theme.height.button).toBe('52px');
    expect(theme.height.input).toBe('52px');
    expect(theme.letterSpacing.micro).toBe('0.06em');
  });
});

const DESIGN_LIGHT_MD = readFileSync(
  fileURLToPath(new URL('../../../docs/DESIGN-LIGHT.md', import.meta.url)),
  'utf8',
);

const lightColours = (): Array<[string, string]> =>
  [...DESIGN_LIGHT_MD.matchAll(/^([a-z-]+(?:\/[a-z-]+)?)\s+(#[0-9A-Fa-f]{6})\b/gm)].map((m) => [
    m[1] as string,
    (m[2] as string).toUpperCase(),
  ]);

function lookupIn(palette: Record<string, unknown>, path: string): string {
  const [group, variant = 'default'] = path.split('/');
  const entry = palette[group as string];
  return (typeof entry === 'string' ? entry : (entry as Record<string, string>)[variant]) as string;
}

/** WCAG 2.x relative luminance contrast ratio. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the white theme mirrors docs/DESIGN-LIGHT.md (ADR-0017)', () => {
  it('has the same token names as the dark theme, one value each', () => {
    expect(colourEntries(colorLight).map(([k]) => k)).toEqual(colourEntries(color).map(([k]) => k));
    expect(lightColours()).toHaveLength(colourEntries(colorLight).length);
  });

  it.each(lightColours())('%s is %s', (path, hex) => {
    expect(lookupIn(colorLight, path).toUpperCase()).toBe(hex);
  });

  it('keeps every text token readable (≥ 4.5:1) on the page and on cards', () => {
    for (const surface of [colorLight.surface.base, colorLight.surface.raised]) {
      for (const text of [
        colorLight.text.primary,
        colorLight.text.secondary,
        colorLight.text.tertiary,
      ]) {
        expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps status colours readable as text on white, and on their tints', () => {
    for (const c of [
      colorLight.success,
      colorLight.warning,
      colorLight.danger,
      colorLight.emergency.default,
    ]) {
      expect(contrast(c, colorLight.surface.base), c).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(colorLight.emergency.default, colorLight.emergency.subtle),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('puts dark text on the amber accent (the accent is a fill, never text on white)', () => {
    expect(
      contrast(colorLight.text['on-accent'], colorLight.accent.default),
    ).toBeGreaterThanOrEqual(7);
    expect(contrast(colorLight.text['on-accent'], colorLight.accent.hover)).toBeGreaterThanOrEqual(
      7,
    );
    expect(contrast(colorLight.accent.default, colorLight.surface.base)).toBeLessThan(4.5);
  });

  it('emits light CSS variables and a light NativeWind preset', () => {
    expect(cssVariables(colorLight)).toContain('--color-surface-base: #FFFFFF;');
    expect(lightTailwindPreset.theme.extend.colors.surface.base).toBe('#FFFFFF');
    expect(tailwindPreset.theme.extend.colors.surface.base).toBe('#0A0A0B');
  });

  it('documents the whitespace rhythm and motion it encodes', () => {
    expect(DESIGN_LIGHT_MD).toContain(`${sectionSpace.desktop} (desktop)`);
    expect(DESIGN_LIGHT_MD).toContain(`${motion.fastMs} ms`);
  });
});
