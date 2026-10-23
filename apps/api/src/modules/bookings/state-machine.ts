/**
 * The booking lifecycle — a pure mirror of docs/DOMAIN.md §2. No I/O. Every status change in
 * the system is validated here first (Invariant 1); BookingsService then logs it and writes the
 * outbox event in the same transaction.
 *
 * Reading of two rows that DOMAIN states loosely:
 *  - "(any pre-shoot state) → CANCELLED_PRO" is triggered by "photographer cancels after
 *    acceptance", so it is only reachable from the post-acceptance pre-shoot states.
 *  - "DELIVERED (or earlier) → QUALITY_ESCALATION" is read as every post-shoot state up to
 *    DELIVERED: there is nothing to judge before check-out.
 * IN_PROGRESS → EXTENSION_REQUESTED → EXTENSION_APPROVED is an assignment event, not a booking
 * status: the booking stays IN_PROGRESS.
 */
import type { BookingStatus } from '@clickco/contracts';

export type ActorKind = 'SYSTEM' | 'USER' | 'PHOTOGRAPHER' | 'STAFF';

const PRE_SHOOT_CANCEL = ['CANCELLED_CLIENT'] as const;
const POST_ACCEPTANCE = ['CANCELLED_CLIENT', 'CANCELLED_PRO', 'PRO_NO_SHOW'] as const;
const POST_SHOOT = ['QUALITY_ESCALATION'] as const;

const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  DRAFT: ['QUOTED', ...PRE_SHOOT_CANCEL],
  QUOTED: ['ADVANCE_PENDING', ...PRE_SHOOT_CANCEL],
  ADVANCE_PENDING: ['CONFIRMED', ...PRE_SHOOT_CANCEL],
  CONFIRMED: ['DISPATCHING', ...PRE_SHOOT_CANCEL],
  DISPATCHING: ['ASSIGNED', ...PRE_SHOOT_CANCEL],
  ASSIGNED: ['EN_ROUTE', ...POST_ACCEPTANCE],
  EN_ROUTE: ['CHECKED_IN', ...POST_ACCEPTANCE],
  CHECKED_IN: ['IN_PROGRESS', 'ACCESS_DENIED'],
  IN_PROGRESS: ['CHECKED_OUT', 'ACCESS_DENIED', 'UNSAFE_SITE'],
  CHECKED_OUT: ['UPLOADING', ...POST_SHOOT],
  UPLOADING: ['PROCESSING', 'DATA_LOSS', ...POST_SHOOT],
  PROCESSING: ['QA', 'DATA_LOSS', ...POST_SHOOT],
  QA: ['BALANCE_PENDING', 'DATA_LOSS', ...POST_SHOOT],
  BALANCE_PENDING: ['DELIVERED', 'ABANDONED', ...POST_SHOOT],
  DELIVERED: ['CLOSED', ...POST_SHOOT],
  CLOSED: [],
  CANCELLED_CLIENT: [],
  CANCELLED_PRO: [],
  PRO_NO_SHOW: [],
  ACCESS_DENIED: [],
  UNSAFE_SITE: [],
  DATA_LOSS: [],
  QUALITY_ESCALATION: [],
  ABANDONED: [],
};

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

/** DOMAIN §3: `booking.<status>`, except creation, which the catalogue names `booking.drafted`. */
export function eventTypeFor(to: BookingStatus): string {
  return to === 'DRAFT' ? 'booking.drafted' : `booking.${to.toLowerCase()}`;
}
