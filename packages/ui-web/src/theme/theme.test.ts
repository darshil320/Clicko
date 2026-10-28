import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { colorLight, colourEntries, radius, space, typography } from '@clickco/design-tokens';
import { describe, expect, it } from 'vitest';
import { blend, contrastRatio, WCAG_AA_TEXT } from './contrast.js';
import {
  colourVariables,
  resolveToken,
  SHADCN_COLOURS,
  type ShadcnColour,
  scaleVariables,
  TEXT_PAIRS,
  TEXT_STEPS,
  TINT_PERCENT,
  TINTED_TONES,
  themeStylesheet,
  themeVariables,
} from './theme.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const STYLES = readFileSync(`${SRC}/styles.css`, 'utf8');
const COMPONENTS = readdirSync(`${SRC}/components`)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => [f, readFileSync(`${SRC}/components/${f}`, 'utf8')] as const);

const vars = colourVariables(colorLight);
const colour = (name: ShadcnColour): string => vars[`--${name}`] as string;

/** The variables shadcn/ui's components and blocks expect a theme to define. */
const SHADCN_CORE = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
  'sidebar',
  'sidebar-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
];

describe('the shadcn theme maps to design tokens (ADR-0025 D6)', () => {
  it('defines every core shadcn variable', () => {
    for (const name of SHADCN_CORE) expect(Object.keys(SHADCN_COLOURS)).toContain(name);
  });

  it('resolves every shadcn colour to a colorLight token value', () => {
    const tokenValues = new Set(colourEntries(colorLight).map(([, hex]) => hex));
    for (const [name, token] of Object.entries(SHADCN_COLOURS)) {
      const value = resolveToken(colorLight, token);
      expect(tokenValues.has(value), `${name} → ${token}`).toBe(true);
      expect(vars[`--${name}`]).toBe(value);
    }
  });

  it('refuses an unknown token', () => {
    expect(() => resolveToken(colorLight, 'surface.nope' as never)).toThrow(/Unknown colour token/);
  });

  it('takes sizes from the token scales', () => {
    const scale = scaleVariables();
    expect(scale['--cc-space']).toBe(`${space[1]}px`);
    expect(scale['--cc-radius-md']).toBe(`${radius.md}px`);
    for (const [name, step] of Object.entries(TEXT_STEPS)) {
      expect(scale[`--cc-text-${name}`]).toBe(`${typography.scale[step].size}px`);
      expect(scale[`--cc-text-${name}-lh`]).toBe(`${typography.scale[step].lineHeight}px`);
    }
    expect(scale['--cc-font-body']).toContain(`"${typography.family.body}"`);
  });

  it('renders one :root block holding every variable', () => {
    const css = themeStylesheet();
    expect(css.startsWith(':root{')).toBe(true);
    for (const [name, value] of Object.entries(themeVariables())) {
      expect(css).toContain(`${name}:${value}`);
    }
  });
});

describe('styles.css only references the theme', () => {
  it('names no variable the theme does not supply', () => {
    const supplied = new Set(Object.keys(themeVariables()));
    const referenced = [...STYLES.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1] as string);
    expect(referenced.length).toBeGreaterThan(40);
    for (const name of referenced) expect(supplied.has(name), name).toBe(true);
  });

  it('exposes every shadcn colour to Tailwind', () => {
    for (const name of Object.keys(SHADCN_COLOURS)) {
      expect(STYLES).toContain(`--color-${name}: var(--${name});`);
    }
  });

  it('contains no raw colour and clears Tailwind’s defaults', () => {
    expect(STYLES).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(STYLES).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|oklab)\(/i);
    for (const ns of ['--color-*', '--text-*', '--radius-*', '--shadow-*']) {
      expect(STYLES).toContain(`${ns}: initial;`);
    }
  });
});

describe('contrast stays WCAG AA for text', () => {
  it.each(TEXT_PAIRS.map(([fg, bg]) => [fg, bg]))('%s on %s', (fg, bg) => {
    const ratio = contrastRatio(colour(fg as ShadcnColour), colour(bg as ShadcnColour));
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });

  it.each(TINTED_TONES.map((t) => [t]))(
    'foreground on a %s tint, on cards and the page',
    (tone) => {
      const tone_ = colour(tone as ShadcnColour);
      for (const surface of ['card', 'background', 'muted'] as const) {
        const tint = blend(tone_, TINT_PERCENT, colour(surface));
        expect(contrastRatio(colour('foreground'), tint), `on ${surface}`).toBeGreaterThanOrEqual(
          WCAG_AA_TEXT,
        );
      }
    },
  );

  it('never sets tone text on the same tone’s tint (it falls below AA)', () => {
    for (const [file, source] of COMPONENTS) {
      for (const line of source.split('\n')) {
        const tints = [...line.matchAll(/\bbg-([a-z-]+)\/\d+/g)].map((m) => m[1] as string);
        for (const tone of tints) {
          expect(line, file).not.toMatch(new RegExp(`(^|[\\s'"])text-${tone}(?![\\w-])`));
        }
      }
    }
  });

  it('keeps amber a fill: it would fail as text on white', () => {
    expect(contrastRatio(colour('primary'), colour('card'))).toBeLessThan(WCAG_AA_TEXT);
    for (const [file, source] of COMPONENTS) {
      expect(source, file).not.toMatch(/\btext-(sidebar-)?primary(?!-foreground)\b/);
    }
  });
});

describe('components use only theme utilities', () => {
  it.each(COMPONENTS.map(([f, s]) => [f, s]))(
    '%s has no raw colour or default palette',
    (_, source) => {
      expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(source).not.toMatch(
        /\b(bg|text|border|ring|fill|stroke)-(white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b/,
      );
      expect(source).not.toMatch(/\btext-(4xl|5xl|6xl|7xl|8xl|9xl)\b/);
    },
  );
});

describe('colour maths', () => {
  it('matches the WCAG reference points', () => {
    expect(contrastRatio(colorLight.text.primary, colorLight.surface.base)).toBeGreaterThan(18);
    expect(contrastRatio(colorLight.surface.base, colorLight.surface.base)).toBe(1);
    expect(blend(colorLight.text.primary, 0, colorLight.surface.base)).toBe(
      colorLight.surface.base,
    );
    expect(blend(colorLight.text.primary, 100, colorLight.surface.base)).toBe(
      colorLight.text.primary,
    );
  });
});
