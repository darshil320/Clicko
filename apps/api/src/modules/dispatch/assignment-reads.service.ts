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
