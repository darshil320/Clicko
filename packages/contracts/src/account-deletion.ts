import { z } from 'zod';
import { OtpCode } from './auth.js';
import { IsoDateTime, Uuid } from './common.js';
import { MoneyPaise } from './money.js';

/**
 * ADR-0030 — a client deletes their own account (Apple 5.1.1(v), DPDP Act 2023 s.12). The app's
 * Profile → "Delete account" screen reads the preview, sends a code to the account's phone, and
 * confirms with that code. The account is anonymised, not removed: tax invoices, payments and
 * ledger entries keep pointing at it for the statutory period.
 */

/** Why the account cannot be deleted right now (each names one of the client's bookings). */
export const AccountDeletionBlockerKind = z.enum([
  /** Paid and not finished: the shoot, upload, QA or balance is still ahead. */
  'BOOKING_IN_PROGRESS',
  /** Delivered and not yet closed: the photos can still be downloaded. */
  'PHOTOS_AVAILABLE',
  /** Waiting for payment: a payment may still be going through. */
  'PAYMENT_IN_PROGRESS',
  /** A refund on the booking is not finished. */
  'MONEY_BEING_SETTLED',
]);
export type AccountDeletionBlockerKind = z.infer<typeof AccountDeletionBlockerKind>;

export const AccountDeletionBlocker = z.object({
  kind: AccountDeletionBlockerKind,
  bookingId: Uuid,
  /** CLK-…, as the app shows it. */
  reference: z.string(),
  /** One plain sentence for the screen. */
  message: z.string(),
});
export type AccountDeletionBlocker = z.infer<typeof AccountDeletionBlocker>;

/** GET /me/deletion — what deleting does, and whether it can happen now. No side effects. */
export const AccountDeletionPreview = z.object({
  canDelete: z.boolean(),
  blockers: z.array(AccountDeletionBlocker),
  /** What is erased, one plain line each. */
  erases: z.array(z.string()),
  /** What is kept and why, one plain line each. */
  keeps: z.array(z.string()),
  /** Unused, unexpired credit that is lost with the account. */
  forfeitedCreditPaise: MoneyPaise,
});
export type AccountDeletionPreview = z.infer<typeof AccountDeletionPreview>;

/** POST /me/deletion/request — a code was sent to the account's own phone. */
export const AccountDeletionChallenge = z.object({
  challengeId: Uuid,
  expiresAt: IsoDateTime,
  resendAfterSeconds: z.int().min(0),
});
export type AccountDeletionChallenge = z.infer<typeof AccountDeletionChallenge>;

/** POST /me/deletion/confirm — needs an Idempotency-Key. */
export const ConfirmAccountDeletionBody = z.object({
  challengeId: Uuid,
  code: OtpCode,
});
export type ConfirmAccountDeletionBody = z.infer<typeof ConfirmAccountDeletionBody>;

/** The account is deleted; the app clears its session. A repeat answers the same. */
export const AccountDeletionResult = z.object({
  deleted: z.literal(true),
  deletedAt: IsoDateTime,
});
export type AccountDeletionResult = z.infer<typeof AccountDeletionResult>;
