import { color, colorLight } from '@clickco/design-tokens';
import { describe, expect, it } from 'vitest';
import { siteCss } from '../theme';
import { brandMarkSvg } from './brand-mark';

describe('brandMarkSvg', () => {
  it('draws the mark in token colours only', () => {
    const svg = brandMarkSvg();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`fill="${color.surface.base}"`);
    expect(svg).toContain(`stroke="${color.accent.default}"`);
    const colours = new Set(svg.match(/#[0-9A-Fa-f]{6}/g));
    expect([...colours].sort()).toEqual([color.accent.default, color.surface.base].sort());
  });

  it('scales the rendered size, not the drawing', () => {
    expect(brandMarkSvg(180)).toContain('width="180" height="180" viewBox="0 0 64 64"');
  });
});

describe('siteCss', () => {
  it('declares every colour once as a CSS variable and uses var() everywhere else', () => {
    const css = siteCss();
    const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
    const rest = css.replace(root, '');
    expect(root).toContain(`--color-accent-default:${colorLight.accent.default}`);
    expect(root).toContain(`--color-surface-base:${colorLight.surface.base}`);
    expect(rest).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });
});
