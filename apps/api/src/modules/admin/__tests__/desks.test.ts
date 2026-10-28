import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { flagsFor } from '../desks/flags';
import {
  decodeCursor,
  encodeCursor,
  istDayStart,
  normaliseQuery,
  pageOf,
  TimeCursor,
  TimeSeqCursor,
} from '../desks/paging';

describe('board flags', () => {
  const none = new Set<string>();
  it('maps reviews, alerts and the breached promise', () => {
    expect(
      flagsFor({
        status: 'QA',
        alertTypes: ['booking.needs_review', 'ops.alert'],
        slaBreached: true,
        reportKinds: none,
      }),
    ).toEqual(['NEEDS_REVIEW', 'OPS_ALERT', 'SLA_BREACHED']);
    expect(
      flagsFor({
        status: 'QA',
        alertTypes: ['payment.needs_review'],
        slaBreached: false,
        reportKinds: none,
      }),
    ).toEqual(['NEEDS_REVIEW']);
  });

  it('an incident report is open only while the booking awaits the decision', () => {
    const denied = new Set(['ACCESS_DENIED_REPORTED']);
    const absent = new Set(['CLIENT_ABSENT_REPORTED']);
    const flag = (status: Parameters<typeof flagsFor>[0]['status'], kinds: Set<string>) =>
      flagsFor({ status, alertTypes: [], slaBreached: false, reportKinds: kinds });
    expect(flag('CHECKED_IN', denied)).toEqual(['INCIDENT_REPORTED']);
    expect(flag('ACCESS_DENIED', denied)).toEqual([]);
    expect(flag('CHECKED_OUT', absent)).toEqual(['INCIDENT_REPORTED']);
    expect(flag('UPLOADING', absent)).toEqual([]);
  });
});

describe('admin list paging', () => {
  it('round-trips a cursor and refuses a forged one with 400 (never a 500 from a bad cast)', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const c = encodeCursor({ t: '2026-12-01T00:00:00.000Z', i: id });
    expect(decodeCursor(TimeCursor, c)).toEqual({ t: '2026-12-01T00:00:00.000Z', i: id });
    expect(decodeCursor(TimeCursor, undefined)).toBeUndefined();
    const forged = [
      '%%%',
      'e30',
      encodeCursor({ t: 'yesterday', i: id }),
      encodeCursor({ t: '2026-12-01T00:00:00.000Z', i: 'not-a-uuid' }),
    ];
    for (const bad of forged) expect(() => decodeCursor(TimeCursor, bad)).toThrow(HttpException);
    const seq = encodeCursor({ t: '2026-12-01T00:00:00.000Z', i: '9'.repeat(19) });
    expect(() => decodeCursor(TimeSeqCursor, seq)).toThrow(HttpException);
  });

  it('pages limit + 1 rows into items and a next cursor', () => {
    const rows = [1, 2, 3].map((n) => ({ n }));
    expect(pageOf(rows, 2, (r) => ({ i: String(r.n) }))).toEqual({
      items: [{ n: 1 }, { n: 2 }],
      nextCursor: encodeCursor({ i: '2' }),
    });
    expect(pageOf(rows, 3, (r) => ({ i: String(r.n) })).nextCursor).toBeNull();
  });

  it('IST calendar days start at 18:30 UTC the evening before', () => {
    expect(istDayStart('2026-12-07').toISOString()).toBe('2026-12-06T18:30:00.000Z');
  });

  it('normalises query strings for the contract schemas', () => {
    expect(
      normaliseQuery(
        { status: ['QA,DISPATCHING', 'ASSIGNED'], needsAttention: 'true', limit: '20', q: 'CLK-1' },
        new Set(['status']),
      ),
    ).toEqual({
      status: ['QA', 'DISPATCHING', 'ASSIGNED'],
      needsAttention: true,
      limit: 20,
      q: 'CLK-1',
    });
    expect(normaliseQuery({ status: 'OPEN', needsAttention: '0' })).toEqual({
      status: 'OPEN',
      needsAttention: false,
    });
    expect(normaliseQuery(null)).toEqual({});
  });
});
