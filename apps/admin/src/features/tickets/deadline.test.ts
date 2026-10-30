import { describe, expect, it } from 'vitest';
import { deadlineChip, spanLabel } from './deadline';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RECEIVED = Date.parse('2026-12-07T04:30:00.000Z');
const ticket = {
  ackDueAt: new Date(RECEIVED + 48 * HOUR).toISOString(),
  acknowledgedAt: null,
  resolveDueAt: new Date(RECEIVED + 30 * DAY).toISOString(),
  resolvedAt: null,
};

describe('spanLabel', () => {
  it('reads like a person would say it', () => {
    expect(spanLabel(45 * 60_000)).toBe('45 min');
    expect(spanLabel(10_000)).toBe('1 min');
    expect(spanLabel(6 * HOUR + 59 * 60_000)).toBe('6 h');
    expect(spanLabel(47 * HOUR)).toBe('47 h');
    expect(spanLabel(2 * DAY)).toBe('2 days');
    expect(spanLabel(-3 * DAY)).toBe('3 days');
  });
});

describe('deadlineChip (SA-02)', () => {
  it('counts down to the acknowledgement: quiet, then amber, then red', () => {
    expect(deadlineChip(ticket, RECEIVED + HOUR)).toEqual({
      label: 'Reply in 47 h',
      tone: 'outline',
    });
    expect(deadlineChip(ticket, RECEIVED + 42 * HOUR)).toEqual({
      label: 'Reply in 6 h',
      tone: 'warning',
    });
    expect(deadlineChip(ticket, RECEIVED + 4 * DAY)).toEqual({
      label: 'Reply overdue by 2 days',
      tone: 'destructive',
    });
  });

  it('then counts down to the resolution', () => {
    const acked = { ...ticket, acknowledgedAt: new Date(RECEIVED + HOUR).toISOString() };
    expect(deadlineChip(acked, RECEIVED + 18 * DAY)).toEqual({
      label: 'Resolve in 12 days',
      tone: 'outline',
    });
    expect(deadlineChip(acked, RECEIVED + 28 * DAY).tone).toBe('warning');
    expect(deadlineChip(acked, RECEIVED + 30 * DAY + 3 * HOUR)).toEqual({
      label: 'Resolve overdue by 3 h',
      tone: 'destructive',
    });
  });

  it('says how it ended once resolved', () => {
    const done = {
      ...ticket,
      acknowledgedAt: new Date(RECEIVED + HOUR).toISOString(),
      resolvedAt: new Date(RECEIVED + 2 * DAY).toISOString(),
    };
    expect(deadlineChip(done, RECEIVED + 40 * DAY)).toEqual({
      label: 'Resolved on time',
      tone: 'success',
    });
    const late = { ...done, resolvedAt: new Date(RECEIVED + 31 * DAY).toISOString() };
    expect(deadlineChip(late, RECEIVED + 40 * DAY).label).toBe('Resolved late');
  });
});
