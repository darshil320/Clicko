import type { ExtensionDecisionResponse, ExtensionRequestView } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { type Actor, SYSTEM_ACTOR } from '../bookings/bookings.types';
import { AssignmentsService } from '../dispatch/assignments.service';
import type { OnsiteCharge } from '../pricing/engine';
import { PricingService } from '../pricing/pricing.service';
import { ExtensionRecords } from './extension-records';
import {
  assignmentNotActive,
  bookingNotFound,
  conflict,
  extensionNotFound,
  wrongStage,
} from './http-errors';
import { ONSITE_CONFIG } from './onsite.config';
import type { OnsiteTimer, Tx } from './onsite.types';
import { type OnsiteContext, OnsiteContextLoader } from './onsite-context';
import { emit } from './onsite-outbox';
import { OnsiteTimerScheduler } from './onsite-timers';
import { AssignmentEventsRepository } from './repositories/assignment-events.repository';
import { EXTENSION_DECLINE_REASON, type ExtensionRequestState } from './rules/extensions';
import { extensionExpiresAt } from './rules/timing';
import { toExtensionView } from './views';

const HOURS = 1;

type Decision =
  | { readonly kind: 'DONE'; readonly response: ExtensionDecisionResponse }
  | { readonly kind: 'EXPIRED' }
  | { readonly kind: 'CONFLICT' };

/**
 * G-16 extensions (ADR-0013 D8): the photographer asks for +1 h, the client approves within
 * 10 minutes. Approval lengthens the calendar block (EXCLUDE decides), writes a delta snapshot
 * and raises total and balance — all in one transaction under booking → assignment locks.
 */
