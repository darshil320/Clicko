import { describe, expect, it } from 'vitest';
import { isPaletteShortcut, matchesQuery, moveActive } from './command.js';

describe('moveActive', () => {
  it('moves and wraps at both ends', () => {
    expect(moveActive(0, 1, 3)).toBe(1);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
  });

  it('starts from the top (down) or the bottom (up), and is -1 for no rows', () => {
    expect(moveActive(-1, 1, 4)).toBe(0);
    expect(moveActive(-1, -1, 4)).toBe(3);
    expect(moveActive(2, 1, 0)).toBe(-1);
  });
});

describe('matchesQuery', () => {
  it('matches every word, in any order and case, against label and keywords', () => {
    expect(matchesQuery('late del', 'Late deliveries')).toBe(true);
    expect(matchesQuery('DELIVERIES late', 'Late deliveries')).toBe(true);
    expect(matchesQuery('money ref', 'Refunds', 'money')).toBe(true);
    expect(matchesQuery('payouts', 'Refunds', 'money')).toBe(false);
    expect(matchesQuery('   ', 'Anything')).toBe(true);
  });

  it('ignores accents', () => {
    expect(matchesQuery('cafe', 'Café shoot')).toBe(true);
  });
});

describe('isPaletteShortcut', () => {
  const key = (over: Partial<Parameters<typeof isPaletteShortcut>[0]>) => ({
    key: 'k',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  });

  it('is ⌘K or Ctrl+K, nothing else', () => {
    expect(isPaletteShortcut(key({ metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ ctrlKey: true, key: 'K' }))).toBe(true);
    expect(isPaletteShortcut(key({}))).toBe(false);
    expect(isPaletteShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, key: 'j' }))).toBe(false);
  });
});
