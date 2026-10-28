import type { AssignmentStatus } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';

/** A photographer's engagement after the shoot started: what the media module may upload against. */
export interface ShootEngagement {
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly status: 'ACTIVE' | 'COMPLETED';
  /** Declared at check-out (ADR-0013 D7); null until then. */
  readonly declaredFrameCount: number | null;
}

interface Row {
  id: string;
  booking_id: string;
  status: 'ACTIVE' | 'COMPLETED';
  declared_frame_count: number | null;
}

const toEngagement = (r: Row): ShootEngagement => ({
  assignmentId: r.id,
  bookingId: r.booking_id,
  status: r.status,
  declaredFrameCount: r.declared_frame_count,
});

/** A booking's latest assignment as the staff panel shows it (ADR-0025). */
export interface AssignmentSummary {
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly photographerId: string;
  readonly status: AssignmentStatus;
  readonly acceptedAt: Date;
  readonly checkInAt: Date | null;
  readonly checkOutAt: Date | null;
  readonly declaredFrameCount: number | null;
}

interface SummaryRow {
  id: string;
  booking_id: string;
  photographer_id: string;
  status: AssignmentStatus;
  accepted_at: Date;
  check_in_at: Date | null;
  check_out_at: Date | null;
  declared_frame_count: number | null;
}

/** How far back the upload portal looks for a photographer's shoots (bookings past QA drop out anyway). */
const LOOKBACK_DAYS = 30;

/**
 * Read-only view of `assignments` for other modules (ADR-0014 D2): dispatch owns the table, media
 * asks here. ACTIVE = checked in, COMPLETED = checked out (ADR-0013 D2).
 */
@Injectable()
export class AssignmentReads {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  /** null for a missing assignment, someone else's, and one that never got on site. */
  async engagementFor(photographerId: string, bookingId: string): Promise<ShootEngagement | null> {
    const [row] = await this.sql<Row[]>`
      SELECT id, booking_id, status, declared_frame_count FROM assignments
      WHERE booking_id = ${bookingId} AND photographer_id = ${photographerId}
        AND status IN ('ACTIVE', 'COMPLETED')
      ORDER BY accepted_at DESC LIMIT 1`;
    return row ? toEngagement(row) : null;
  }

  /** The most recently accepted assignment of each booking (replacements supersede). */
  async latestForBookings(bookingIds: readonly string[]): Promise<Map<string, AssignmentSummary>> {
    if (bookingIds.length === 0) return new Map();
    const rows = await this.sql<SummaryRow[]>`
      SELECT DISTINCT ON (booking_id) id, booking_id, photographer_id, status, accepted_at,
             check_in_at, check_out_at, declared_frame_count
      FROM assignments WHERE booking_id IN ${this.sql([...new Set(bookingIds)])}
      ORDER BY booking_id, accepted_at DESC, id DESC`;
    return new Map(
      rows.map((r) => [
        r.booking_id,
        {
          assignmentId: r.id,
          bookingId: r.booking_id,
          photographerId: r.photographer_id,
          status: r.status,
          acceptedAt: r.accepted_at,
          checkInAt: r.check_in_at,
          checkOutAt: r.check_out_at,
          declaredFrameCount: r.declared_frame_count,
        },
      ]),
    );
  }

  /** null when the assignment does not exist. */
  async bookingIdOf(assignmentId: string): Promise<string | null> {
    const [row] = await this.sql<{ booking_id: string }[]>`
      SELECT booking_id FROM assignments WHERE id = ${assignmentId}`;
    return row?.booking_id ?? null;
  }

  async recentEngagements(photographerId: string, now: Date): Promise<ShootEngagement[]> {
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
    const rows = await this.sql<Row[]>`
      SELECT id, booking_id, status, declared_frame_count FROM assignments
      WHERE photographer_id = ${photographerId} AND status IN ('ACTIVE', 'COMPLETED')
        AND blocked_until > ${since}
      ORDER BY blocked_from DESC LIMIT 50`;
    return rows.map(toEngagement);
  }
}
