import { z } from 'zod';
import { CreditReason } from './admin-money.js';
import { IsoDateTime, Uuid } from './common.js';
import { MoneyPaise } from './money.js';

/**
 * ADR-0027 D5 — the refunds and credits on a client's own booking: GET /bookings/:id/money.
 * Money is integer paise (ADR-0007). Staff notes, names and payment details never appear here.
 */

/**
 * A refund once staff approved it: PROCESSING while it travels back (a gateway retry stays
 * PROCESSING), REFUNDED when the gateway confirmed it. Requests still waiting for a second
 * person's approval, and rejected ones, are staff-internal and not shown.
 */
export const ClientRefundStatus = z.enum(['PROCESSING', 'REFUNDED']);
export type ClientRefundStatus = z.infer<typeof ClientRefundStatus>;

export const ClientBookingRefund = z.object({
  id: Uuid,
  amountPaise: MoneyPaise,
  status: ClientRefundStatus,
  /** When it was approved and sent to the original payment method. */
  initiatedAt: IsoDateTime,
  /** When the gateway confirmed it; null while PROCESSING. */
  completedAt: IsoDateTime.nullable(),
});
export type ClientBookingRefund = z.infer<typeof ClientBookingRefund>;

/** A service credit issued from this booking, usable on a later booking until it expires. */
export const ClientBookingCredit = z.object({
  id: Uuid,
  amountPaise: MoneyPaise,
  /** What is left to use (the amount minus what checkouts already used). */
  remainingPaise: MoneyPaise,
  reason: CreditReason,
  issuedAt: IsoDateTime,
  /** Valid 12 months, to the end of that IST day (ADR-0026 D2). */
  expiresAt: IsoDateTime,
  expired: z.boolean(),
});
export type ClientBookingCredit = z.infer<typeof ClientBookingCredit>;

/** GET /bookings/:id/money — the caller's own booking only (someone else's is 404). */
export const ClientBookingMoney = z.object({
  bookingId: Uuid,
  /** Oldest first. */
  refunds: z.array(ClientBookingRefund),
  /** Oldest first. */
  credits: z.array(ClientBookingCredit),
});
export type ClientBookingMoney = z.infer<typeof ClientBookingMoney>;
