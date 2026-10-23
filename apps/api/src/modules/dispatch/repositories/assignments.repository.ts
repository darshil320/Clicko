import type { AssignmentStatus } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { AssignmentRecord, Db, Tx } from '../dispatch.types';

interface AssignmentRow {
  id: string;
  booking_id: string;
  photographer_id: string;
  status: AssignmentStatus;
  is_replacement: boolean;
  blocked_from: Date;
  blocked_until: Date;
  accepted_at: Date;
  released_at: Date | null;
  release_reason: string | null;
}

const toAssignment = (r: AssignmentRow): AssignmentRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  photographerId: r.photographer_id,
  status: r.status,
  isReplacement: r.is_replacement,
  blockedFrom: r.blocked_from,
  blockedUntil: r.blocked_until,
  acceptedAt: r.accepted_at,
  releasedAt: r.released_at,
  releaseReason: r.release_reason,
});

const COLUMNS = `id, booking_id, photographer_id, status, is_replacement, blocked_from, blocked_until,
  accepted_at, released_at, release_reason`;

/** Statuses that hold the photographer's calendar (the EXCLUDE constraint's WHERE clause). */
const HOLDING = ['ASSIGNED', 'EN_ROUTE', 'ACTIVE'] as const;

export interface NewAssignment {
  readonly bookingId: string;
  readonly photographerId: string;
  readonly blockedFrom: Date;
  readonly blockedUntil: Date;
  readonly acceptedAt: Date;
  readonly replacedAssignmentId: string | null;
}

/** Postgres SQLSTATEs the accept path maps to 409s. */
export const EXCLUSION_VIOLATION = '23P01';
export const UNIQUE_VIOLATION = '23505';

/** assignments — the calendar block that makes double booking impossible (G-28). */
@Injectable()
export class AssignmentsRepository {
  /** Throws 23P01 when the photographer is already booked in the window (EXCLUDE USING gist). */
  async insert(tx: Tx, a: NewAssignment): Promise<AssignmentRecord> {
    const [row] = await tx<AssignmentRow[]>`
      INSERT INTO assignments (booking_id, photographer_id, blocked_from, blocked_until, accepted_at,
                               is_replacement, replaced_assignment_id)
      VALUES (${a.bookingId}, ${a.photographerId}, ${a.blockedFrom}, ${a.blockedUntil},
              ${a.acceptedAt}, ${a.replacedAssignmentId !== null}, ${a.replacedAssignmentId})
      RETURNING ${tx.unsafe(COLUMNS)}`;
    if (!row) throw new Error('assignments.insert: no row returned');
    return toAssignment(row);
  }

  async activeForBooking(db: Db, bookingId: string): Promise<AssignmentRecord | null> {
    const [row] = await db<AssignmentRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignments
      WHERE booking_id = ${bookingId} AND status IN ${db([...HOLDING])}
      ORDER BY accepted_at DESC LIMIT 1`;
    return row ? toAssignment(row) : null;
  }

  /** An assignment that was accepted and not given up (ASSIGNED … COMPLETED): capture is due. */
  async engagedForBooking(db: Db, bookingId: string): Promise<AssignmentRecord | null> {
    const [row] = await db<AssignmentRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignments
      WHERE booking_id = ${bookingId} AND status IN ('ASSIGNED', 'EN_ROUTE', 'ACTIVE', 'COMPLETED')
      ORDER BY accepted_at DESC LIMIT 1`;
    return row ? toAssignment(row) : null;
  }

  /** The most recent assignment that ended without a shoot (the one a replacement replaces). */
  async latestEndedForBooking(db: Db, bookingId: string): Promise<AssignmentRecord | null> {
    const [row] = await db<AssignmentRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignments
      WHERE booking_id = ${bookingId} AND status IN ('RELEASED', 'ABANDONED')
      ORDER BY accepted_at DESC LIMIT 1`;
    return row ? toAssignment(row) : null;
  }

  async end(
    tx: Tx,
    assignmentId: string,
    status: 'RELEASED' | 'ABANDONED',
    reason: string,
    at: Date,
  ): Promise<void> {
    await tx`
      UPDATE assignments SET status = ${status}, released_at = ${at}, release_reason = ${reason}
      WHERE id = ${assignmentId} AND status IN ${tx([...HOLDING])}`;
  }

  /** null for a missing assignment AND for someone else's. */
  async findForPhotographer(
    db: Db,
    assignmentId: string,
    photographerId: string,
  ): Promise<AssignmentRecord | null> {
    const [row] = await db<AssignmentRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignments
      WHERE id = ${assignmentId} AND photographer_id = ${photographerId}`;
    return row ? toAssignment(row) : null;
  }

  /** Accepted work still ahead of (or under way for) the photographer. */
  async upcomingFor(db: Db, photographerId: string, now: Date): Promise<AssignmentRecord[]> {
    const rows = await db<AssignmentRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignments
      WHERE photographer_id = ${photographerId} AND status IN ${db([...HOLDING])}
        AND blocked_until > ${now}
      ORDER BY blocked_from`;
    return rows.map(toAssignment);
  }

  async forBooking(db: Db, bookingId: string): Promise<AssignmentRecord[]> {
    const rows = await db<AssignmentRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignments WHERE booking_id = ${bookingId}
      ORDER BY accepted_at`;
    return rows.map(toAssignment);
  }
}
