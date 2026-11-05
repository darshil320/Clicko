import { isApiError } from '@clickco/api-client';
import type {
  AccountDeletionBlocker,
  AccountDeletionBlockerKind,
  BookingSummary,
} from '@clickco/contracts';
import { humanMessage, userMessage } from '@/shared/errors';
import { formatDayMonth } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';

/**
 * Profile → "Delete account" (ADR-0030). The API decides whether the account can go and lists
 * what is erased and kept; this turns its blockers and refusals into plain words with a way
 * forward. Pure, so it is tested.
 */

export interface BlockerView {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  /** The booking that blocks the deletion: the way forward starts there. */
  readonly bookingId: string;
  readonly actionLabel: string;
}

/** With the booking's date: our own short sentence and what to do about it. */
const DATED: Readonly<
  Record<AccountDeletionBlockerKind, (day: string) => { title: string; body: string }>
> = {
  BOOKING_IN_PROGRESS: (day) => ({
    title: `You have a booking on ${day}`,
    body: "You can delete your account after it's done.",
  }),
  PHOTOS_AVAILABLE: (day) => ({
    title: `Your photos from ${day} can still be downloaded`,
    body: 'Save them first. You can delete your account once the booking closes, 30 days after delivery.',
  }),
  PAYMENT_IN_PROGRESS: (day) => ({
    title: `A payment for your booking on ${day} may still be going through`,
    body: 'Cancel that booking, or try again in an hour.',
  }),
  MONEY_BEING_SETTLED: (day) => ({
    title: `Money on your booking on ${day} is still being settled`,
    body: "You can delete your account once it's done. If it's taking long, get help from the Help tab.",
  }),
};

/**
 * One card per blocker. The booking's date comes from the client's own booking list (the
 * blocker names only its reference); without it, the API's own sentence is used as is.
 */
export function blockerView(
  blocker: AccountDeletionBlocker,
  bookings: readonly BookingSummary[] | undefined,
): BlockerView {
  const booking = bookings?.find((b) => b.id === blocker.bookingId);
  const common = {
    key: `${blocker.kind}:${blocker.bookingId}`,
    bookingId: blocker.bookingId,
    actionLabel: 'View booking',
  };
  if (!booking) return { ...common, title: `Booking ${blocker.reference}`, body: blocker.message };
  return { ...common, ...DATED[blocker.kind](formatDayMonth(new Date(booking.scheduledStart))) };
}

/** Unused credit that goes with the account, said before anything is sent. */
export function forfeitLine(forfeitedCreditPaise: number): string | null {
  return forfeitedCreditPaise > 0
    ? `You'll lose ${rupees(forfeitedCreditPaise)} of unused Clickco credit.`
    : null;
}

/**
 * What to do after a refused request or confirm:
 *  - blocked: something now stops the deletion; show the explain screen with its blockers again.
 *  - code: the code was wrong or expired; enter it again or send a new one.
 *  - retry: worth trying again as it is (same key: a lost answer is replayed, never repeated).
 *  - final: retrying in the app cannot help.
 */
export type DeletionNext = 'blocked' | 'code' | 'retry' | 'final';

export interface DeletionFailure {
  readonly message: string;
  readonly next: DeletionNext;
}

const REFUSALS: Readonly<Record<string, DeletionFailure>> = {
  ACCOUNT_DELETION_BLOCKED: {
    message:
      "Something on your account still needs to finish, so it can't be deleted yet. Nothing was deleted.",
    next: 'blocked',
  },
  OTP_INVALID: {
    message: "That code isn't right, or it has expired. Check the SMS, or send a new code.",
    next: 'code',
  },
  ACCOUNT_BLOCKED: {
    message:
      "This account is on hold, so it can't be deleted in the app. Please write to Clickco support.",
    next: 'final',
  },
  SESSION_INVALID: {
    message: 'Your session has ended. Sign in again to delete your account.',
    next: 'final',
  },
  IDEMPOTENCY_REQUEST_IN_PROGRESS: {
    message: "We're still working on your last tap. Give it a moment, then try again.",
    next: 'retry',
  },
};

/** Codes whose API sentence is already written for people (rate limits, SMS trouble). */
const OWN_WORDS = new Set(['RATE_LIMITED', 'SMS_UNAVAILABLE']);

/** A refused or failed request/confirm, in the client's words, with the next step. */
export function deletionFailure(error: unknown): DeletionFailure {
  if (isApiError(error) && error.kind === 'HTTP') {
    const known = REFUSALS[error.code];
    if (known) return known;
    if (OWN_WORDS.has(error.code)) return { message: humanMessage(error), next: 'retry' };
    if (error.isClientError) return { message: userMessage(error), next: 'final' };
  }
  return { message: userMessage(error), next: 'retry' };
}
