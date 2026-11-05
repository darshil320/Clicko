/**
 * ADR-0030 — when a client may delete their account, and what the screen says, as pure rules.
 * No I/O: AccountDeletionService feeds them the client's bookings and unsettled refunds.
 */
import type {
  AccountDeletionBlocker,
  AccountDeletionBlockerKind,
  BookingStatus,
} from '@clickco/contracts';

/** Paid (or being paid) and not finished: the shoot, the files or the balance are still ahead. */
const IN_PROGRESS: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'CONFIRMED',
  'DISPATCHING',
  'ASSIGNED',
  'EN_ROUTE',
  'CHECKED_IN',
  'IN_PROGRESS',
  'CHECKED_OUT',
  'UPLOADING',
  'PROCESSING',
  'QA',
  'BALANCE_PENDING',
  'UNSAFE_SITE',
]);

/** Delivered and not closed: the links still work and a quality issue can still be raised. */
const PHOTOS_AVAILABLE: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'DELIVERED',
  'QUALITY_ESCALATION',
]);

/**
 * The statuses that stop a deletion (everything that is neither ended nor an unpaid draft or
 * quote). The bookings module locks these; DRAFT and QUOTED are cancelled by the deletion.
 */
export const DELETION_BLOCKING_STATUSES: readonly BookingStatus[] = [
  'ADVANCE_PENDING',
  ...IN_PROGRESS,
  ...PHOTOS_AVAILABLE,
];

export function blockerKindFor(status: BookingStatus): AccountDeletionBlockerKind | null {
  if (status === 'ADVANCE_PENDING') return 'PAYMENT_IN_PROGRESS';
  if (IN_PROGRESS.has(status)) return 'BOOKING_IN_PROGRESS';
  if (PHOTOS_AVAILABLE.has(status)) return 'PHOTOS_AVAILABLE';
  return null;
}

const MESSAGES: Readonly<Record<AccountDeletionBlockerKind, (reference: string) => string>> = {
  BOOKING_IN_PROGRESS: (ref) =>
    `${ref} is paid and not finished yet. You can delete your account once it is, or contact support.`,
  PHOTOS_AVAILABLE: (ref) =>
    `Your photos from ${ref} can still be downloaded. Save them first: you can delete your account once the booking closes, 30 days after delivery.`,
  PAYMENT_IN_PROGRESS: (ref) =>
    `A payment for ${ref} may still be going through. Cancel the booking, or try again in an hour.`,
  MONEY_BEING_SETTLED: (ref) =>
    `Money on ${ref} is still being settled with you. Try again once it is done, or contact support.`,
};

export interface ClientBooking {
  readonly bookingId: string;
  readonly reference: string;
  readonly status: BookingStatus;
}

/**
 * One blocker per open booking, then one per booking of the client's with a refund that is not
 * finished (requested, approved, at the gateway or failed): money still owed either way.
 */
export function blockersFor(
  bookings: readonly ClientBooking[],
  unsettledRefundBookingIds: readonly string[],
): AccountDeletionBlocker[] {
  const blocker = (b: ClientBooking, kind: AccountDeletionBlockerKind): AccountDeletionBlocker => ({
    kind,
    bookingId: b.bookingId,
    reference: b.reference,
    message: MESSAGES[kind](b.reference),
  });
  const open = bookings.flatMap((b) => {
    const kind = blockerKindFor(b.status);
    return kind ? [blocker(b, kind)] : [];
  });
  const blocked = new Set(open.map((b) => b.bookingId));
  const unsettled = new Set(unsettledRefundBookingIds);
  const money = bookings
    .filter((b) => unsettled.has(b.bookingId) && !blocked.has(b.bookingId))
    .map((b) => blocker(b, 'MONEY_BEING_SETTLED'));
  return [...open, ...money];
}

/** What deleting erases, as the app shows it. */
export const DELETION_ERASES: readonly string[] = [
  'Your name, phone number and email.',
  'The venue addresses, landmarks and notes on your bookings, and the names and numbers of anyone you booked for.',
  'Your notification settings and the devices registered for notifications.',
  'The photographers you blocked, and waitlist sign-ups made with your number.',
  'The words of your reviews, and the notes on reports you made or that quoted your reviews. The star ratings stay, with no name attached.',
  'The UPI id on your payments, except its bank handle, and the answers we stored for your recent requests.',
  'Bookings you started but did not pay for are cancelled.',
  'You are signed out on every device. Signing up again with the same number starts a new, empty account.',
];

/** What is kept, and why. */
export const DELETION_KEEPS: readonly string[] = [
  'Tax invoices, payments, refunds and credit notes, for 8 years, as GST law requires (CGST Act s.36).',
  'Our accounts of those payments, and the booking dates, city, pincode and prices, with no name or contact attached.',
  'Support tickets you raised, with the contact details and messages in them, and your quality complaints and equipment claims, as grievance records.',
  'The record of what our staff did on your bookings.',
];

export interface CreditFacts {
  readonly amountPaise: bigint;
  readonly consumedPaise: bigint;
  readonly expiresAt: Date;
}

/** Unused credit that has not expired: lost with the account. */
export function forfeitedCredit(credits: readonly CreditFacts[], now: Date): bigint {
  return credits
    .filter((c) => c.expiresAt.getTime() > now.getTime())
    .reduce((sum, c) => {
      const left = c.amountPaise - c.consumedPaise;
      return sum + (left > 0n ? left : 0n);
    }, 0n);
}
