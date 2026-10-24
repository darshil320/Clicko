import { colorLight, elevation, layout, sectionSpace } from '@clickco/design-tokens';
import { describe, expect, it } from 'vitest';
import { siteCss } from '../theme';
import { motionCss } from './motion';
import { fluid, motionOk, webType } from './tokens';

const css = siteCss();

describe('white theme (ADR-0017)', () => {
  it('declares the light palette and light colour scheme', () => {
    expect(css).toContain(`--color-surface-base:${colorLight.surface.base}`);
    expect(css).toContain(`--color-text-primary:${colorLight.text.primary}`);
    expect(css).toContain('color-scheme:light');
  });

  it('declares every elevation token as a CSS variable', () => {
    for (const [level, value] of Object.entries(elevation)) {
      expect(css).toContain(`--shadow-${level}:${value}`);
    }
  });

  it('never uses the amber accent as a text colour (1.8:1 on white)', () => {
    expect(css).not.toMatch(/(^|[;{\s])color:var\(--color-accent-/);
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

  it('grows the hero from the display token', () => {
    expect(webType.hero.min).toBe(32);
    expect(webType.hero.max).toBeGreaterThan(webType.section.max);
    expect(webType.section.max).toBeGreaterThan(webType.title.max);
  });
});
