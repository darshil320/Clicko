import { z } from 'zod';

/**
 * Money on the wire. See docs/DECISIONS/0007-money-at-the-api-boundary.md.
 * Integer paise always: ₹8,500.00 is 850000. Arithmetic happens in bigint
 * (@clickco/utils); these schemas guard the boundary.
 */

/** ₹100 crore. No single amount in Clickco comes near this; 2^53 is ~90,000× higher. */
export const MAX_MONEY_PAISE = 100_000_000_000;

/** A single non-negative amount in integer paise. */
export const MoneyPaise = z.int().min(0).max(MAX_MONEY_PAISE);
export type MoneyPaise = z.infer<typeof MoneyPaise>;

/** A signed amount (ledger delta, discount line) in integer paise. */
export const SignedMoneyPaise = z.int().min(-MAX_MONEY_PAISE).max(MAX_MONEY_PAISE);
export type SignedMoneyPaise = z.infer<typeof SignedMoneyPaise>;

/** An aggregate (ledger sum, payout batch total) as a decimal integer string → bigint. */
export const MoneyPaiseString = z
  .string()
  .regex(/^-?\d+$/, 'must be an integer number of paise')
  .transform((value) => BigInt(value));
export type MoneyPaiseString = z.input<typeof MoneyPaiseString>;

/** Percentages and multipliers as integer basis points: 18% = 1800, 1.15× = 11500. */
export const BasisPoints = z.int().min(0).max(1_000_000);
export type BasisPoints = z.infer<typeof BasisPoints>;

/** Booked duration: minimum 2 hours, 30-minute increments (schema booking_hours_*). */
export const Hours = z
  .number()
  .min(2)
  .max(24)
  .refine((h) => Number.isInteger(h * 2), 'hours must be a multiple of 0.5');
export type Hours = z.infer<typeof Hours>;
