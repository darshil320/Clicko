import type { AssignmentEventKind } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
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
