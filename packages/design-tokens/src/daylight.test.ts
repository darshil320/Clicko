import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  colorDaylight,
  colorLight,
  colourEntries,
  daylightElevation,
  daylightExtras,
  daylightRadius,
  daylightType,
} from './index.js';

const DESIGN_DAYLIGHT_MD = readFileSync(
  fileURLToPath(new URL('../../../docs/DESIGN-DAYLIGHT.md', import.meta.url)),
  'utf8',
);

/** "surface/base   #FBFAF7" lines from one `## Colour — …` section of DESIGN-DAYLIGHT.md. */
function documented(heading: string): Array<[string, string]> {
  const start = DESIGN_DAYLIGHT_MD.indexOf(`## Colour — ${heading}`);
  const end = DESIGN_DAYLIGHT_MD.indexOf('\n## ', start + 1);
  const section = DESIGN_DAYLIGHT_MD.slice(start, end);
  return [...section.matchAll(/^([a-z-]+(?:\/[a-z-]+)?)\s+(#[0-9A-Fa-f]{6})\b/gm)].map((m) => [
    m[1] as string,
    (m[2] as string).toUpperCase(),
  ]);
}

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

const AA = 4.5;
const c = colorDaylight;
const x = daylightExtras;

describe('the Daylight palette mirrors docs/DESIGN-DAYLIGHT.md (ADR-0018)', () => {
  it('has exactly colorLight’s token names, so the website switches by palette', () => {
    expect(colourEntries(colorDaylight).map(([k]) => k)).toEqual(
      colourEntries(colorLight).map(([k]) => k),
    );
    expect(documented('the palette')).toHaveLength(colourEntries(colorDaylight).length);
  });

  it.each(documented('the palette'))('%s is %s', (path, hex) => {
    expect(lookupIn(colorDaylight, path).toUpperCase()).toBe(hex);
  });

  it('documents every extra and every photo colour, no more, no fewer', () => {
    const docs = [...documented('extras'), ...documented('placeholder photographs')];
    expect(docs).toHaveLength(colourEntries(daylightExtras).length);
    for (const [path, hex] of docs) {
      expect(lookupIn(daylightExtras, path).toUpperCase(), path).toBe(hex);
    }
  });

  it('keeps the brand amber, emergency and status colours from the white theme', () => {
    expect(c.accent.default).toBe(colorLight.accent.default);
    expect(c.emergency).toEqual(colorLight.emergency);
    expect([c.success, c.warning, c.danger]).toEqual([
      colorLight.success,
      colorLight.warning,
      colorLight.danger,
    ]);
  });
});

describe('Daylight contrast (WCAG AA)', () => {
  const grounds = [c.surface.base, c.surface.raised, c.surface.overlay, c.accent.subtle];
  const tints = [x.sage.default, x.clay.default, x.haze.default];

  it('reads every text colour on paper, linen, white and the amber wash', () => {
    for (const ground of grounds) {
      for (const text of [c.text.primary, c.text.secondary, c.text.tertiary, x.accent.text]) {
        expect(contrast(text, ground), `${text} on ${ground}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('reads primary and secondary text on every tint (tertiary is not allowed there)', () => {
    for (const tint of tints) {
      for (const text of [c.text.primary, c.text.secondary]) {
        expect(contrast(text, tint), `${text} on ${tint}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('reads each tint’s deep colour on its own tint', () => {
    for (const tone of [x.sage, x.clay, x.haze]) {
      expect(contrast(tone.deep, tone.default), tone.deep).toBeGreaterThanOrEqual(AA);
    }
  });

  it('reads text and captions on the darkroom band', () => {
    expect(contrast(x.darkroom.text, x.darkroom.default)).toBeGreaterThanOrEqual(7);
    expect(contrast(x.darkroom.muted, x.darkroom.default)).toBeGreaterThanOrEqual(AA);
    // The italic accent word on darkroom is amber itself (DESIGN-DAYLIGHT §Rules).
    expect(contrast(c.accent.default, x.darkroom.default)).toBeGreaterThanOrEqual(7);
  });

  it('keeps status and emergency colours readable as text on paper', () => {
    for (const status of [c.success, c.warning, c.danger, c.emergency.default]) {
      expect(contrast(status, c.surface.base), status).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps amber a fill: dark text on it, never readable as text itself', () => {
    expect(contrast(c.text['on-accent'], c.accent.default)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.accent.default, c.surface.base)).toBeLessThan(AA);
  });
});

describe('Daylight type, shape and depth', () => {
  it('names the three families in DESIGN-DAYLIGHT.md', () => {
    for (const family of Object.values(daylightType.family)) {
      expect(DESIGN_DAYLIGHT_MD).toContain(family);
    }
  });

  it('documents every fluid step as "min → max"', () => {
    for (const [name, step] of Object.entries(daylightType.fluid)) {
      expect(DESIGN_DAYLIGHT_MD).toMatch(
        new RegExp(`^${name}\\s+${step.min} → ${step.max}\\s`, 'm'),
      );
      expect(step.max).toBeGreaterThan(step.min);
    }
    expect(daylightType.fluid.hero.max).toBeGreaterThan(daylightType.fluid.section.max);
  });

  it('documents the photo and panel radii and the photo shadow', () => {
    expect(DESIGN_DAYLIGHT_MD).toMatch(new RegExp(`radius/photo\\s+${daylightRadius.photo}\\s`));
    expect(DESIGN_DAYLIGHT_MD).toMatch(new RegExp(`radius/panel\\s+${daylightRadius.panel}\\s`));
    expect(DESIGN_DAYLIGHT_MD).toContain(daylightElevation.photo);
  });
});