@Injectable()
export class ExtensionsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(OnsiteContextLoader) private readonly contexts: OnsiteContextLoader,
    @Inject(ExtensionRecords) private readonly records: ExtensionRecords,
    @Inject(AssignmentEventsRepository) private readonly events: AssignmentEventsRepository,
    @Inject(OnsiteTimerScheduler) private readonly timers: OnsiteTimerScheduler,
  ) {}

  async request(
    photographerId: string,
    assignmentId: string,
    deviceTs: string | undefined,
  ): Promise<ExtensionRequestView> {
    const now = this.clock();
    const { view, timers } = await this.sql.begin((tx) =>
      this.requestInTx(tx, photographerId, assignmentId, deviceTs, now),
    );
    await this.timers.scheduleOrLog(timers);
    return view;
  }

  async approve(
    userId: string,
    bookingId: string,
    eventId: string,
  ): Promise<ExtensionDecisionResponse> {
    const now = this.clock();
    const outcome = await this.sql.begin((tx) =>
      this.decideInTx(tx, userId, bookingId, eventId, 'APPROVE', now),
    );
    return this.settle(outcome);
  }

  async decline(
    userId: string,
    bookingId: string,
    eventId: string,
  ): Promise<ExtensionDecisionResponse> {
    const now = this.clock();
    const outcome = await this.sql.begin((tx) =>
      this.decideInTx(tx, userId, bookingId, eventId, 'DECLINE', now),
    );
    return this.settle(outcome);
  }

  /** The `onsite.extension-expiry` job: records the lapse (approval already checks it lazily). */
  async expire(eventId: string): Promise<void> {
    const event = await this.events.find(this.sql, eventId);
    if (event?.kind !== 'EXTENSION_REQUESTED') return;
    const now = this.clock();
    const timers = await this.sql.begin(async (tx): Promise<OnsiteTimer[]> => {
      const ctx = await this.contexts.forAssignment(tx, event.assignmentId, event.bookingId);
      if (!ctx) return [];
      const { ledger } = await this.records.ledger(tx, ctx.assignment.id, now);
      if (ledger.unresolved?.eventId !== eventId) return [];
      if (now < ledger.unresolved.expiresAt) {
        return [
          { kind: 'EXTENSION_EXPIRY', eventId, at: ledger.unresolved.expiresAt, rearm: true },
        ];
      }
      await this.records.decline(tx, ctx, ledger.unresolved, 'EXPIRED', SYSTEM_ACTOR, now);
      return [];
    });
    await this.timers.schedule(timers);
  }

  private async settle(outcome: Decision): Promise<ExtensionDecisionResponse> {
    if (outcome.kind === 'EXPIRED') {
      throw conflict('EXTENSION_EXPIRED', 'This extension request has expired');
    }
    if (outcome.kind === 'CONFLICT') {
      throw conflict(
        'EXTENSION_CONFLICT',
        'The photographer has another booking right after this one, so the extension was declined',
      );
    }
    return outcome.response;
  }

  private async requestInTx(
    tx: Tx,
    photographerId: string,
    assignmentId: string,
    deviceTs: string | undefined,
    now: Date,
  ): Promise<{ view: ExtensionRequestView; timers: OnsiteTimer[] }> {
    const ctx = await this.contexts.forPhotographer(tx, photographerId, assignmentId);
    if (deviceTs) {
      const replayed = await this.events.findReplay(
        tx,
        assignmentId,
        'EXTENSION_REQUESTED',
        new Date(deviceTs),
      );
      if (replayed) {
        const { ledger } = await this.records.ledger(tx, assignmentId, now);
        const state = ledger.requests.find((r) => r.eventId === replayed.id);
        if (state)
          return { view: toExtensionView(state, await this.priceOf(ctx), ids(ctx)), timers: [] };
      }
    }
    if (ctx.assignment.status !== 'ACTIVE') throw assignmentNotActive();
    if (ctx.booking.status !== 'IN_PROGRESS') throw wrongStage(ctx.booking.status);
    const { ledger } = await this.records.ledger(tx, assignmentId, now);
    if (ledger.open) {
      throw conflict(
        'EXTENSION_PENDING',
        'The client has not answered your last extension request yet',
      );
    }
    if (ledger.unresolved) {
      await this.records.decline(tx, ctx, ledger.unresolved, 'EXPIRED', SYSTEM_ACTOR, now);
    }
    if (ledger.approvedCount >= ONSITE_CONFIG.extension.maxApproved) {
      throw conflict(
        'EXTENSION_LIMIT',
        `A booking can be extended at most ${ONSITE_CONFIG.extension.maxApproved} times`,
      );
    }
    const charge = await this.priceOf(ctx);
    const event = await this.events.insert(tx, {
      assignmentId,
      bookingId: ctx.booking.bookingId,
      kind: 'EXTENSION_REQUESTED',
      minutes: ONSITE_CONFIG.extension.blockMinutes,
      amountPaise: charge.totalPaise,
      actorKind: 'PHOTOGRAPHER',
      actorId: photographerId,
      deviceTs: deviceTs ? new Date(deviceTs) : null,
      occurredAt: now,
    });
    const expiresAt = extensionExpiresAt(now);
    await emit(tx, 'assignment.extension_requested', ctx.booking.bookingId, now, {
      assignment_id: assignmentId,
      event_id: event.id,
      minutes: ONSITE_CONFIG.extension.blockMinutes,
      amount_paise: fromPaiseBigint(charge.totalPaise),
      expires_at: expiresAt.toISOString(),
    });
    const state: ExtensionRequestState = {
      eventId: event.id,
      requestedAt: now,
      expiresAt,
      amountPaise: charge.totalPaise,
      status: 'PENDING',
      resolvedAt: null,
    };
    return {
      view: toExtensionView(state, charge, ids(ctx)),
      timers: [{ kind: 'EXTENSION_EXPIRY', eventId: event.id, at: expiresAt }],
    };
  }

  private async decideInTx(
    tx: Tx,
    userId: string,
    bookingId: string,
    eventId: string,
    decision: 'APPROVE' | 'DECLINE',
    now: Date,
  ): Promise<Decision> {
    const locked = await this.bookings.lock(tx, bookingId);
    if (locked.userId !== userId) throw bookingNotFound();
    const event = await this.events.find(tx, eventId);
    if (event?.bookingId !== bookingId || event.kind !== 'EXTENSION_REQUESTED') {
      throw extensionNotFound();
    }
    const ctx = await this.contexts.forAssignment(tx, event.assignmentId, bookingId);
    if (!ctx) throw extensionNotFound();
    const { ledger } = await this.records.ledger(tx, ctx.assignment.id, now);
    const request = ledger.requests.find((r) => r.eventId === eventId);
    if (!request) throw extensionNotFound();
    if (request.status === 'EXPIRED' && ledger.unresolved?.eventId === eventId) {
      await this.records.decline(tx, ctx, request, 'EXPIRED', SYSTEM_ACTOR, now);
      return { kind: 'EXPIRED' };
    }
    if (request.status === 'EXPIRED') return { kind: 'EXPIRED' };
    if (request.status !== 'PENDING') {
      throw conflict(
        'EXTENSION_NOT_OPEN',
        `This extension was already ${request.status.toLowerCase()}`,
      );
    }
    if (ctx.booking.status !== 'IN_PROGRESS' || ctx.assignment.status !== 'ACTIVE') {
      throw wrongStage(ctx.booking.status);
    }
    const client: Actor = { kind: 'USER', id: userId };
    if (decision === 'DECLINE') {
      await this.records.decline(tx, ctx, request, EXTENSION_DECLINE_REASON.CLIENT, client, now);
      const view = await this.bookings.view(tx, bookingId);
      return {
        kind: 'DONE',
        response: decisionResponse(eventId, bookingId, 'DECLINED', null, view),
      };
    }
    return this.approveInTx(tx, ctx, request, client, now);
  }

  private async approveInTx(
    tx: Tx,
    ctx: OnsiteContext,
    request: ExtensionRequestState,
    client: Actor,
    now: Date,
  ): Promise<Decision> {
    const charge = await this.priceOf(ctx);
    if (charge.totalPaise !== request.amountPaise) {
      throw new Error(`Extension ${request.eventId} reprices differently from its request`);
    }
    const block = await this.assignments.extendBlock(
      tx,
      ctx.assignment.id,
      ONSITE_CONFIG.extension.blockMinutes,
    );
    if (block === 'CONFLICT') {
      await this.records.decline(tx, ctx, request, 'CALENDAR_CONFLICT', SYSTEM_ACTOR, now);
      return { kind: 'CONFLICT' };
    }
    await this.events.insert(tx, {
      assignmentId: ctx.assignment.id,
      bookingId: ctx.booking.bookingId,
      kind: 'EXTENSION_APPROVED',
      minutes: ONSITE_CONFIG.extension.blockMinutes,
      amountPaise: charge.totalPaise,
      actorKind: client.kind,
      actorId: client.id,
      occurredAt: now,
    });
    const sequence = await this.bookings.addCharge(tx, ctx.booking.bookingId, {
      charge,
      basis: ctx.booking.chargeBasis,
      breakdown: this.pricing.chargeBreakdown(charge, {
        computedAt: now,
        assignmentEventId: request.eventId,
      }),
      computedAt: now,
    });
    await emit(tx, 'assignment.extension_approved', ctx.booking.bookingId, now, {
      assignment_id: ctx.assignment.id,
      event_id: request.eventId,
      minutes: ONSITE_CONFIG.extension.blockMinutes,
      amount_paise: fromPaiseBigint(charge.totalPaise),
      new_snapshot_sequence: sequence,
    });
    const view = await this.bookings.view(tx, ctx.booking.bookingId);
    return {
      kind: 'DONE',
      response: decisionResponse(
        request.eventId,
        ctx.booking.bookingId,
        'APPROVED',
        sequence,
        view,
      ),
    };
  }

  private priceOf(ctx: OnsiteContext): Promise<OnsiteCharge> {
    return this.pricing.extensionCharge(ctx.booking.rulesetId, ctx.booking.chargeBasis, HOURS);
  }
}

const ids = (ctx: OnsiteContext) => ({
  assignmentId: ctx.assignment.id,
  bookingId: ctx.booking.bookingId,
});

function decisionResponse(
  eventId: string,
  bookingId: string,
  status: 'APPROVED' | 'DECLINED',
  sequence: number | null,
  view: { readonly totalPaise: bigint; readonly balancePaise: bigint },
): ExtensionDecisionResponse {
  return {
    eventId,
    bookingId,
    status,
    snapshotSequence: sequence,
    totalPaise: fromPaiseBigint(view.totalPaise),
    balancePaise: fromPaiseBigint(view.balancePaise),
  };
}
