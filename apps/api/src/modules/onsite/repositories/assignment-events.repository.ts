import type { AssignmentEventKind } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { IdSubquery } from '../../../infra/db/id-subquery';
import type { ActorKind } from '../../bookings/state-machine';
import type { AssignmentEventRecord, Db, NewAssignmentEvent, Tx } from '../onsite.types';

interface Row {
  id: string;
  assignment_id: string;
  booking_id: string;
  kind: AssignmentEventKind;
  minutes: number | null;
  amount_paise: string | null;
  note: string | null;
  actor_kind: ActorKind;
  actor_id: string | null;
  device_ts: Date | null;
  occurred_at: Date;
}

const toRecord = (r: Row): AssignmentEventRecord => ({
  id: String(r.id),
  assignmentId: r.assignment_id,
  bookingId: r.booking_id,
  kind: r.kind,
  minutes: r.minutes,
  amountPaise: r.amount_paise === null ? null : BigInt(r.amount_paise),
  note: r.note,
  actorKind: r.actor_kind,
  actorId: r.actor_id,
  deviceTs: r.device_ts,
  occurredAt: r.occurred_at,
});

export type IncidentReportKind =
  | 'ACCESS_DENIED_REPORTED'
  | 'UNSAFE_REPORTED'
  | 'CLIENT_ABSENT_REPORTED';

const REPORT_KINDS: readonly IncidentReportKind[] = [
  'ACCESS_DENIED_REPORTED',
  'UNSAFE_REPORTED',
  'CLIENT_ABSENT_REPORTED',
];

export interface IncidentReportRecord {
  readonly eventId: string;
  readonly kind: IncidentReportKind;
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly note: string | null;
  readonly reportedAt: Date;
}

const COLUMNS = `id::text AS id, assignment_id, booking_id, kind, minutes, amount_paise, note,
  actor_kind, actor_id, device_ts, occurred_at`;

/**
 * assignment_events — owned by the onsite module (ADR-0013 D1). Append-only (Invariant 5; a
 * trigger forbids UPDATE/DELETE). Locations are bound EWKT text cast to geography.
 */
@Injectable()
export class AssignmentEventsRepository {
  async insert(tx: Tx, e: NewAssignmentEvent): Promise<AssignmentEventRecord> {
    const amount =
      e.amountPaise === undefined || e.amountPaise === null ? null : e.amountPaise.toString();
    const [row] = await tx<Row[]>`
      INSERT INTO assignment_events (assignment_id, booking_id, kind, minutes, amount_paise, note,
                                     location, actor_kind, actor_id, device_ts, occurred_at)
      VALUES (${e.assignmentId}, ${e.bookingId}, ${e.kind}, ${e.minutes ?? null}, ${amount}::bigint,
              ${e.note ?? null}, ${e.location ?? null}::geography, ${e.actorKind}, ${e.actorId},
              ${e.deviceTs ?? null}, ${e.occurredAt})
      RETURNING ${tx.unsafe(COLUMNS)}`;
    if (!row) throw new Error('assignment_events.insert: no row returned');
    return toRecord(row);
  }

  async forAssignment(db: Db, assignmentId: string): Promise<AssignmentEventRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignment_events
      WHERE assignment_id = ${assignmentId} ORDER BY id`;
    return rows.map(toRecord);
  }

  async find(db: Db, id: string): Promise<AssignmentEventRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignment_events WHERE id = ${id}::bigint`;
    return row ? toRecord(row) : null;
  }

  /** The same offline event replayed (ADR-0013 D4): same assignment, kind and device time. */
  async findReplay(
    db: Db,
    assignmentId: string,
    kind: AssignmentEventKind,
    deviceTs: Date,
  ): Promise<AssignmentEventRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignment_events
      WHERE assignment_id = ${assignmentId} AND kind = ${kind} AND device_ts = ${deviceTs}
      ORDER BY id LIMIT 1`;
    return row ? toRecord(row) : null;
  }

  /** How many rows `openReports` would return, counted in SQL (the overview tile). */
  async countOpenReports(db: Db, onSite: IdSubquery, absent: IdSubquery): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(DISTINCT (assignment_id, kind))::int AS n
      FROM assignment_events
      WHERE (kind IN ('ACCESS_DENIED_REPORTED', 'UNSAFE_REPORTED') AND booking_id IN (${onSite}))
         OR (kind = 'CLIENT_ABSENT_REPORTED' AND booking_id IN (${absent}))`;
    return row?.n ?? 0;
  }

  /**
   * The first report of each kind per assignment, for bookings still awaiting the decision:
   * access denied / unsafe in `onSite`, client absent in `absent`. Oldest first.
   */
  async openReports(
    db: Db,
    onSite: IdSubquery,
    absent: IdSubquery,
  ): Promise<IncidentReportRecord[]> {
    const rows = await db<
      {
        id: string;
        kind: IncidentReportKind;
        assignment_id: string;
        booking_id: string;
        note: string | null;
        occurred_at: Date;
      }[]
    >`
      SELECT DISTINCT ON (assignment_id, kind) id::text AS id, kind, assignment_id, booking_id,
             note, occurred_at
      FROM assignment_events
      WHERE (kind IN ('ACCESS_DENIED_REPORTED', 'UNSAFE_REPORTED') AND booking_id IN (${onSite}))
         OR (kind = 'CLIENT_ABSENT_REPORTED' AND booking_id IN (${absent}))
      ORDER BY assignment_id, kind, id`;
    return rows
      .map((r) => ({
        eventId: r.id,
        kind: r.kind,
        assignmentId: r.assignment_id,
        bookingId: r.booking_id,
        note: r.note,
        reportedAt: r.occurred_at,
      }))
      .sort((a, b) => a.reportedAt.getTime() - b.reportedAt.getTime());
  }

  async reportKinds(
    db: Db,
    bookingIds: readonly string[],
  ): Promise<Map<string, ReadonlySet<string>>> {
    if (bookingIds.length === 0) return new Map();
    const rows = await db<{ booking_id: string; kind: string }[]>`
      SELECT DISTINCT booking_id, kind FROM assignment_events
      WHERE booking_id IN ${db([...new Set(bookingIds)])} AND kind IN ${db([...REPORT_KINDS])}`;
    const out = new Map<string, Set<string>>();
    for (const r of rows)
      out.set(r.booking_id, new Set([...(out.get(r.booking_id) ?? []), r.kind]));
    return out;
  }

  async firstOfKind(
    db: Db,
    assignmentId: string,
    kind: AssignmentEventKind,
  ): Promise<AssignmentEventRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignment_events
      WHERE assignment_id = ${assignmentId} AND kind = ${kind} ORDER BY id LIMIT 1`;
    return row ? toRecord(row) : null;
  }
}
