import type { AssignmentStatus } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { Db, OnsiteAssignment, RecordedFix, Tx } from '../dispatch.types';

interface Row {
  id: string;
  booking_id: string;
  photographer_id: string;
  status: AssignmentStatus;
  is_replacement: boolean;
  replaced_assignment_id: string | null;
  blocked_from: Date;
  blocked_until: Date;
  accepted_at: Date;
  released_at: Date | null;
  release_reason: string | null;
  check_in_at: Date | null;
  check_in_accuracy_m: string | null;
  check_in_distance_m: string | null;
  check_in_offline: boolean;
  check_in_device_ts: Date | null;
  check_out_at: Date | null;
  check_out_accuracy_m: string | null;
  check_out_offline: boolean;
  check_out_device_ts: Date | null;
  declared_frame_count: number | null;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

const toOnsite = (r: Row): OnsiteAssignment => ({
  id: r.id,
  bookingId: r.booking_id,
  photographerId: r.photographer_id,
  status: r.status,
  isReplacement: r.is_replacement,
  replacedAssignmentId: r.replaced_assignment_id,
  blockedFrom: r.blocked_from,
  blockedUntil: r.blocked_until,
  acceptedAt: r.accepted_at,
  releasedAt: r.released_at,
  releaseReason: r.release_reason,
  checkInAt: r.check_in_at,
  checkInAccuracyM: num(r.check_in_accuracy_m),
  checkInDistanceM: num(r.check_in_distance_m),
  checkInOffline: r.check_in_offline,
  checkInDeviceTs: r.check_in_device_ts,
  checkOutAt: r.check_out_at,
  checkOutAccuracyM: num(r.check_out_accuracy_m),
  checkOutOffline: r.check_out_offline,
  checkOutDeviceTs: r.check_out_device_ts,
  declaredFrameCount: r.declared_frame_count,
});

const COLUMNS = `id, booking_id, photographer_id, status, is_replacement, replaced_assignment_id,
  blocked_from, blocked_until, accepted_at, released_at, release_reason,
  check_in_at, check_in_accuracy_m, check_in_distance_m, check_in_offline, check_in_device_ts,
  check_out_at, check_out_accuracy_m, check_out_offline, check_out_device_ts, declared_frame_count`;

/** Statuses that hold the booking (the re-dispatch / no-show sources and the shoot itself). */
const HOLDING = ['ASSIGNED', 'EN_ROUTE', 'ACTIVE'] as const;

/**
 * The on-site columns of assignments (G-15). Check-in/out are written once: every write is guarded
 * by `… IS NULL` and the caller learns whether it happened. Locations arrive as bound EWKT text.
 */
@Injectable()
export class AssignmentOnsiteRepository {
  async find(db: Db, id: string): Promise<OnsiteAssignment | null> {
    const [row] = await db<Row[]>`SELECT ${db.unsafe(COLUMNS)} FROM assignments WHERE id = ${id}`;
    return row ? toOnsite(row) : null;
  }

  async findForPhotographer(
    db: Db,
    id: string,
    photographerId: string,
  ): Promise<OnsiteAssignment | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignments
      WHERE id = ${id} AND photographer_id = ${photographerId}`;
    return row ? toOnsite(row) : null;
  }

  /** Row lock for the rest of the transaction (take the booking lock first). */
  async lock(tx: Tx, id: string): Promise<OnsiteAssignment | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM assignments WHERE id = ${id} FOR UPDATE`;
    return row ? toOnsite(row) : null;
  }

  async activeForBooking(db: Db, bookingId: string): Promise<OnsiteAssignment | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignments
      WHERE booking_id = ${bookingId} AND status IN ${db([...HOLDING])}
      ORDER BY accepted_at DESC LIMIT 1`;
    return row ? toOnsite(row) : null;
  }

  async markEnRoute(tx: Tx, id: string): Promise<boolean> {
    const rows = await tx`
      UPDATE assignments SET status = 'EN_ROUTE' WHERE id = ${id} AND status = 'ASSIGNED'
      RETURNING id`;
    return rows.length === 1;
  }

  async recordCheckIn(tx: Tx, id: string, fix: RecordedFix, distanceM: number): Promise<boolean> {
    const rows = await tx`
      UPDATE assignments
         SET status = 'ACTIVE', check_in_at = ${fix.at}, check_in_location = ${fix.location}::geography,
             check_in_accuracy_m = ${fix.accuracyM}, check_in_distance_m = ${distanceM},
             check_in_offline = ${fix.offline}, check_in_device_ts = ${fix.deviceTs}
       WHERE id = ${id} AND check_in_at IS NULL AND status IN ('ASSIGNED', 'EN_ROUTE')
       RETURNING id`;
    return rows.length === 1;
  }

  async recordCheckOut(tx: Tx, id: string, fix: RecordedFix, frames: number): Promise<boolean> {
    const rows = await tx`
      UPDATE assignments
         SET status = 'COMPLETED', check_out_at = ${fix.at},
             check_out_location = ${fix.location}::geography,
             check_out_accuracy_m = ${fix.accuracyM}, check_out_offline = ${fix.offline},
             check_out_device_ts = ${fix.deviceTs}, declared_frame_count = ${frames}
       WHERE id = ${id} AND check_out_at IS NULL AND check_in_at IS NOT NULL AND status = 'ACTIVE'
       RETURNING id`;
    return rows.length === 1;
  }

  /** An incident ended the shoot without a check-out (ADR-0013 D10). */
  async complete(tx: Tx, id: string): Promise<boolean> {
    const rows = await tx`
      UPDATE assignments SET status = 'COMPLETED' WHERE id = ${id} AND status = 'ACTIVE'
      RETURNING id`;
    return rows.length === 1;
  }

  /** Throws SQLSTATE 23P01 when the longer block overlaps the photographer's next booking. */
  async extendBlock(tx: Tx, id: string, minutes: number): Promise<void> {
    await tx`
      UPDATE assignments
         SET blocked_until = blocked_until + make_interval(mins => ${minutes}::int)
       WHERE id = ${id} AND status = 'ACTIVE'`;
  }

  /** Checked-out work, most recent first (earnings). */
  async checkedOutFor(db: Db, photographerId: string, limit: number): Promise<OnsiteAssignment[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM assignments
      WHERE photographer_id = ${photographerId} AND status = 'COMPLETED'
        AND check_out_at IS NOT NULL
      ORDER BY check_out_at DESC LIMIT ${limit}`;
    return rows.map(toOnsite);
  }
}
