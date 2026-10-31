import { describe, expect, it } from 'vitest';
import { POLL_MAX_MS, pollDelay } from './poll';

describe('pollDelay', () => {
  it('keeps the healthy cadence with no failures', () => {
    expect(pollDelay(10_000, 0, 0.7)).toBe(10_000);
  });

  it('doubles the ceiling per failure and waits in its upper half', () => {
    expect(pollDelay(10_000, 1, 0)).toBe(10_000);
    expect(pollDelay(10_000, 1, 0.5)).toBe(15_000);
    expect(pollDelay(10_000, 2, 0)).toBe(20_000);
    expect(pollDelay(10_000, 3, 0.999)).toBe(79_960);
  });

  it('caps at 120 s', () => {
    expect(pollDelay(10_000, 10, 0.999)).toBeLessThanOrEqual(POLL_MAX_MS);
    expect(pollDelay(30_000, 10, 0)).toBe(POLL_MAX_MS / 2);
  });

  it('never drops below the healthy cadence, even when the base exceeds the cap', () => {
    expect(pollDelay(10_000, 1, -1)).toBe(10_000);
    expect(pollDelay(200_000, 3, 0)).toBe(200_000);
  });
});
