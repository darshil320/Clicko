import { describe, expect, it } from 'vitest';
import { safeHref } from './safe-href';

describe('safeHref', () => {
  it('passes https, and http only when allowed', () => {
    expect(safeHref('https://x.example/a')).toBe('https://x.example/a');
    expect(safeHref('http://x.example/a')).toBeNull();
    expect(safeHref('http://x.example/a', true)).toBe('http://x.example/a');
  });

  it('refuses scripts, data and garbage', () => {
    expect(safeHref('javascript:alert(1)', true)).toBeNull();
    expect(safeHref('data:text/html,hi', true)).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
