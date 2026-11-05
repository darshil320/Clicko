import { z } from 'zod';
import { BookingSummary } from './booking-flow.js';
import { IsoDateTime, Uuid } from './common.js';
import { MoneyPaise } from './money.js';

/**
 * A client cancelling their own booking (DOMAIN §2: any pre-shoot state → CANCELLED_CLIENT) and
 * what comes back under the T&C §3 ladder. Money is integer paise (ADR-0007).
 */

/**
 * Which rung of the ladder applies:
 *  - BEFORE_PAYMENT: nothing was captured (QUOTED, ADVANCE_PENDING).
 *  - §3.1 standard bookings, by the notice given: MORE_THAN_7_DAYS and DAYS_3_TO_7 (100 % of the
 *    advance), HOURS_24_TO_72 (50 %), UNDER_24_HOURS (nothing).
 *  - §3.2 PEAK_SEASON_UNDER_7_DAYS: a peak-season shoot cancelled inside 7 days keeps 50 %.
 *  - §3.3 emergency and same-day bookings: free before a photographer accepts, nothing after.
 */
export const CancellationBand = z.enum([
  'BEFORE_PAYMENT',
  'MORE_THAN_7_DAYS',
  'DAYS_3_TO_7',
  'HOURS_24_TO_72',
  'UNDER_24_HOURS',
  'PEAK_SEASON_UNDER_7_DAYS',
  'EMERGENCY_BEFORE_ACCEPTANCE',
  'EMERGENCY_AFTER_ACCEPTANCE',
]);
export type CancellationBand = z.infer<typeof CancellationBand>;

/** The T&C clause a band comes from (null before payment: nothing to apply). */
export const CancellationClause = z.enum(['3.1', '3.2', '3.3']);
export type CancellationClause = z.infer<typeof CancellationClause>;

/**
 * Why the booking cannot be cancelled in the app now:
 *  - ALREADY_CANCELLED: it already ended in a cancellation.
 *  - SHOOT_STARTED: the photographer checked in (or later): no client cancellation exists then.
 *  - SHOOT_TIME_PASSED: the start time has passed; a late photographer is handled by the no-show
 *    process (T&C §3.6), which a cancellation would forfeit.
 *  - PAYMENT_SETTLING: a photographer just accepted and the held payment is being captured.
 *  - NOT_CANCELLABLE: any other state.
 */
export const CancellationBlock = z.enum([
  'ALREADY_CANCELLED',
  'SHOOT_STARTED',
  'SHOOT_TIME_PASSED',
  'PAYMENT_SETTLING',
  'NOT_CANCELLABLE',
]);
export type CancellationBlock = z.infer<typeof CancellationBlock>;

/**
 * GET /bookings/:id/cancellation — what cancelling now would return, so the app can confirm in
 * plain words. Re-checked under the booking lock by the POST: send its `refundPaise` back.
 */
export const CancellationQuote = z.object({
  bookingId: Uuid,
  cancellable: z.boolean(),
  /** null when cancellable. */
  blockedBy: CancellationBlock.nullable(),
  /** null when not cancellable. */
  band: CancellationBand.nullable(),
  clause: CancellationClause.nullable(),
  /** The band (or the block) in plain words, without amounts. */
  reason: z.string(),
  /** The shoot day is in Peak Season (T&C §3.2), on the booking's own price list. */
  peakSeason: z.boolean(),
  /** Captured on the booking and not refunded (or on its way back) yet. */
  paidPaise: MoneyPaise,
  /** Goes back to the original payment method (T&C §3.9: 7–10 business days). */
  refundPaise: MoneyPaise,
  /** Kept under the ladder. paidPaise = refundPaise + keptPaise. */
  keptPaise: MoneyPaise,
  /** An authorisation (sub-3-hour emergency) that was never charged: released in full. */
  heldPaise: MoneyPaise,
  /** The share of the advance the ladder returns (10000 = all of it). */
  refundBps: z.int().min(0).max(10_000),
  /** When the refund for cancelling would next get smaller; null when it cannot. */
  changesAt: IsoDateTime.nullable(),
  quotedAt: IsoDateTime,
});
export type CancellationQuote = z.infer<typeof CancellationQuote>;

/**
 * POST /bookings/:id/cancel (Idempotency-Key required). Once anything was paid, the refund the
 * client confirmed from the quote is required: a different figure under the lock is a 409
 * CANCELLATION_TERMS_CHANGED, never a silent change of terms.
 */
export const CancelBookingBody = z.object({ expectedRefundPaise: MoneyPaise.optional() });
export type CancelBookingBody = z.infer<typeof CancelBookingBody>;

/** What the cancellation did. */
export const CancellationOutcome = z.object({
  band: CancellationBand,
  clause: CancellationClause.nullable(),
  refundPaise: MoneyPaise,
  keptPaise: MoneyPaise,
  heldPaise: MoneyPaise,
  refundBps: z.int().min(0).max(10_000),
  peakSeason: z.boolean(),
  /** One per payment the refund goes back to; empty when nothing comes back. */
  refundIds: z.array(Uuid),
  cancelledAt: IsoDateTime,
});
export type CancellationOutcome = z.infer<typeof CancellationOutcome>;

/** The booking as it now stands (CANCELLED_CLIENT) plus what the cancellation did. */
export const CancelBookingResponse = BookingSummary.extend({ cancellation: CancellationOutcome });
export type CancelBookingResponse = z.infer<typeof CancelBookingResponse>;
