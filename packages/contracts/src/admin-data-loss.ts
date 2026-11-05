import { z } from 'zod';
import { CreditCoApprover } from './admin-money.js';
import { StepUpCode } from './admin-pricing.js';
import { Uuid } from './common.js';
import { BookingStatus, type StaffRole } from './enums.js';
import { MoneyPaise } from './money.js';

/**
 * ADR-0030 D2 — staff confirm that a booking's shoot files were lost before delivery (DOMAIN §2:
 * UPLOADING / PROCESSING / QA, STAFF confirms). Both confirmations are four-eyes in one request:
 * the confirmer's fresh authenticator code plus a second person's sign-in email and code.
 * - Complete loss: the booking ends in DATA_LOSS and everything the client paid goes back by rule
 *   (T&C §5.5, no separate refund approval); the photographer is paid in full (v0.2 G-13; the
 *   third loss in 365 days is held, ADR-0027 D5a).
 * - Partial loss: the booking stays on the delivery path; the affected share of the booking goes
 *   back by rule, as much as is refundable now, and the rest becomes a review item settled after
 *   the balance is paid.
 */

/** Who confirms a loss (SUPER_ADMIN too, as everywhere): the Quality Manager or the city manager. */
export const DATA_LOSS_CONFIRM_ROLES: readonly StaffRole[] = ['QUALITY_MANAGER', 'CITY_MANAGER'];

/** Who may be the second person on a loss: never the confirmer. */
export const DATA_LOSS_CO_APPROVER_ROLES: readonly StaffRole[] = [
  'QUALITY_MANAGER',
  'FINANCE',
  'SUPER_ADMIN',
];

/** The stages a loss can be confirmed from: files were taken but not yet delivered. */
export const DATA_LOSS_FROM_STATUSES: readonly BookingStatus[] = ['UPLOADING', 'PROCESSING', 'QA'];

export const DATA_LOSS_NOTE_MIN = 10;
export const DATA_LOSS_NOTE_MAX = 1_000;

const Note = z
  .string()
  .trim()
  .min(DATA_LOSS_NOTE_MIN, 'Say what was lost and how you checked (10 or more characters)')
  .max(DATA_LOSS_NOTE_MAX);

/** The four-eyes part of both bodies (the large-credit pattern, ADR-0027 D6a L8). */
const FourEyes = {
  /** The confirmer's fresh authenticator code. */
  code: StepUpCode,
  /** A second QM, finance person or super admin covering the city, with their own code. */
  coApprover: CreditCoApprover,
};

/** POST /admin/bookings/:bookingId/data-loss — needs an Idempotency-Key. */
export const AdminConfirmDataLossBody = z.object({ note: Note, ...FourEyes });
export type AdminConfirmDataLossBody = z.infer<typeof AdminConfirmDataLossBody>;

export const AdminDataLossResponse = z.object({
  bookingId: Uuid,
  status: z.literal('DATA_LOSS'),
  /** Everything paid and not already back or on its way, sent back by rule. */
  refundPaise: MoneyPaise,
  refundIds: z.array(Uuid),
  /** Refunds still waiting for approval, or failed, that this full refund replaced. */
  supersededRefundIds: z.array(Uuid),
});
export type AdminDataLossResponse = z.infer<typeof AdminDataLossResponse>;

/** Basis points of the shoot that was lost: more than none, less than all (all is data-loss). */
export const AffectedProportionBps = z.int().min(1).max(9_999);

/** POST /admin/bookings/:bookingId/partial-loss — needs an Idempotency-Key. Once per booking. */
export const AdminConfirmPartialLossBody = z.object({
  affectedProportionBps: AffectedProportionBps,
  note: Note,
  ...FourEyes,
});
export type AdminConfirmPartialLossBody = z.infer<typeof AdminConfirmPartialLossBody>;

export const AdminPartialLossResponse = z.object({
  bookingId: Uuid,
  /** Unchanged: the rest of the shoot is still delivered. */
  status: BookingStatus,
  affectedProportionBps: AffectedProportionBps,
  /** The affected share of the booking total (every snapshot), rounded once, half up. */
  owedPaise: MoneyPaise,
  /** Sent back now, by rule: as much of the share as is refundable today. */
  refundPaise: MoneyPaise,
  /** The rest of the share: a review item, refunded once the balance is paid. */
  dueAfterBalancePaise: MoneyPaise,
  refundIds: z.array(Uuid),
});
export type AdminPartialLossResponse = z.infer<typeof AdminPartialLossResponse>;
