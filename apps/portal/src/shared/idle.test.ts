import { describe, expect, it } from 'vitest';
import { IDLE_LIMIT_MS, isIdle, shouldRecordActivity } from './idle';

describe('portal idle sign-out (audit L4, as ADR-0025 D6)', () => {
  const now = Date.parse('2026-11-14T10:00:00+05:30');

  it('signs out after 30 minutes without activity', () => {
    expect(IDLE_LIMIT_MS).toBe(30 * 60 * 1000);
    expect(isIdle(now - IDLE_LIMIT_MS, now)).toBe(true);
    expect(isIdle(now - IDLE_LIMIT_MS + 1, now)).toBe(false);
  });

  it('is never idle before any activity was recorded', () => {
    expect(isIdle(null, now)).toBe(false);
  });

  it('writes activity at most every 15 seconds', () => {
    expect(shouldRecordActivity(null, now)).toBe(true);
    expect(shouldRecordActivity(now - 14_999, now)).toBe(false);
    expect(shouldRecordActivity(now - 15_000, now)).toBe(true);
  });
});
