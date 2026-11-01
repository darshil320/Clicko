import type postgres from 'postgres';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

export type ReviewDirection = 'CLIENT_TO_PRO' | 'PRO_TO_CLIENT';

/** A `reviews` row (schema §12 + addendum 0016). */
export interface ReviewRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly direction: ReviewDirection;
  /** Who a CLIENT_TO_PRO review is about: the photographer of the booking's shoot. */
  readonly photographerId: string | null;
  readonly rating: number;
  /** As published (links, emails and phone numbers already removed). */
  readonly comment: string | null;
  readonly isPublished: boolean;
  readonly moderatedBy: string | null;
  readonly moderationNote: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A photographer's published rating: the average × 1000 (4.87 → 4870) and how many. */
export interface RatingSummary {
  readonly avgBps: number | null;
  readonly count: number;
}

/** What the moderation desk records on a review it decided. */
export interface ReviewModeration {
  readonly reviewId: string;
  readonly staffId: string;
  readonly note: string;
  readonly now: Date;
}
