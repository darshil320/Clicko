import type { RefundStatus, StaffRole } from '@clickco/contracts';
import type postgres from 'postgres';
import type { CreditReasonCode, RefundReasonCode } from './refunds.config';
import type { ReviewOutcome } from './review-suggestions';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

export interface RefundRecord {
  readonly id: string;
  readonly paymentId: string;
  readonly bookingId: string;
  readonly status: RefundStatus;
  readonly amountPaise: bigint;
  readonly reasonCode: RefundReasonCode;
  readonly reasonNote: string | null;
  readonly requestedByKind: 'USER' | 'STAFF' | 'SYSTEM';
  readonly requestedById: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: Date | null;
  readonly decisionNote: string | null;
  readonly providerRefundId: string | null;
  readonly processingAt: Date | null;
  readonly attempts: number;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
  readonly failureReason: string | null;
  readonly reviewResolutionId: string | null;
  readonly createdAt: Date;
}

export interface CreditRecord {
  readonly id: string;
  readonly userId: string;
  readonly amountPaise: bigint;
  readonly consumedPaise: bigint;
  readonly reasonCode: CreditReasonCode;
  readonly reasonNote: string | null;
  readonly sourceBookingId: string | null;
  readonly issuedBy: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface ResolutionRecord {
  readonly id: string;
  readonly reviewEventId: string;
  readonly reviewType: string;
  readonly reason: string;
  readonly bookingId: string | null;
  readonly outcome: ReviewOutcome;
  readonly amountPaise: bigint | null;
  readonly creditId: string | null;
  readonly breachId: string | null;
  readonly note: string;
  readonly resolvedBy: string;
  readonly resolvedAt: Date;
}

/** The staff member acting, with the roles that cover the booking's city (ADR-0025 D3). */
export interface MoneyActor {
  readonly staffId: string;
  readonly roles: readonly StaffRole[];
}
