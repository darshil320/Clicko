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

/** Every row of docs/DOMAIN.md §2, written out by hand. The table must allow exactly these. */
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
  // "Photographer cancels after acceptance": the post-acceptance pre-shoot states
  ['ASSIGNED', 'CANCELLED_PRO'],
  ['EN_ROUTE', 'CANCELLED_PRO'],
  ['ASSIGNED', 'PRO_NO_SHOW'],
  ['EN_ROUTE', 'PRO_NO_SHOW'],
  ['CHECKED_IN', 'ACCESS_DENIED'],
  ['IN_PROGRESS', 'ACCESS_DENIED'],
  ['IN_PROGRESS', 'UNSAFE_SITE'],
  ['UPLOADING', 'DATA_LOSS'],
  ['PROCESSING', 'DATA_LOSS'],
  ['QA', 'DATA_LOSS'],
  // "DELIVERED (or earlier)": every post-shoot state up to and including DELIVERED
  ['CHECKED_OUT', 'QUALITY_ESCALATION'],
  ['UPLOADING', 'QUALITY_ESCALATION'],
  ['PROCESSING', 'QUALITY_ESCALATION'],
  ['QA', 'QUALITY_ESCALATION'],
  ['BALANCE_PENDING', 'QUALITY_ESCALATION'],
  ['DELIVERED', 'QUALITY_ESCALATION'],
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
    ['DISPATCHING', 'CANCELLED_PRO'],
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

  it('treats closed, cancelled and exception outcomes as terminal', () => {
    const terminal = STATUSES.filter((s) => isTerminal(s));
    expect(terminal).toEqual([
      'CLOSED',
      'CANCELLED_CLIENT',
      'CANCELLED_PRO',
      'PRO_NO_SHOW',
      'ACCESS_DENIED',
      'UNSAFE_SITE',
      'DATA_LOSS',
      'QUALITY_ESCALATION',
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
  });
});
