import { BookingStatus } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  eventTypeFor,
  IllegalTransitionError,
  isTerminal,
} from '../state-machine';

type S = BookingStatus;

const PRE_SHOOT: readonly S[] = [
  'DRAFT',
  'QUOTED',
  'ADVANCE_PENDING',
  'CONFIRMED',
  'DISPATCHING',
  'ASSIGNED',
  'EN_ROUTE',
];

/**
 * Every row of docs/DOMAIN.md §2 as amended by ADR-0011, written out by hand. The table must allow
 * exactly these.
 */
const DOMAIN_ROWS: ReadonlyArray<readonly [S, S]> = [
  ['DRAFT', 'QUOTED'],
  ['QUOTED', 'ADVANCE_PENDING'],
  ['ADVANCE_PENDING', 'CONFIRMED'],
  ['CONFIRMED', 'DISPATCHING'],
  ['DISPATCHING', 'ASSIGNED'],
  ['ASSIGNED', 'EN_ROUTE'],
  ['EN_ROUTE', 'CHECKED_IN'],
  ['CHECKED_IN', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'CHECKED_OUT'],
  ['CHECKED_OUT', 'UPLOADING'],
  ['UPLOADING', 'PROCESSING'],
  ['PROCESSING', 'QA'],
  ['QA', 'BALANCE_PENDING'],
  ['BALANCE_PENDING', 'DELIVERED'],
  ['DELIVERED', 'CLOSED'],
  // (any pre-shoot state) → CANCELLED_CLIENT
  ...PRE_SHOOT.map((from) => [from, 'CANCELLED_CLIENT'] as const),
  // ADR-0011 §1: a photographer cancellation or a no-show re-broadcast goes back to dispatch …
  ['ASSIGNED', 'DISPATCHING'],
  ['EN_ROUTE', 'DISPATCHING'],
  // … and only a failed replacement search (or an unfilled <3h emergency at T-90) ends there.
  ['DISPATCHING', 'CANCELLED_PRO'],
  ['DISPATCHING', 'PRO_NO_SHOW'],
  ['CHECKED_IN', 'ACCESS_DENIED'],
  ['IN_PROGRESS', 'ACCESS_DENIED'],
  ['IN_PROGRESS', 'UNSAFE_SITE'],
  // ADR-0016 D11: a confirmed unsafe site uploads what was shot.
  ['UNSAFE_SITE', 'UPLOADING'],
  ['UPLOADING', 'DATA_LOSS'],
  ['PROCESSING', 'DATA_LOSS'],
  ['QA', 'DATA_LOSS'],
  // ADR-0011 §2: escalation only after delivery, and the Quality Manager closes it.
  ['DELIVERED', 'QUALITY_ESCALATION'],
  ['QUALITY_ESCALATION', 'CLOSED'],
  ['BALANCE_PENDING', 'ABANDONED'],
];

const allowed = new Set(DOMAIN_ROWS.map(([f, t]) => `${f}>${t}`));
const STATUSES = BookingStatus.options;

describe('booking state machine (DOMAIN.md §2)', () => {
  it.each(DOMAIN_ROWS)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('allows nothing beyond the DOMAIN table (exhaustive over every status pair)', () => {
    const extras: string[] = [];
    const missing: string[] = [];
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const key = `${from}>${to}`;
        const actual = canTransition(from, to);
        if (actual && !allowed.has(key)) extras.push(key);
        if (!actual && allowed.has(key)) missing.push(key);
      }
    }
    expect({ extras, missing }).toEqual({ extras: [], missing: [] });
  });

  it('only lets a booking come into existence as DRAFT', () => {
    expect(canTransition(null, 'DRAFT')).toBe(true);
    for (const to of STATUSES.filter((s) => s !== 'DRAFT')) {
      expect(canTransition(null, to)).toBe(false);
    }
  });

  it.each([
    ['QUOTED', 'CONFIRMED'],
    ['DRAFT', 'ADVANCE_PENDING'],
    ['CONFIRMED', 'QUOTED'],
    ['ADVANCE_PENDING', 'QUOTED'],
    ['CHECKED_IN', 'CANCELLED_CLIENT'],
    ['ASSIGNED', 'CANCELLED_PRO'],
    ['EN_ROUTE', 'PRO_NO_SHOW'],
    ['CHECKED_OUT', 'QUALITY_ESCALATION'],
    ['BALANCE_PENDING', 'QUALITY_ESCALATION'],
    ['CONFIRMED', 'CANCELLED_PRO'],
    ['QUOTED', 'QUOTED'],
  ] as const)('refuses %s → %s with a typed error', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
    try {
      assertTransition(from, to);
    } catch (e) {
      expect(e).toMatchObject({ from, to });
    }
  });

  it('treats closed, cancelled and exception outcomes as terminal (not an unsafe site: its files are delivered)', () => {
    const terminal = STATUSES.filter((s) => isTerminal(s));
    expect(terminal).toEqual([
      'CLOSED',
      'CANCELLED_CLIENT',
      'CANCELLED_PRO',
      'PRO_NO_SHOW',
      'ACCESS_DENIED',
      'DATA_LOSS',
      'ABANDONED',
    ]);
    for (const from of terminal) {
      for (const to of STATUSES) expect(canTransition(from, to)).toBe(false);
    }
  });

  it('names events exactly as the DOMAIN §3 catalogue does', () => {
    expect(eventTypeFor('DRAFT')).toBe('booking.drafted');
    expect(eventTypeFor('QUOTED')).toBe('booking.quoted');
    expect(eventTypeFor('ADVANCE_PENDING')).toBe('booking.advance_pending');
    expect(eventTypeFor('CONFIRMED')).toBe('booking.confirmed');
    expect(eventTypeFor('CANCELLED_CLIENT')).toBe('booking.cancelled_client');
    expect(eventTypeFor('QA')).toBe('booking.qa');
    expect(eventTypeFor('CLOSED', 'QUALITY_ESCALATION')).toBe('booking.closed');
  });

  it('names the return to dispatch booking.redispatching, not booking.dispatching (ADR-0011)', () => {
    expect(eventTypeFor('DISPATCHING', 'CONFIRMED')).toBe('booking.dispatching');
    expect(eventTypeFor('DISPATCHING', 'ASSIGNED')).toBe('booking.redispatching');
    expect(eventTypeFor('DISPATCHING', 'EN_ROUTE')).toBe('booking.redispatching');
    expect(eventTypeFor('CANCELLED_PRO', 'DISPATCHING')).toBe('booking.cancelled_pro');
  });

  it('keeps QUALITY_ESCALATION open until the Quality Manager closes it', () => {
    expect(isTerminal('QUALITY_ESCALATION')).toBe(false);
  });
});
