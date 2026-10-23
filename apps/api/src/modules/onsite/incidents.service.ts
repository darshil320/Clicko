import type {
  ConfirmIncidentResponse,
  IncidentBody,
  IncidentKind,
  IncidentReportResponse,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import type { Actor } from '../bookings/bookings.types';
import { AssignmentsService, toEwktPoint } from '../dispatch/assignments.service';
import { ExtensionRecords } from './extension-records';
import { assignmentNotActive, assignmentNotFound, conflict, wrongStage } from './http-errors';
import { ON_SITE_STATUSES } from './onsite.config';
import type { Tx } from './onsite.types';
import { type OnsiteContext, OnsiteContextLoader } from './onsite-context';
import { emit, needsReview } from './onsite-outbox';
import { AssignmentEventsRepository } from './repositories/assignment-events.repository';

const REPORT = {
  ACCESS_DENIED: { kind: 'ACCESS_DENIED_REPORTED', event: 'assignment.access_denied_reported' },
  UNSAFE_SITE: { kind: 'UNSAFE_REPORTED', event: 'assignment.unsafe_reported' },
} as const;

/** The note may hold anything; ops sees the first 500 characters in the alert. */
const NOTE_IN_ALERT = 500;
/** Staff confirmation is S9; the dev console stands in (no staff identity yet). */
const STAFF_ACTOR: Actor = { kind: 'STAFF', id: null };
const isOnSite = (s: string): boolean => (ON_SITE_STATUSES as readonly string[]).includes(s);

/**
 * T&C §7.2 access denied and §8.3 unsafe site (ADR-0013 D10). The photographer reports — never
 * blocked by GPS quality — and ops is alerted; the booking moves only when staff confirm.
 */
@Injectable()
export class IncidentsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(OnsiteContextLoader) private readonly contexts: OnsiteContextLoader,
    @Inject(ExtensionRecords) private readonly extensions: ExtensionRecords,
    @Inject(AssignmentEventsRepository) private readonly events: AssignmentEventsRepository,
  ) {}

  async report(
    photographerId: string,
    assignmentId: string,
    incident: IncidentKind,
    body: IncidentBody,
  ): Promise<IncidentReportResponse> {
    const now = this.clock();
    const spec = REPORT[incident];
    return this.sql.begin(async (tx) => {
      const ctx = await this.contexts.forPhotographer(tx, photographerId, assignmentId);
      const ids = { assignmentId, bookingId: ctx.booking.bookingId, kind: incident };
      if (body.deviceTs) {
        const replay = await this.events.findReplay(
          tx,
          assignmentId,
          spec.kind,
          new Date(body.deviceTs),
        );
        if (replay) {
          return {
            ...ids,
            eventId: replay.id,
            reportedAt: replay.occurredAt.toISOString(),
            replayed: true,
          };
        }
      }
      if (ctx.assignment.status !== 'ACTIVE') throw assignmentNotActive();
      if (!isOnSite(ctx.booking.status)) throw wrongStage(ctx.booking.status);
      const event = await this.events.insert(tx, {
        assignmentId,
        bookingId: ctx.booking.bookingId,
        kind: spec.kind,
        note: body.note,
        location: toEwktPoint(body.lat, body.lng),
        actorKind: 'PHOTOGRAPHER',
        actorId: photographerId,
        deviceTs: body.deviceTs ? new Date(body.deviceTs) : null,
        occurredAt: now,
      });
      await emit(tx, spec.event, ctx.booking.bookingId, now, {
        assignment_id: assignmentId,
        event_id: event.id,
        photographer_id: photographerId,
        booking_status: ctx.booking.status,
        note: body.note.slice(0, NOTE_IN_ALERT),
        location: { lat: body.lat, lng: body.lng },
        accuracy_m: body.accuracyM ?? null,
      });
      return { ...ids, eventId: event.id, reportedAt: now.toISOString(), replayed: false };
    });
  }

  /**
   * Dev-only stand-in for the S9 staff confirmation: needs a matching report; ACCESS_DENIED from
   * CHECKED_IN / IN_PROGRESS, UNSAFE_SITE from IN_PROGRESS (a CHECKED_IN booking walks there
   * first). The assignment completes without a check-out, so no SLA T0 (Invariant 2).
   */
  async confirm(assignmentId: string, incident: IncidentKind): Promise<ConfirmIncidentResponse> {
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      const ctx = await this.contexts.forAssignment(tx, assignmentId);
      if (!ctx) throw assignmentNotFound();
      const response = { assignmentId, bookingId: ctx.booking.bookingId, bookingStatus: incident };
      if (ctx.booking.status === incident) return response;
      if (!(await this.events.firstOfKind(tx, assignmentId, REPORT[incident].kind))) {
        throw conflict('NO_INCIDENT_REPORTED', 'The photographer has not reported this incident');
      }
      if (ctx.assignment.status !== 'ACTIVE') throw assignmentNotActive();
      if (!isOnSite(ctx.booking.status)) throw wrongStage(ctx.booking.status);
      await this.end(tx, ctx, incident, now);
      return response;
    });
  }

  private async end(tx: Tx, ctx: OnsiteContext, incident: IncidentKind, now: Date): Promise<void> {
    const bookingId = ctx.booking.bookingId;
    if (incident === 'UNSAFE_SITE' && ctx.booking.status === 'CHECKED_IN') {
      await this.bookings.transition(tx, {
        bookingId,
        to: 'IN_PROGRESS',
        actor: STAFF_ACTOR,
        occurredAt: now,
        reason: 'Shoot treated as started for an unsafe-site abort',
        payload: { assignment_id: ctx.assignment.id },
      });
    }
    await this.extensions.closeUnresolved(tx, ctx, STAFF_ACTOR, now);
    await this.assignments.completeWithoutCheckOut(tx, ctx.assignment.id);
    await this.bookings.transition(tx, {
      bookingId,
      to: incident,
      actor: STAFF_ACTOR,
      occurredAt: now,
      reason:
        incident === 'ACCESS_DENIED'
          ? 'Venue access denied (T&C §7.2), confirmed'
          : 'Unsafe site (T&C §8.3), confirmed',
      payload: { assignment_id: ctx.assignment.id },
    });
    await needsReview(
      tx,
      bookingId,
      incident === 'ACCESS_DENIED' ? 'ACCESS_DENIED_CHARGE_50' : 'UNSAFE_SITE_PARTIAL_CHARGE',
      now,
      {
        assignment_id: ctx.assignment.id,
        booking_total_paise: fromPaiseBigint(ctx.booking.totalPaise),
        charge_bps: incident === 'ACCESS_DENIED' ? 5_000 : null,
      },
    );
  }
}
