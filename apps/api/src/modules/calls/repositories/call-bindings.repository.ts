import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';

type Db = postgres.ISql;

export interface CallBinding {
  readonly id: string;
  readonly bookingId: string;
  readonly assignmentId: string;
  readonly photographerId: string;
  readonly userId: string;
  readonly virtualNumber: string;
  readonly openedAt: Date;
  readonly closesAt: Date | null;
  readonly closedAt: Date | null;
}

export interface NewBinding {
  readonly bookingId: string;
  readonly assignmentId: string;
  readonly photographerId: string;
  readonly userId: string;
  readonly virtualNumber: string;
  readonly openedAt: Date;
}

interface Row {
  id: string;
  booking_id: string;
  assignment_id: string;
  photographer_id: string;
  user_id: string;
  virtual_number: string;
  opened_at: Date;
  closes_at: Date | null;
  closed_at: Date | null;
}

const toBinding = (r: Row): CallBinding => ({
  id: r.id,
  bookingId: r.booking_id,
  assignmentId: r.assignment_id,
  photographerId: r.photographer_id,
  userId: r.user_id,
  virtualNumber: r.virtual_number,
  openedAt: r.opened_at,
  closesAt: r.closes_at,
  closedAt: r.closed_at,
});

/** A binding is open until it is closed, or its closes_at (check-out + 2 h) has passed. */
export const isOpen = (b: CallBinding, now: Date): boolean =>
  b.closedAt === null && (b.closesAt === null || b.closesAt > now);

/** call_bindings: one per assignment (unique), so opening is idempotent. */
@Injectable()
export class CallBindingsRepository {
  /** false when the assignment already had a binding (a redelivered event). */
  async open(db: Db, b: NewBinding): Promise<boolean> {
    const rows = await db`
      INSERT INTO call_bindings
        (booking_id, assignment_id, photographer_id, user_id, virtual_number, opened_at)
      VALUES (${b.bookingId}, ${b.assignmentId}, ${b.photographerId}, ${b.userId},
              ${b.virtualNumber}, ${b.openedAt})
      ON CONFLICT (assignment_id) DO NOTHING
      RETURNING id`;
    return rows.length > 0;
  }

  /** The shoot ended at `endedAt`: the window runs until `closesAt`. Set once. */
  async scheduleClose(db: Db, assignmentId: string, closesAt: Date): Promise<number> {
    const r = await db`
      UPDATE call_bindings SET closes_at = ${closesAt}
      WHERE assignment_id = ${assignmentId} AND closed_at IS NULL AND closes_at IS NULL
        AND opened_at < ${closesAt}`;
    return r.count;
  }

  /** Every binding of a booking whose shoot ended without a check-out: closes at `closesAt`. */
  async scheduleCloseForBooking(db: Db, bookingId: string, closesAt: Date): Promise<number> {
    const r = await db`
      UPDATE call_bindings SET closes_at = ${closesAt}
      WHERE booking_id = ${bookingId} AND closed_at IS NULL AND closes_at IS NULL
        AND opened_at < ${closesAt}`;
    return r.count;
  }

  /** Re-dispatch: this assignment's binding closes at once. */
  async closeAssignment(db: Db, assignmentId: string, at: Date): Promise<number> {
    const r = await db`
      UPDATE call_bindings SET closed_at = ${at}
      WHERE assignment_id = ${assignmentId} AND closed_at IS NULL`;
    return r.count;
  }

  /** Cancellation: every binding of the booking closes at once. */
  async closeBooking(db: Db, bookingId: string, at: Date): Promise<number> {
    const r = await db`
      UPDATE call_bindings SET closed_at = ${at}
      WHERE booking_id = ${bookingId} AND closed_at IS NULL`;
    return r.count;
  }

  /** The newest binding of the booking held by this client (open or not). */
  async latestForUser(db: Db, bookingId: string, userId: string): Promise<CallBinding | null> {
    const [row] = await db<Row[]>`
      SELECT id, booking_id, assignment_id, photographer_id, user_id, virtual_number, opened_at,
             closes_at, closed_at
      FROM call_bindings
      WHERE booking_id = ${bookingId} AND user_id = ${userId}
      ORDER BY opened_at DESC, id DESC LIMIT 1`;
    return row ? toBinding(row) : null;
  }

  /** The binding of this assignment if this photographer holds it. */
  async forPhotographer(
    db: Db,
    assignmentId: string,
    photographerId: string,
  ): Promise<CallBinding | null> {
    const [row] = await db<Row[]>`
      SELECT id, booking_id, assignment_id, photographer_id, user_id, virtual_number, opened_at,
             closes_at, closed_at
      FROM call_bindings
      WHERE assignment_id = ${assignmentId} AND photographer_id = ${photographerId}`;
    return row ? toBinding(row) : null;
  }
}
