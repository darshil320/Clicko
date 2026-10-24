/**
 * The booking lifecycle — a pure mirror of docs/DOMAIN.md §2 as amended by ADR-0011. No I/O.
 * Every status change in the system is validated here first (Invariant 1); BookingsService then
 * logs it and writes the outbox event in the same transaction.
 *
 * ADR-0011 amendments:
 *  - ASSIGNED / EN_ROUTE → DISPATCHING is the re-dispatch after a photographer cancels or no-shows
 *    (event `booking.redispatching`). CANCELLED_PRO and PRO_NO_SHOW are reached from DISPATCHING
 *    only, when the replacement search fails (or an unfilled <3h emergency reaches T-90).
 *  - QUALITY_ESCALATION is reachable only from DELIVERED and exits to CLOSED.
 * ADR-0016: UNSAFE_SITE → UPLOADING (the photographer uploads what was shot).
 * IN_PROGRESS → EXTENSION_REQUESTED → EXTENSION_APPROVED is an assignment event, not a booking
 * status: the booking stays IN_PROGRESS.
 */
import type { BookingStatus } from '@clickco/contracts';

export type ActorKind = 'SYSTEM' | 'USER' | 'PHOTOGRAPHER' | 'STAFF';

const PRE_SHOOT_CANCEL = ['CANCELLED_CLIENT'] as const;

const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  DRAFT: ['QUOTED', ...PRE_SHOOT_CANCEL],
  QUOTED: ['ADVANCE_PENDING', ...PRE_SHOOT_CANCEL],
  ADVANCE_PENDING: ['CONFIRMED', ...PRE_SHOOT_CANCEL],
  CONFIRMED: ['DISPATCHING', ...PRE_SHOOT_CANCEL],
  DISPATCHING: ['ASSIGNED', 'CANCELLED_PRO', 'PRO_NO_SHOW', ...PRE_SHOOT_CANCEL],
  ASSIGNED: ['EN_ROUTE', 'DISPATCHING', ...PRE_SHOOT_CANCEL],
  EN_ROUTE: ['CHECKED_IN', 'DISPATCHING', ...PRE_SHOOT_CANCEL],
  CHECKED_IN: ['IN_PROGRESS', 'ACCESS_DENIED'],
  IN_PROGRESS: ['CHECKED_OUT', 'ACCESS_DENIED', 'UNSAFE_SITE'],
  CHECKED_OUT: ['UPLOADING'],
  UPLOADING: ['PROCESSING', 'DATA_LOSS'],
  PROCESSING: ['QA', 'DATA_LOSS'],
  QA: ['BALANCE_PENDING', 'DATA_LOSS'],
  BALANCE_PENDING: ['DELIVERED', 'ABANDONED'],
  DELIVERED: ['CLOSED', 'QUALITY_ESCALATION'],
  QUALITY_ESCALATION: ['CLOSED'],
  CLOSED: [],
  CANCELLED_CLIENT: [],
  CANCELLED_PRO: [],
  PRO_NO_SHOW: [],
  ACCESS_DENIED: [],
  // ADR-0016 D11: a confirmed unsafe site delivers what was shot.
  UNSAFE_SITE: ['UPLOADING'],
  DATA_LOSS: [],
  ABANDONED: [],
};

/**
 * A photographer has accepted and the booking was not cancelled: a held (<3h) payment is expected
 * to be captured in any of these (dispatch and the webhook path share this list, ADR-0012).
 */
export const ACCEPTED_STATUSES: readonly BookingStatus[] = [
  'ASSIGNED',
  'EN_ROUTE',
  'CHECKED_IN',
  'IN_PROGRESS',
  'CHECKED_OUT',
  'UPLOADING',
  'PROCESSING',
  'QA',
  'BALANCE_PENDING',
  'DELIVERED',
  'CLOSED',
  'QUALITY_ESCALATION',
  'ACCESS_DENIED',
  'UNSAFE_SITE',
  'DATA_LOSS',
  'ABANDONED',
];

/** Statuses that hold an accepted photographer before the shoot (the re-dispatch sources). */
const REDISPATCH_SOURCES: readonly BookingStatus[] = ['ASSIGNED', 'EN_ROUTE'];

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: BookingStatus | null,
    readonly to: BookingStatus,
  ) {
    super(`Illegal booking transition ${from ?? '∅'} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

/** `from = null` is the creation of the row: a booking only ever starts as DRAFT. */
export function canTransition(from: BookingStatus | null, to: BookingStatus): boolean {
  if (from === null) return to === 'DRAFT';
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus | null, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** No transition leaves these. */
export function isTerminal(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * DOMAIN §3: `booking.<status>`, except creation (`booking.drafted`) and the return to dispatch
 * from an accepted state (`booking.redispatching`, ADR-0011).
 */
export function eventTypeFor(to: BookingStatus, from: BookingStatus | null = null): string {
  if (to === 'DRAFT') return 'booking.drafted';
  if (to === 'DISPATCHING' && from !== null && REDISPATCH_SOURCES.includes(from)) {
    return 'booking.redispatching';
  }
  return `booking.${to.toLowerCase()}`;
}
