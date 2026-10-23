import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import type { DispatchFacts } from '../bookings/bookings.types';
import type { Db, OnsiteAssignment, RecordedFix, Tx, VenueBasis } from './dispatch.types';
import { AssignmentOnsiteRepository } from './repositories/assignment-onsite.repository';
import { EXCLUSION_VIOLATION } from './repositories/assignments.repository';
import { AttemptsRepository } from './repositories/attempts.repository';
import { GeofenceRepository } from './repositories/geofence.repository';
import { VenuePoints } from './venue-points';

const sqlState = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

/** 'SRID=4326;POINT(lng lat)' — a stored point, bound as text and cast (no spatial function). */
export function toEwktPoint(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new RangeError('invalid coordinates');
  return `SRID=4326;POINT(${lng} ${lat})`;
}

export interface GeofenceMeasure {
  readonly distanceM: number;
  readonly basis: VenueBasis;
}

/**
 * Dispatch owns `assignments` (ADR-0010); this is the on-site write path other modules use
 * (ADR-0013 D1): en-route, check-in/out (written once), the extension block, the
 * incident completion, plus the geofence distance (PostGIS stays in dispatch/repositories).
 * Every write runs in the caller's transaction, after it has locked the booking.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(AssignmentOnsiteRepository) private readonly repo: AssignmentOnsiteRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(GeofenceRepository) private readonly geofence: GeofenceRepository,
    @Inject(VenuePoints) private readonly venues: VenuePoints,
  ) {}

  find(db: Db, id: string): Promise<OnsiteAssignment | null> {
    return this.repo.find(db, id);
  }

  /** null for a missing assignment AND for someone else's. */
  findForPhotographer(
    db: Db,
    id: string,
    photographerId: string,
  ): Promise<OnsiteAssignment | null> {
    return this.repo.findForPhotographer(db, id, photographerId);
  }

  lock(tx: Tx, id: string): Promise<OnsiteAssignment | null> {
    return this.repo.lock(tx, id);
  }

  activeForBooking(db: Db, bookingId: string): Promise<OnsiteAssignment | null> {
    return this.repo.activeForBooking(db, bookingId);
  }

  markEnRoute(tx: Tx, id: string): Promise<boolean> {
    return this.repo.markEnRoute(tx, id);
  }

  recordCheckIn(tx: Tx, id: string, fix: RecordedFix, distanceM: number): Promise<boolean> {
    return this.repo.recordCheckIn(tx, id, fix, distanceM);
  }

  recordCheckOut(tx: Tx, id: string, fix: RecordedFix, frames: number): Promise<boolean> {
    return this.repo.recordCheckOut(tx, id, fix, frames);
  }

  completeWithoutCheckOut(tx: Tx, id: string): Promise<boolean> {
    return this.repo.complete(tx, id);
  }

  /**
   * Lengthens the calendar block for an approved extension. The EXCLUDE constraint is the judge:
   * an overlap with the photographer's next booking is 'CONFLICT' (savepoint rolled back).
   */
  async extendBlock(tx: Tx, id: string, minutes: number): Promise<'EXTENDED' | 'CONFLICT'> {
    try {
      await tx.savepoint((sp) => this.repo.extendBlock(sp, id, minutes));
      return 'EXTENDED';
    } catch (error) {
      if (sqlState(error) === EXCLUSION_VIOLATION) return 'CONFLICT';
      throw error;
    }
  }

  checkedOutFor(photographerId: string, limit: number): Promise<OnsiteAssignment[]> {
    return this.repo.checkedOutFor(this.sql, photographerId, limit);
  }

  /** What the photographer was offered for each booking they accepted (incentive included). */
  acceptedPayouts(
    photographerId: string,
    bookingIds: readonly string[],
  ): Promise<Map<string, bigint>> {
    return this.attempts.acceptedPayouts(this.sql, photographerId, bookingIds);
  }

  /** Which point the venue currently resolves to (VENUE once geocoded). */
  async venueBasis(
    facts: Pick<DispatchFacts, 'bookingId' | 'venueLocation' | 'venuePincode'>,
  ): Promise<VenueBasis> {
    return (await this.venues.resolve(facts)).basis;
  }

  /** Distance from the fix to the venue point, and which point that was (ADR-0013 D3). */
  async measure(
    db: Db,
    facts: Pick<DispatchFacts, 'bookingId' | 'venueLocation' | 'venuePincode'>,
    lat: number,
    lng: number,
  ): Promise<GeofenceMeasure> {
    const venue = await this.venues.resolve(facts);
    const metres = await this.geofence.distanceMetres(db, venue.point, lat, lng);
    return { distanceM: Math.round(metres * 10) / 10, basis: venue.basis };
  }
}
