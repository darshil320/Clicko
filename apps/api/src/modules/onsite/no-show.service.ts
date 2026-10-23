import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import { AssignmentsService } from '../dispatch/assignments.service';
import { RedispatchService } from '../dispatch/redispatch.service';
import { ONSITE_CONFIG } from './onsite.config';
import type { OnsiteTimer, Tx } from './onsite.types';
import { OnsiteContextLoader } from './onsite-context';
import { emitOnce } from './onsite-outbox';
import { OnsiteTimerScheduler } from './onsite-timers';
import { AssignmentEventsRepository } from './repositories/assignment-events.repository';
import { noShowFirstCheckAt, noShowStep } from './rules/no-show';

const PRE_ARRIVAL: readonly string[] = ['ASSIGNED', 'EN_ROUTE'];
const errorName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

type CheckResult = { readonly timers: OnsiteTimer[]; readonly escalate: boolean };

/**
 * v0.2 §9 no-show ladder (ADR-0013 D11). Armed on `booking.assigned`; the job re-reads state
 * under the booking lock and is a no-op once the photographer checked in or the assignment ended.
 * Escalation is the existing re-dispatch (ABANDONED + penalty + emergency broadcast at the
 * incentive), which itself refuses a booking that has moved on — so a check-in racing the job wins.
 */
@Injectable()
export class NoShowService {
  private readonly logger = new Logger(NoShowService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(RedispatchService) private readonly redispatch: RedispatchService,
    @Inject(OnsiteContextLoader) private readonly contexts: OnsiteContextLoader,
    @Inject(AssignmentEventsRepository) private readonly events: AssignmentEventsRepository,
    @Inject(OnsiteTimerScheduler) private readonly timers: OnsiteTimerScheduler,
  ) {}

  /** `booking.assigned`: arm the first check for the new assignment. Safe to receive twice. */
  async arm(bookingId: string): Promise<void> {
    const assignment = await this.assignments.activeForBooking(this.sql, bookingId);
    if (!assignment || assignment.checkInAt) return;
    const facts = await this.bookings.onsiteFacts(this.sql, bookingId);
    const at = noShowFirstCheckAt({
      scheduledStart: facts.scheduledStart,
      acceptedAt: assignment.acceptedAt,
      isReplacement: assignment.isReplacement,
    });
    await this.timers.schedule([{ kind: 'NO_SHOW_CHECK', assignmentId: assignment.id, at }]);
  }

  /** The `onsite.no-show-check` job (`fromJob`) or the sweep. */
  async check(assignmentId: string, fromJob: boolean): Promise<void> {
    const now = this.clock();
    const result = await this.sql.begin((tx) => this.checkInTx(tx, assignmentId, now, fromJob));
    if (result.escalate) await this.escalate(assignmentId);
    await this.timers.schedule(result.timers);
  }

  /** Lost jobs: every ASSIGNED / EN_ROUTE booking 15+ min past its start is checked again. */
  async sweep(): Promise<number> {
    const now = this.clock();
    const cutoff = new Date(now.getTime() - ONSITE_CONFIG.noShow.alertAfterMinutes * 60_000);
    const lookback = new Date(now.getTime() - ONSITE_CONFIG.noShow.sweepLookbackHours * 3_600_000);
    const due = await this.bookings.awaitingCheckIn(lookback, cutoff, ONSITE_CONFIG.sweepBatchSize);
    for (const bookingId of due) {
      try {
        const assignment = await this.assignments.activeForBooking(this.sql, bookingId);
        if (assignment) await this.check(assignment.id, false);
      } catch (error) {
        this.logger.error(`No-show sweep failed on booking ${bookingId} (${errorName(error)})`);
      }
    }
    return due.length;
  }

  private async checkInTx(
    tx: Tx,
    assignmentId: string,
    now: Date,
    fromJob: boolean,
  ): Promise<CheckResult> {
    const ctx = await this.contexts.forAssignment(tx, assignmentId);
    if (!ctx) return { timers: [], escalate: false };
    const a = ctx.assignment;
    const alert = await this.events.firstOfKind(tx, a.id, 'NO_SHOW_SUSPECTED');
    const step = noShowStep({
      now,
      scheduledStart: ctx.booking.scheduledStart,
      firstCheckAt: noShowFirstCheckAt({
        scheduledStart: ctx.booking.scheduledStart,
        acceptedAt: a.acceptedAt,
        isReplacement: a.isReplacement,
      }),
      alertedAt: alert?.occurredAt ?? null,
      checkedIn: a.checkInAt !== null,
      active: PRE_ARRIVAL.includes(a.status) && PRE_ARRIVAL.includes(ctx.booking.status),
    });
    if (step.kind === 'NONE') return { timers: [], escalate: false };
    if (step.kind === 'ESCALATE') return { timers: [], escalate: true };
    if (step.kind === 'WAIT') {
      return {
        timers: [{ kind: 'NO_SHOW_CHECK', assignmentId, at: step.until, rearm: fromJob }],
        escalate: false,
      };
    }
    const recorded = await this.events.insert(tx, {
      assignmentId,
      bookingId: ctx.booking.bookingId,
      kind: 'NO_SHOW_SUSPECTED',
      note: 'No check-in by start + 15 min',
      actorKind: 'SYSTEM',
      actorId: null,
      occurredAt: now,
    });
    // S11 sends the SMS/call to the photographer and tells the client from this event.
    await emitOnce(tx, 'booking.no_show_suspected', ctx.booking.bookingId, now, assignmentId, {
      assignment_id: assignmentId,
      photographer_id: a.photographerId,
      event_id: recorded.id,
      stage: 'ALERT',
      escalate_at: step.escalateAt.toISOString(),
    });
    return {
      timers: [{ kind: 'NO_SHOW_CHECK', assignmentId, at: step.escalateAt }],
      escalate: false,
    };
  }

  /** v0.2 §9 escalation: ABANDONED + penalty ladder + emergency re-broadcast (ADR-0011/0012). */
  private async escalate(assignmentId: string): Promise<void> {
    const assignment = await this.assignments.find(this.sql, assignmentId);
    if (!assignment) return;
    try {
      await this.redispatch.redispatch(
        assignment.bookingId,
        'No check-in by start + 20 min',
        'NO_SHOW',
        SYSTEM_ACTOR,
        assignmentId,
      );
    } catch (error) {
      // The photographer checked in (or the booking moved on) between our check and the re-dispatch.
      if (error instanceof ConflictException) return;
      throw error;
    }
  }
}
