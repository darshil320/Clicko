import { describe, expect, it } from 'vitest';
import { approvable } from './labels';
import { istLocalToIso } from './new-claim-sheet';

describe('claims helpers', () => {
  it('never offers more than the claim or the cap', () => {
    expect(approvable(4_500_000, 20_000_000)).toBe(4_500_000);
    expect(approvable(30_000_000, 20_000_000)).toBe(20_000_000);
  });

  it('reads a datetime-local value as IST', () => {
    expect(istLocalToIso('2026-12-07T14:30')).toBe('2026-12-07T09:00:00.000Z');
    expect(istLocalToIso('')).toBeUndefined();
  });
});
