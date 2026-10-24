import {
  colorDaylight,
  colourEntries,
  daylightElevation,
  daylightExtras,
  daylightType,
  elevation,
  layout,
  sectionSpace,
} from '@clickco/design-tokens';
import { describe, expect, it } from 'vitest';
import { siteCss } from '../theme';
import { motionCss } from './motion';
import { photoCss } from './photo';
import { fluid, motionOk, webType } from './tokens';

const css = siteCss();

describe('Daylight theme (ADR-0018, on ADR-0017)', () => {
  it('declares the Daylight palette, its extras and the light colour scheme', () => {
    expect(css).toContain(`--color-surface-base:${colorDaylight.surface.base}`);
    expect(css).toContain(`--color-text-primary:${colorDaylight.text.primary}`);
    for (const [name, value] of colourEntries(daylightExtras)) {
      expect(css).toContain(`--color-${name}:${value}`);
    }
    expect(css).toContain('color-scheme:light');
  });

  it('declares every elevation token as a CSS variable', () => {
    for (const [level, value] of Object.entries({ ...elevation, ...daylightElevation })) {
      expect(css).toContain(`--shadow-${level}:${value}`);
    }
  });

  it('never uses the amber fill as a text colour — only accent-text, or amber on darkroom', () => {
    const light = css.replace(/\.section-dark[^{]*\{[^}]*\}/g, '');
    expect(light).not.toMatch(/(^|[;{\s])color:var\(--color-accent-(?!text\))/);
  });

  it('paints with photo colours only inside the photo frame styles', () => {
    const rest = css.replace(photoCss(), '');
    expect(rest).not.toContain('var(--color-photo-');
  });

  it('never sets tertiary text on a tint (DESIGN-DAYLIGHT §Rules)', () => {
    const tinted = css.match(/\.tone-(sage|clay|haze)[^{]*\{[^}]*\}/g) ?? [];
    for (const rule of tinted) expect(rule).not.toContain('--color-text-tertiary');
  });

  it('caps content at the token widths (the page frame adds its side padding)', () => {
    const gutters = layout.screenPaddingX * 2;
    expect(css).toContain(`.wrap{max-width:${sectionSpace.contentMax + gutters}px`);
    expect(css).toContain(`max-width:${sectionSpace.readingMax}px`);
  });

  it('uses the token section rhythm at every breakpoint', () => {
    for (const gap of [sectionSpace.mobile, sectionSpace.tablet, sectionSpace.desktop]) {
      expect(css).toContain(`padding-top:${gap}px`);
    }
  });
});

describe('motion (DESIGN-LIGHT §Motion)', () => {
  it('keeps every animation and transition behind prefers-reduced-motion: no-preference', () => {
    const motion = motionCss();
    const rest = css.replace(motion, '');
    expect(rest).not.toMatch(/animation|transition|scroll-behavior/);
    expect(motion.trim().startsWith(`${motionOk}{`)).toBe(true);
    expect(motion.match(/@media/g)).toHaveLength(1);
  });
});

describe('fluid type', () => {
  it('clamps between the mobile step and the wide step', () => {
    expect(fluid(24, 40)).toMatch(
      /^clamp\(24px,calc\(24px \+ 16 \* \(\(100vw - \d+px\) \/ \d+\)\),40px\)$/,
    );
  });

  it('grows the serif hero from the Daylight step', () => {
    expect(webType.hero.min).toBe(daylightType.fluid.hero.min);
    expect(webType.hero.max).toBe(daylightType.fluid.hero.max);
    expect(webType.hero.max).toBeGreaterThan(webType.section.max);
    expect(webType.section.max).toBeGreaterThan(webType.title.max);
  });
});
