import type { QualityOutcome, QualityStatus } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { BookingScope, Db, QualityPageQuery, QualityRecord, Tx } from '../care.types';
import { and, scopeClause } from './care-sql';

interface Row {
  id: string;
  booking_id: string;
  raised_by_kind: 'USER' | 'STAFF' | 'SYSTEM';
  raised_by_id: string | null;
  complaint: string;
  status: QualityStatus;
  assigned_qm_id: string | null;
  resolution: QualityOutcome | null;
  resolution_note: string | null;
  credit_paise: string;
  created_at: Date;
  resolved_at: Date | null;
}

const toRecord = (r: Row): QualityRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  raisedByKind: r.raised_by_kind,
  raisedById: r.raised_by_id,
  complaint: r.complaint,
  status: r.status,
  assignedQmId: r.assigned_qm_id,
  resolution: r.resolution,
  resolutionNote: r.resolution_note,
  remedyPaise: BigInt(r.credit_paise),
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

const COLUMNS = `q.id, q.booking_id, q.raised_by_kind, q.raised_by_id, q.complaint, q.status,
  q.assigned_qm_id, q.resolution, q.resolution_note, q.credit_paise, q.created_at, q.resolved_at`;

const OPEN: readonly QualityStatus[] = ['OPEN', 'IN_REVIEW'];
const DONE: readonly QualityStatus[] = ['RESOLVED', 'REJECTED'];

/**
 * quality_escalations (G-07, the QM queue). `credit_paise` holds the remedy amount the QM decided
 * — a client credit (CREDIT) or a partial refund (PARTIAL_REFUND); `resolution` says which. The
 * money itself moves only when "To settle" (ADR-0026 D2) settles the review item.
 */
@Injectable()
export class QualityEscalationsRepository {
  async insert(
    tx: Tx,
    e: {
      readonly bookingId: string;
      readonly staffId: string;
      readonly complaint: string;
      readonly at: Date;
    },
  ): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO quality_escalations (booking_id, raised_by_kind, raised_by_id, complaint, created_at)
      VALUES (${e.bookingId}, 'STAFF', ${e.staffId}, ${e.complaint}, ${e.at})
      RETURNING id`;
    if (!row) throw new Error('quality_escalations insert returned nothing');
    return row.id;
  }

  async find(db: Db, id: string, bookings: BookingScope): Promise<QualityRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM quality_escalations q
      WHERE q.id = ${id} AND ${scopeClause(db, 'q.booking_id', bookings)}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, id: string, bookings: BookingScope): Promise<QualityRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM quality_escalations q
      WHERE q.id = ${id} AND ${scopeClause(tx, 'q.booking_id', bookings)}
      FOR UPDATE OF q`;
    return row ? toRecord(row) : null;
  }

  /** OPEN: oldest first. RESOLVED: newest decision first. ALL: newest first. */
  async page(db: Db, q: QualityPageQuery): Promise<QualityRecord[]> {
    const open = q.filter === 'OPEN';
    const resolved = q.filter === 'RESOLVED';
    const time = resolved ? db`q.resolved_at` : db`q.created_at`;
    const where = [
      scopeClause(db, 'q.booking_id', q.bookings),
      ...(open ? [db`q.status IN ${db([...OPEN])}`] : []),
      ...(resolved ? [db`q.status IN ${db([...DONE])} AND q.resolved_at IS NOT NULL`] : []),
      ...(q.after
        ? [
            open
              ? db`(${time}, q.id) > (${q.after.at}, ${q.after.id}::uuid)`
              : db`(${time}, q.id) < (${q.after.at}, ${q.after.id}::uuid)`,
          ]
        : []),
    ];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM quality_escalations q
      WHERE ${and(db, where)}
      ORDER BY ${open ? db`${time} ASC, q.id ASC` : db`${time} DESC, q.id DESC`}
      LIMIT ${q.limit}`;
    return rows.map(toRecord);
  }

  async take(tx: Tx, id: string, staffId: string): Promise<void> {
    await tx`
      UPDATE quality_escalations SET status = 'IN_REVIEW', assigned_qm_id = ${staffId}
      WHERE id = ${id}`;
  }

  async resolve(
    tx: Tx,
    id: string,
    r: {
      readonly outcome: QualityOutcome;
      readonly remedyPaise: bigint;
      readonly note: string;
      readonly staffId: string;
      readonly at: Date;
    },
  ): Promise<void> {
    await tx`
      UPDATE quality_escalations
      SET status = 'RESOLVED', resolution = ${r.outcome}, resolution_note = ${r.note},
          credit_paise = ${r.remedyPaise.toString()}::bigint,
          assigned_qm_id = coalesce(assigned_qm_id, ${r.staffId}), resolved_at = ${r.at}
      WHERE id = ${id}`;
  }

  async countOpen(db: Db, bookings: BookingScope): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM quality_escalations q
      WHERE q.status IN ${db([...OPEN])} AND ${scopeClause(db, 'q.booking_id', bookings)}`;
    return row?.n ?? 0;
  }
}
