import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { colorLight, elevation } from '@clickco/design-tokens';
import { describe, expect, it } from 'vitest';
import { portalCss } from './theme';

const css = portalCss();
const ROOT = join(__dirname, '..', '..');
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe('portal stylesheet — white theme (ADR-0017)', () => {
  it('declares the light palette and elevation as custom properties', () => {
    expect(css).toContain(`--color-surface-base:${colorLight.surface.base};`);
    expect(css).toContain(`--color-accent-default:${colorLight.accent.default};`);
    expect(css).toContain(`--color-text-primary:${colorLight.text.primary};`);
    expect(css).toContain(`--shadow-md:${elevation.md};`);
  });

  it('has balanced braces', () => {
    const opened = css.split('{').length;
    const closed = css.split('}').length;
    expect(opened).toBe(closed);
  });

  it('keeps raw colours inside :root only; everything else reads a token variable', () => {
    const root = css.slice(css.indexOf(':root{'), css.indexOf('color-scheme:light}'));
    const outside = css.replace(root, '');
    expect(outside.match(HEX) ?? []).toEqual([]);
    expect(outside).not.toMatch(/rgba?\(/);
  });

  it('never sets amber as a text colour (1.8:1 on white)', () => {
    expect(css).not.toMatch(/[{;]color:var\(--color-accent-(default|hover)\)/);
  });

  it('turns motion off for prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion:reduce)');
  });
});

describe('portal components', () => {
  const files = [...sources(join(ROOT, 'app')), ...sources(join(ROOT, 'src'))];

  it('carry no raw colours', () => {
    for (const file of files) {
      expect({ file, hex: readFileSync(file, 'utf8').match(HEX) ?? [] }).toEqual({ file, hex: [] });
    }
  });

  it('use inline styles only for progress widths', () => {
    for (const file of files) {
      const styles = readFileSync(file, 'utf8').match(/style=\{\{[^}]*\}\}/g) ?? [];
      for (const style of styles) expect(style).toMatch(/^style=\{\{ width: `\$\{\w+\}%` \}\}$/);
    }
  });
});
