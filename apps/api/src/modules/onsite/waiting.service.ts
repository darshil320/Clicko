import type { LogWaitingBody, WaitingLogResponse } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { toEwktPoint } from '../dispatch/assignments.service';
import { PricingService } from '../pricing/pricing.service';
import { assignmentNotActive, conflict, unprocessable, wrongStage } from './http-errors';
import { ON_SITE_STATUSES, ONSITE_CONFIG } from './onsite.config';
import type { AssignmentEventRecord, Tx } from './onsite.types';
import { type OnsiteContext, OnsiteContextLoader } from './onsite-context';
import { emit } from './onsite-outbox';
import { AssignmentEventsRepository } from './repositories/assignment-events.repository';
import { billingStartsAt, waitingElapsedMinutes } from './rules/timing';
import { amountsOf } from './views';

const isOnSite = (s: string): boolean => (ON_SITE_STATUSES as readonly string[]).includes(s);

/**
 * T&C §2.6 waiting time (ADR-0013 D9): logged once per assignment, never more than has elapsed
 * since the billing start, at most 60 minutes charged after the ruleset's grace, at the waiting
 * hourly × uplift. The charge is a delta snapshot and raises total and balance at once.
 */
@Injectable()
export class WaitingService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(OnsiteContextLoader) private readonly contexts: OnsiteContextLoader,
    @Inject(AssignmentEventsRepository) private readonly events: AssignmentEventsRepository,
  ) {}

  async log(
    photographerId: string,
    assignmentId: string,
    body: LogWaitingBody,
  ): Promise<WaitingLogResponse> {
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      const ctx = await this.contexts.forPhotographer(tx, photographerId, assignmentId);
      if (body.deviceTs) {
        const replay = await this.events.findReplay(
          tx,
          assignmentId,
          'WAITING_LOGGED',
          new Date(body.deviceTs),
        );
        if (replay) return this.response(tx, ctx, replay, true);
      }
      const a = ctx.assignment;
      if (a.status !== 'ACTIVE' || !a.checkInAt) throw assignmentNotActive();
      if (!isOnSite(ctx.booking.status)) throw wrongStage(ctx.booking.status);
      if (await this.events.firstOfKind(tx, assignmentId, 'WAITING_LOGGED')) {
        throw conflict('WAITING_ALREADY_LOGGED', 'Waiting time is logged once per shoot');
      }
      const elapsed = waitingElapsedMinutes(
        billingStartsAt(a.checkInAt, ctx.booking.scheduledStart),
        now,
      );
      if (body.minutes > elapsed) {
        throw unprocessable(
          'WAITING_EXCEEDS_ELAPSED',
          `Only ${elapsed} minutes have passed since the start`,
          {
            elapsedMinutes: elapsed,
          },
        );
      }
      const { charge, chargeableMinutes } = await this.price(ctx, body.minutes);
      const event = await this.events.insert(tx, {
        assignmentId,
        bookingId: ctx.booking.bookingId,
        kind: 'WAITING_LOGGED',
        minutes: body.minutes,
        amountPaise: charge.totalPaise,
        note: body.note,
        location: toEwktPoint(body.lat, body.lng),
        actorKind: 'PHOTOGRAPHER',
        actorId: photographerId,
        deviceTs: body.deviceTs ? new Date(body.deviceTs) : null,
        occurredAt: now,
      });
      const sequence =
        chargeableMinutes > 0
          ? await this.bookings.addCharge(tx, ctx.booking.bookingId, {
              charge,
              basis: ctx.booking.chargeBasis,
              breakdown: this.pricing.chargeBreakdown(charge, {
                computedAt: now,
                assignmentEventId: event.id,
              }),
              computedAt: now,
            })
          : null;
      const capped = body.minutes > ONSITE_CONFIG.waiting.capMinutes;
      const payload = {
        assignment_id: assignmentId,
        event_id: event.id,
        minutes: body.minutes,
        chargeable_minutes: chargeableMinutes,
        amount_paise: fromPaiseBigint(charge.totalPaise),
        snapshot_sequence: sequence,
      };
      await emit(tx, 'assignment.waiting_logged', ctx.booking.bookingId, now, payload);
      if (capped) await emit(tx, 'assignment.waiting_capped', ctx.booking.bookingId, now, payload);
      return {
        eventId: event.id,
        minutes: body.minutes,
        chargeableMinutes,
        charge: amountsOf(charge),
        snapshotSequence: sequence,
        capped,
        replayed: false,
      };
    });
  }

  private price(ctx: OnsiteContext, minutes: number) {
    return this.pricing.waitingCharge(
      ctx.booking.rulesetId,
      ctx.booking.chargeBasis,
      minutes,
      ONSITE_CONFIG.waiting.capMinutes,
    );
  }

  /** D4 replay: the stored log, its (deterministic) price and the snapshot it produced. */
  private async response(
    tx: Tx,
    ctx: OnsiteContext,
    event: AssignmentEventRecord,
    replayed: boolean,
  ): Promise<WaitingLogResponse> {
    const minutes = event.minutes ?? 0;
    const { charge, chargeableMinutes } = await this.price(ctx, minutes);
    const snapshot = (await this.bookings.charges(tx, ctx.booking.bookingId)).find(
      (c) => c.assignmentEventId === event.id,
    );
    return {
      eventId: event.id,
      minutes,
      chargeableMinutes,
      charge: amountsOf(charge),
      snapshotSequence: snapshot?.sequence ?? null,
      capped: minutes > ONSITE_CONFIG.waiting.capMinutes,
      replayed,
    };
  }
}
