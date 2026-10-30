import type { ClaimCause, ClaimStatus } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { BookingScope, ClaimPageQuery, ClaimRecord, Db, NewClaim, Tx } from '../care.types';
import type { StoredEvidence } from '../care-rules';
import { and, scopeClause } from './care-sql';

interface Row {
  id: string;
  booking_id: string;
  photographer_id: string;
  reported_at: Date;
  incident_at: Date;
  cause: ClaimCause;
  description: string;
  evidence: StoredEvidence[];
  claimed_amount_paise: string;
  cap_paise: string;
  approved_amount_paise: string | null;
  status: ClaimStatus;
  reviewed_by: string | null;
  resolution_note: string | null;
  resolved_at: Date | null;
}

const toRecord = (r: Row): ClaimRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  photographerId: r.photographer_id,
  reportedAt: r.reported_at,
  incidentAt: r.incident_at,
  cause: r.cause,
  description: r.description,
  evidence: Array.isArray(r.evidence) ? r.evidence : [],
  claimedAmountPaise: BigInt(r.claimed_amount_paise),
  capPaise: BigInt(r.cap_paise),
  approvedAmountPaise: r.approved_amount_paise === null ? null : BigInt(r.approved_amount_paise),
  status: r.status,
  reviewedBy: r.reviewed_by,
  resolutionNote: r.resolution_note,
  resolvedAt: r.resolved_at,
});

const COLUMNS = `c.id, c.booking_id, c.photographer_id, c.reported_at, c.incident_at, c.cause,
  c.description, c.evidence, c.claimed_amount_paise, c.cap_paise, c.approved_amount_paise,
  c.status, c.reviewed_by, c.resolution_note, c.resolved_at`;

const PENDING: readonly ClaimStatus[] = ['OPEN', 'UNDER_REVIEW'];

const json = (tx: Db, value: readonly StoredEvidence[]) =>
  tx.json(value as unknown as postgres.JSONValue);

/**
 * equipment_claims (SA-01, T&C §8.2). The evidence column is the assessment trail: evidence
 * links and notes, appended — never edited. The cap (₹2,00,000) is the row's `cap_paise` and a
 * CHECK; approval also needs evidence (another CHECK).
 */
@Injectable()
export class EquipmentClaimsRepository {
  async insert(tx: Tx, c: NewClaim): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO equipment_claims (booking_id, photographer_id, reported_at, incident_at, cause,
        description, evidence, claimed_amount_paise, created_at, updated_at)
      VALUES (${c.bookingId}, ${c.photographerId}, ${c.reportedAt}, ${c.incidentAt}, ${c.cause},
              ${c.description}, ${json(tx, c.evidence)}, ${c.claimedAmountPaise.toString()}::bigint,
              ${c.reportedAt}, ${c.reportedAt})
      RETURNING id`;
    if (!row) throw new Error('equipment_claims insert returned nothing');
    return row.id;
  }

  async find(db: Db, id: string, bookings: BookingScope): Promise<ClaimRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM equipment_claims c
      WHERE c.id = ${id} AND ${scopeClause(db, 'c.booking_id', bookings)}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, id: string, bookings: BookingScope): Promise<ClaimRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM equipment_claims c
      WHERE c.id = ${id} AND ${scopeClause(tx, 'c.booking_id', bookings)}
      FOR UPDATE OF c`;
    return row ? toRecord(row) : null;
  }

  /** OPEN (open + under review): oldest report first. DECIDED: newest decision first. ALL: newest. */
  async page(db: Db, q: ClaimPageQuery): Promise<ClaimRecord[]> {
    const open = q.filter === 'OPEN';
    const decided = q.filter === 'DECIDED';
    const time = decided ? db`c.resolved_at` : db`c.reported_at`;
    const where = [
      scopeClause(db, 'c.booking_id', q.bookings),
      ...(open ? [db`c.status IN ${db([...PENDING])}`] : []),
      ...(decided ? [db`c.status NOT IN ${db([...PENDING])} AND c.resolved_at IS NOT NULL`] : []),
      ...(q.after
        ? [
            open
              ? db`(${time}, c.id) > (${q.after.at}, ${q.after.id}::uuid)`
              : db`(${time}, c.id) < (${q.after.at}, ${q.after.id}::uuid)`,
          ]
        : []),
    ];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM equipment_claims c
      WHERE ${and(db, where)}
      ORDER BY ${open ? db`${time} ASC, c.id ASC` : db`${time} DESC, c.id DESC`}
      LIMIT ${q.limit}`;
    return rows.map(toRecord);
  }

  /** Appends to the trail; the first assessment moves an OPEN claim UNDER_REVIEW. */
  async appendEvidence(tx: Tx, id: string, entries: readonly StoredEvidence[]): Promise<void> {
    await tx`
      UPDATE equipment_claims
      SET evidence = evidence || ${json(tx, entries)}::jsonb,
          status = CASE WHEN status = 'OPEN' THEN 'UNDER_REVIEW' ELSE status END
      WHERE id = ${id}`;
  }

  async approve(
    tx: Tx,
    id: string,
    a: {
      readonly amountPaise: bigint;
      readonly staffId: string;
      readonly note: string;
      readonly at: Date;
    },
  ): Promise<void> {
    await tx`
      UPDATE equipment_claims
      SET status = 'APPROVED', approved_amount_paise = ${a.amountPaise.toString()}::bigint,
          reviewed_by = ${a.staffId}, resolution_note = ${a.note}, resolved_at = ${a.at}
      WHERE id = ${id}`;
  }

  async reject(
    tx: Tx,
    id: string,
    r: { readonly staffId: string; readonly reason: string; readonly at: Date },
  ): Promise<void> {
    await tx`
      UPDATE equipment_claims
      SET status = 'REJECTED', reviewed_by = ${r.staffId}, resolution_note = ${r.reason},
          resolved_at = ${r.at}
      WHERE id = ${id}`;
  }

  async countPending(db: Db, bookings: BookingScope): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM equipment_claims c
      WHERE c.status IN ${db([...PENDING])} AND ${scopeClause(db, 'c.booking_id', bookings)}`;
    return row?.n ?? 0;
  }
}
