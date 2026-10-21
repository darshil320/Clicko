import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  color,
  colourEntries,
  cssVariables,
  radius,
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
});
