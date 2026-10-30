import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { IdSubquery } from '../../../infra/db/id-subquery';
import type { Db, ResolutionRecord, Tx } from '../refunds.types';
import type { ReviewOutcome } from '../review-suggestions';

interface Row {
  id: string;
  review_event_id: string;
  review_type: string;
  reason: string;
  booking_id: string | null;
  outcome: ReviewOutcome;
  amount_paise: string | null;
  credit_id: string | null;
  breach_id: string | null;
  note: string;
  resolved_by: string;
  resolved_at: Date;
}

const toRecord = (r: Row): ResolutionRecord => ({
  id: r.id,
  reviewEventId: r.review_event_id,
  reviewType: r.review_type,
  reason: r.reason,
  bookingId: r.booking_id,
  outcome: r.outcome,
  amountPaise: r.amount_paise === null ? null : BigInt(r.amount_paise),
  creditId: r.credit_id,
  breachId: r.breach_id,
  note: r.note,
  resolvedBy: r.resolved_by,
  resolvedAt: r.resolved_at,
});

export type NewResolution = Omit<ResolutionRecord, 'id'>;

/** review_resolutions (addendum 0006): append-only, one row per review event. */
@Injectable()
export class ResolutionsRepository {
  /** null when the review was already settled (the unique index decides a race). */
  async insert(tx: Tx, r: NewResolution): Promise<ResolutionRecord | null> {
    const [row] = await tx<Row[]>`
      INSERT INTO review_resolutions (review_event_id, review_type, reason, booking_id, outcome,
                                      amount_paise, credit_id, breach_id, note, resolved_by,
                                      resolved_at)
      VALUES (${r.reviewEventId}, ${r.reviewType}, ${r.reason}, ${r.bookingId}, ${r.outcome},
              ${r.amountPaise === null ? null : r.amountPaise.toString()}, ${r.creditId},
              ${r.breachId}, ${r.note}, ${r.resolvedBy}, ${r.resolvedAt})
      ON CONFLICT (review_event_id) DO NOTHING
      RETURNING *`;
    return row ? toRecord(row) : null;
  }

  async find(db: Db, id: string): Promise<ResolutionRecord | null> {
    const [row] = await db<Row[]>`SELECT * FROM review_resolutions WHERE id = ${id}`;
    return row ? toRecord(row) : null;
  }

  async byEventIds(db: Db, eventIds: readonly string[]): Promise<ResolutionRecord[]> {
    if (eventIds.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT * FROM review_resolutions WHERE review_event_id IN ${db([...new Set(eventIds)])}`;
    return rows.map(toRecord);
  }

  /** Settled review event ids, for the ops reader's OPEN / SETTLED filter. */
  settledEventIds(sql: postgres.Sql): IdSubquery {
    return sql`SELECT review_event_id FROM review_resolutions`;
  }
}
