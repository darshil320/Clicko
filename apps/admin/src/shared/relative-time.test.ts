import { describe, expect, it } from 'vitest';
import { formatAgo } from './relative-time';

const NOW = Date.parse('2026-10-30T12:00:00Z');

describe('formatAgo', () => {
  it('says just now, minutes, hours and days, past and future', () => {
    expect(formatAgo('2026-10-30T11:59:30Z', NOW)).toBe('just now');
    expect(formatAgo('2026-10-30T11:35:00Z', NOW)).toBe('25 min ago');
    expect(formatAgo('2026-10-30T09:00:00Z', NOW)).toBe('3 h ago');
    expect(formatAgo('2026-10-29T11:00:00Z', NOW)).toBe('1 day ago');
    expect(formatAgo('2026-10-27T12:00:00Z', NOW)).toBe('3 days ago');
    expect(formatAgo('2026-10-30T14:00:00Z', NOW)).toBe('in 2 h');
  });
});
