import type postgres from 'postgres';

/**
 * What the payouts module reads from modules it does not own (ADR-0026 D3, stream B). Each is a
 * small interface so the owning module can provide it; until then an interim adapter in
 * ./adapters fills it (each says which owner it is waiting for).
 */

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

// ── Photographers (owner: modules/photographers, stream C) ──────────────────

export interface PayeeBank {
  readonly accountId: string;
  readonly holder: string;
  readonly bankName: string | null;
  readonly ifsc: string;
  readonly last4: string;
  /** Ops confirmed it against the bank proof (photographer_bank_accounts.verified_at). */
  readonly verified: boolean;
}

export interface PayeeFacts {
  readonly photographerId: string;
  readonly name: string;
  readonly cityId: string;
  readonly pan: string | null;
  readonly panVerified: boolean;
  readonly gstRegistered: boolean;
  /** The primary account, or null when none is on file. */
  readonly bank: PayeeBank | null;
}

export interface SealedAccountNumber {
  readonly accountId: string;
  readonly photographerId: string;
  /** account_number_enc — opened by BankAccountCipher only while writing the bank file. */
  readonly sealed: Buffer;
}

export interface PayeeDirectoryPort {
  payees(photographerIds: readonly string[]): Promise<Map<string, PayeeFacts>>;
  sealedAccountNumbers(accountIds: readonly string[]): Promise<Map<string, SealedAccountNumber>>;
}
export const PAYEE_DIRECTORY = Symbol('PAYEE_DIRECTORY');

export interface PenaltyFact {
  readonly penaltyId: string;
  readonly photographerId: string;
  readonly bookingId: string;
  readonly kind: string;
  readonly payoutDeductionBps: number;
}

export interface PenaltyDeductionsPort {
  /** Un-waived penalties with a payout deduction (> 0 bps) tied to a booking. */
  unwaived(photographerIds: readonly string[]): Promise<PenaltyFact[]>;
}
export const PENALTY_DEDUCTIONS = Symbol('PENALTY_DEDUCTIONS');

// ── SLA breaches (owner: modules/sla; remedies applied by stream A) ─────────

/**
 * ADR-0026 D2: applying a breach remedy records the payout deduction (`applied_at`). Payouts
 * deduct a breach only when it was put down to the PHOTOGRAPHER, applied and not waived — stream
 * A's `SlaDeskService.appliedDeductions`. One still owed shows as "under review" on the Due tab.
 */
export interface AppliedBreachDeduction {
  readonly breachId: string;
  readonly bookingId: string;
  readonly payoutDeductionBps: number;
  readonly appliedAt: Date;
}

export interface BreachDeductionsPort {
  applied(bookingIds: readonly string[]): Promise<AppliedBreachDeduction[]>;
  /** Bookings with a photographer-attributed breach neither applied nor waived yet. */
  underReview(bookingIds: readonly string[]): Promise<Set<string>>;
}
export const BREACH_DEDUCTIONS = Symbol('BREACH_DEDUCTIONS');
