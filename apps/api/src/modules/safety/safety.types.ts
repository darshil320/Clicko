import type {
  ModerationDecision,
  ReporterKind,
  ReportReason,
  ReportStatus,
  ReportTargetKind,
} from '@clickco/contracts';
import type postgres from 'postgres';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

/** The cities a staff caller works in for the moderation desk ('ALL' = every city). */
export type ReportScope = 'ALL' | readonly string[];

export interface Reporter {
  readonly kind: ReporterKind;
  readonly id: string;
}

/** A `moderation_reports` row (addendum 0016). */
export interface ReportRecord {
  readonly id: string;
  readonly reporterKind: ReporterKind;
  readonly reporterId: string;
  readonly targetKind: ReportTargetKind;
  readonly targetId: string;
  readonly bookingId: string | null;
  readonly cityId: string;
  readonly reason: ReportReason;
  readonly note: string | null;
  /** REVIEW only: the review as it stood when this report was filed. */
  readonly reportedRating: number | null;
  readonly reportedComment: string | null;
  readonly status: ReportStatus;
  readonly decision: ModerationDecision | null;
  readonly decisionNote: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}

export type ReportView = 'OPEN' | 'DECIDED' | 'ALL';

export interface ReportPageQuery {
  readonly view: ReportView;
  readonly scope: ReportScope;
  /** Keyset: the last row's sort time (created_at for OPEN, decided_at otherwise) and id. */
  readonly after?: { readonly at: Date; readonly id: string };
  readonly limit: number;
}

/** A `moderation_actions` row (append-only). */
export interface ModerationActionRecord {
  readonly reportId: string;
  readonly decision: ModerationDecision;
  readonly targetKind: ReportTargetKind;
  readonly targetId: string;
  readonly warnedKind: ReporterKind | null;
  readonly warnedId: string | null;
  readonly staffId: string;
  readonly cityId: string;
  readonly note: string;
  readonly reportsClosed: number;
  readonly createdAt: Date;
}

/** A `client_photographer_blocks` row. */
export interface BlockRecord {
  readonly userId: string;
  readonly photographerId: string;
  readonly createdAt: Date;
}
