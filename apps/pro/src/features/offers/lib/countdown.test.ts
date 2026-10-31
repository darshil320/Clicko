import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  isUrgent,
  MAX_EXPIRY_WAIT_MS,
  nextExpiryDelayMs,
  secondsLeft,
  spokenCountdown,
} from './countdown';

const NOW = new Date('2026-10-28T10:00:00.000Z');

describe('secondsLeft', () => {
  it('counts whole seconds until the offer expires', () => {
    expect(secondsLeft('2026-10-28T10:01:24.000Z', NOW)).toBe(84);
  });

  it('reads the API offset form', () => {
    expect(secondsLeft('2026-10-28T15:31:00+05:30', NOW)).toBe(60);
  });

  it('rounds a part second up, so 0 always means expired', () => {
    expect(secondsLeft('2026-10-28T10:00:00.400Z', NOW)).toBe(1);
    expect(secondsLeft('2026-10-28T10:00:00.000Z', NOW)).toBe(0);
  });

  it('is never negative', () => {
    expect(secondsLeft('2026-10-28T09:58:00.000Z', NOW)).toBe(0);
  });

  it('treats an unreadable instant as expired', () => {
    expect(secondsLeft('not a date', NOW)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it.each([
    [84, '1:24'],
    [60, '1:00'],
    [5, '0:05'],
    [0, '0:00'],
    [600, '10:00'],
    [3725, '1:02:05'],
  ])('%i s → %s', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected);
  });

  it('never shows a negative or fractional time', () => {
    expect(formatCountdown(-3)).toBe('0:00');
    expect(formatCountdown(4.6)).toBe('0:04');
  });
});

describe('spokenCountdown', () => {
  it.each([
    [84, '1 minute 24 seconds'],
    [120, '2 minutes'],
    [1, '1 second'],
    [0, '0 seconds'],
    [3725, '1 hour 2 minutes 5 seconds'],
  ])('%i s → %s', (seconds, expected) => {
    expect(spokenCountdown(seconds)).toBe(expected);
  });
});

describe('isUrgent', () => {
  it('flags the last 30 seconds of a live offer', () => {
    expect(isUrgent(31)).toBe(false);
    expect(isUrgent(30)).toBe(true);
    expect(isUrgent(1)).toBe(true);
    expect(isUrgent(0)).toBe(false);
  });
});

describe('nextExpiryDelayMs', () => {
  it('waits for the soonest offer still open', () => {
    expect(nextExpiryDelayMs(['2026-10-28T10:00:40.000Z', '2026-10-28T10:00:05.500Z'], NOW)).toBe(
      5_500,
    );
  });

  it('ignores closed and unreadable offers', () => {
    expect(
      nextExpiryDelayMs(['2026-10-28T09:59:00.000Z', 'nope', '2026-10-28T10:00:20.000Z'], NOW),
    ).toBe(20_000);
  });

  it('is null when nothing is still open', () => {
    expect(nextExpiryDelayMs([], NOW)).toBeNull();
    expect(nextExpiryDelayMs(['2026-10-28T10:00:00.000Z'], NOW)).toBeNull();
  });

  it('never sleeps longer than the cap', () => {
    expect(nextExpiryDelayMs(['2026-10-29T10:00:00.000Z'], NOW)).toBe(MAX_EXPIRY_WAIT_MS);
  });
});
