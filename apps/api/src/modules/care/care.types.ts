import type {
  AdminClaimFilter,
  AdminQualityFilter,
  AdminTicketView,
  ClaimCause,
  ClaimStatus,
  QualityOutcome,
  QualityStatus,
  TicketAuthor,
  TicketCategory,
  TicketRaisedBy,
  TicketStatus,
} from '@clickco/contracts';
import type postgres from 'postgres';
import type { IdSubquery } from '../../infra/db/id-subquery';
import type { StoredEvidence } from './care-rules';

/** Customer-care records (ADR-0026 D6). Money is bigint paise; times are instants. */

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

/** Rows on these bookings only; null = no city limit. */
export type BookingScope = IdSubquery | null;

/** A ticket is in scope by its booking or its photographer; null = no city limit. */
export type TicketScope = {
  readonly bookings: IdSubquery;
  readonly photographers: IdSubquery;
} | null;

/** (time, uuid) keyset position. */
export interface TimeKey {
  readonly at: Date;
  readonly id: string;
}

export interface QualityRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly raisedByKind: 'USER' | 'STAFF' | 'SYSTEM';
  readonly raisedById: string | null;
  readonly complaint: string;
  readonly status: QualityStatus;
  readonly assignedQmId: string | null;
  readonly resolution: QualityOutcome | null;
  readonly resolutionNote: string | null;
  /** The credit or partial refund the QM decided (resolution says which); 0 otherwise. */
  readonly remedyPaise: bigint;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}

export interface QualityPageQuery {
  readonly filter: AdminQualityFilter;
  readonly bookings: BookingScope;
  readonly after?: TimeKey;
  readonly limit: number;
}

export interface TicketRecord {
  readonly id: string;
  readonly reference: string;
  readonly raisedByKind: TicketRaisedBy;
  readonly userId: string | null;
  readonly photographerId: string | null;
  readonly contactName: string;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly bookingId: string | null;
  readonly category: TicketCategory;
  readonly isGrievance: boolean;
  readonly subject: string;
  readonly status: TicketStatus;
  readonly assignedTo: string | null;
  readonly receivedAt: Date;
  readonly ackDueAt: Date;
  readonly acknowledgedAt: Date | null;
  readonly resolveDueAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolutionSummary: string | null;
  readonly lastMessageAt: Date | null;
  readonly messageCount: number;
}

export interface TicketMessageRecord {
  readonly id: string;
  readonly ticketId: string;
  readonly authorKind: TicketAuthor;
  readonly authorId: string | null;
  readonly body: string;
  readonly isInternal: boolean;
  readonly createdAt: Date;
}

export interface NewTicket {
  readonly raisedByKind: TicketRaisedBy;
  readonly photographerId: string | null;
  readonly contactName: string;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly bookingId: string | null;
  readonly category: TicketCategory;
  readonly isGrievance: boolean;
  readonly subject: string;
  readonly receivedAt: Date;
  readonly ackDueAt: Date;
  readonly resolveDueAt: Date;
}

export interface TicketPageQuery {
  readonly view: AdminTicketView;
  readonly staffId: string;
  readonly now: Date;
  readonly scope: TicketScope;
  readonly after?: TimeKey;
  readonly limit: number;
}

export interface ClaimRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly photographerId: string;
  readonly reportedAt: Date;
  readonly incidentAt: Date;
  readonly cause: ClaimCause;
  readonly description: string;
  readonly evidence: readonly StoredEvidence[];
  readonly claimedAmountPaise: bigint;
  readonly capPaise: bigint;
  readonly approvedAmountPaise: bigint | null;
  readonly status: ClaimStatus;
  readonly reviewedBy: string | null;
  readonly resolutionNote: string | null;
  readonly resolvedAt: Date | null;
}

export interface NewClaim {
  readonly bookingId: string;
  readonly photographerId: string;
  readonly reportedAt: Date;
  readonly incidentAt: Date;
  readonly cause: ClaimCause;
  readonly description: string;
  readonly evidence: readonly StoredEvidence[];
  readonly claimedAmountPaise: bigint;
}

export interface ClaimPageQuery {
  readonly filter: AdminClaimFilter;
  readonly bookings: BookingScope;
  readonly after?: TimeKey;
  readonly limit: number;
}
