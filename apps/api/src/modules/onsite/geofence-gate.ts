import type { GeoFix, GeofenceBasis } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AssignmentsService, toEwktPoint } from '../dispatch/assignments.service';
import type { RecordedFix } from '../dispatch/dispatch.types';
import { unprocessable } from './http-errors';
import type { Tx } from './onsite.types';
import type { OnsiteContext } from './onsite-context';
import { emit } from './onsite-outbox';
import { AssignmentEventsRepository } from './repositories/assignment-events.repository';
import { decideGeofence } from './rules/geofence';

export interface GeofenceResult {
  readonly distanceM: number;
  readonly basis: GeofenceBasis;
  readonly verified: boolean;
}

/** A fix as stored on the assignment (EWKT location; device time kept when sent). */
export function recordedFix(fix: GeoFix, at: Date): RecordedFix {
  return {
    at,
    location: toEwktPoint(fix.lat, fix.lng),
    accuracyM: fix.accuracyM,
    offline: fix.offline,
    deviceTs: fix.deviceTs ? new Date(fix.deviceTs) : null,
  };
}

/** G-15 check-in/out gate (ADR-0013 D3): measures via dispatch's PostGIS repo, decides, records. */
@Injectable()
export class GeofenceGate {
  constructor(
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(AssignmentEventsRepository) private readonly events: AssignmentEventsRepository,
  ) {}

  /** 422 LOCATION_TOO_INACCURATE / OUTSIDE_GEOFENCE, or the measured result. */
  async check(tx: Tx, ctx: OnsiteContext, fix: GeoFix): Promise<GeofenceResult> {
    const { distanceM, basis } = await this.assignments.measure(tx, ctx.booking, fix.lat, fix.lng);
    const decision = decideGeofence({ distanceM, accuracyM: fix.accuracyM, basis });
    if (decision.kind === 'LOCATION_TOO_INACCURATE') {
      throw unprocessable(
        'LOCATION_TOO_INACCURATE',
        `Your GPS fix is too rough (±${Math.round(fix.accuracyM)} m) — wait for a better signal`,
        { maxAccuracyM: decision.maxAccuracyM },
      );
    }
    if (decision.kind === 'OUTSIDE_GEOFENCE') {
      throw unprocessable('OUTSIDE_GEOFENCE', 'You are not at the venue yet', {
        distanceM,
        limitM: decision.limitM,
      });
    }
    return { distanceM, basis, verified: decision.verified };
  }

  /** An accepted but unverified fix: a timeline entry and an ops alert (ADR-0013 D3). */
  async flagUnverified(
    tx: Tx,
    ctx: OnsiteContext,
    which: 'CHECK_IN' | 'CHECK_OUT',
    result: GeofenceResult,
    fix: RecordedFix,
  ): Promise<void> {
    if (result.verified) return;
    await this.events.insert(tx, {
      assignmentId: ctx.assignment.id,
      bookingId: ctx.booking.bookingId,
      kind: 'GEOFENCE_UNVERIFIED',
      note: `${which} ${result.basis} ${result.distanceM} m`,
      location: fix.location,
      actorKind: 'SYSTEM',
      actorId: null,
      deviceTs: fix.deviceTs,
      occurredAt: fix.at,
    });
    await emit(tx, 'assignment.geofence_unverified', ctx.booking.bookingId, fix.at, {
      assignment_id: ctx.assignment.id,
      which,
      geofence_basis: result.basis,
      distance_m: result.distanceM,
    });
  }
}
