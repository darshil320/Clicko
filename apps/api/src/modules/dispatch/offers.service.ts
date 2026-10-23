import type {
  AcceptOfferResponse,
  DeclineOfferResponse,
  ProAssignment,
  ProOffer,
} from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import type { BookingRow } from '../bookings/bookings.types';
import { PhotographersService } from '../photographers/photographers.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import type { AssignmentRecord, AttemptRecord, DispatchTimer, Tx } from './dispatch.types';
import { DispatchEngine } from './dispatch-engine.service';
import { DispatchLock } from './dispatch-lock';
import { accountInactive, conflict, offerNotFound } from './http-errors';
import {
  AssignmentsRepository,
  EXCLUSION_VIOLATION,
  UNIQUE_VIOLATION,
} from './repositories/assignments.repository';
import { AttemptsRepository } from './repositories/attempts.repository';
import { RoundsRepository } from './repositories/rounds.repository';
import { DispatchTimerScheduler } from './timer-scheduler';
import { toProAssignment, toProOffer } from './views';
import { calendarBlock } from './wave-plan';

type AcceptOutcome =
  | { readonly kind: 'ASSIGNED'; readonly assignment: AssignmentRecord }
  | { readonly kind: 'SLOT_CONFLICT'; readonly timers: DispatchTimer[] };

const SLOT_CONFLICT_MESSAGE = 'You already have a booking or a block that overlaps this one';

const sqlState = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

/**
 * The photographer's side of an offer (ADR-0010): list, accept (Redis lock → one transaction →
 * EXCLUDE constraint), decline. Offers belong to exactly one photographer; anyone else gets 404.
 */
@Injectable()
export class OffersService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(DispatchEngine) private readonly engine: DispatchEngine,
    @Inject(DispatchLock) private readonly lock: DispatchLock,
    @Inject(RoundsRepository) private readonly rounds: RoundsRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(AssignmentsRepository) private readonly assignments: AssignmentsRepository,
    @Inject(DispatchTimerScheduler) private readonly timers: DispatchTimerScheduler,
  ) {}

  async list(photographerId: string): Promise<ProOffer[]> {
    const pending = await this.attempts.pendingFor(this.sql, photographerId, this.clock());
    const summaries = await this.bookings.offerSummaries(pending.map((p) => p.bookingId));
    const byId = new Map(summaries.map((s) => [s.bookingId, s]));
    const labels = await this.serviceability.areaLabels(summaries.map((s) => s.venuePincode));
    return pending.flatMap((offer) => {
      const booking = byId.get(offer.bookingId);
      if (booking?.status !== 'DISPATCHING') return [];
      return [toProOffer(offer, booking, labels.get(booking.venuePincode))];
    });
  }

  /**
   * The offer is checked before the lock is taken (a closed offer never contends for it); a held
   * lock means another accept is mid-flight: 409 ACCEPT_IN_PROGRESS. IDs only in the response.
   */
  async accept(photographerId: string, attemptId: string): Promise<AcceptOfferResponse> {
    const offer = await this.attempts.findForPhotographer(this.sql, attemptId, photographerId);
    if (!offer) throw offerNotFound();
    assertAttemptOpen(offer, this.clock());
    const lock = await this.lock.acquire(offer.bookingId, attemptId);
    if (lock === 'TAKEN') {
      throw conflict('ACCEPT_IN_PROGRESS', 'Someone is accepting this booking right now');
    }
    let outcome: AcceptOutcome;
    try {
      outcome = await this.sql.begin((tx) => this.acceptInTx(tx, offer, this.clock()));
    } finally {
      if (lock === 'ACQUIRED') await this.lock.release(offer.bookingId, attemptId);
    }
    if (outcome.kind === 'SLOT_CONFLICT') {
      await this.timers.scheduleOrLog(outcome.timers);
      throw conflict('SLOT_CONFLICT', SLOT_CONFLICT_MESSAGE);
    }
    return {
      attemptId,
      assignmentId: outcome.assignment.id,
      bookingId: outcome.assignment.bookingId,
      status: 'ASSIGNED',
    };
  }

  async decline(
    photographerId: string,
    attemptId: string,
    reason?: string,
  ): Promise<DeclineOfferResponse> {
    const offer = await this.attempts.findForPhotographer(this.sql, attemptId, photographerId);
    if (!offer) throw offerNotFound();
    const now = this.clock();
    const timers = await this.sql.begin((tx) => this.declineInTx(tx, offer, reason ?? null, now));
    await this.timers.scheduleOrLog(timers);
    return { attemptId, outcome: 'DECLINED' };
  }

  /** Upcoming accepted work, with the address (revealed only after acceptance). */
  async upcoming(photographerId: string): Promise<ProAssignment[]> {
    const rows = await this.assignments.upcomingFor(this.sql, photographerId, this.clock());
    return this.assignmentViews(photographerId, rows);
  }

  private async assignmentViews(
    photographerId: string,
    rows: readonly AssignmentRecord[],
  ): Promise<ProAssignment[]> {
    const ids = rows.map((a) => a.bookingId);
    const details = new Map(
      (await this.bookings.assignmentDetails(ids)).map((d) => [d.bookingId, d]),
    );
    const payouts = await this.attempts.acceptedPayouts(this.sql, photographerId, ids);
    const labels = await this.serviceability.areaLabels(
      [...details.values()].map((d) => d.venuePincode),
    );
    return rows.flatMap((a) => {
      const d = details.get(a.bookingId);
      if (!d) return [];
      const payout = payouts.get(a.bookingId) ?? d.expectedPayoutPaise;
      return [toProAssignment(a, d, labels.get(d.venuePincode), payout)];
    });
  }

  /** Booking → attempt → assignment, in that lock order (the same as every dispatch path). */
  private async acceptInTx(tx: Tx, offer: AttemptRecord, now: Date): Promise<AcceptOutcome> {
    const booking = await this.bookings.lock(tx, offer.bookingId);
    const attempt = await this.attempts.lock(tx, offer.id);
    if (!attempt) throw offerNotFound();
    assertAcceptable(booking, attempt, now);
    const facts = await this.bookings.dispatchFacts(tx, booking.id);
    const block = calendarBlock(facts.scheduledStart, facts.scheduledEnd);
    // Re-checked under the lock: suspended since the offer, or blocked their calendar since.
    const availability = await this.photographers.availabilityAt(
      tx,
      attempt.photographerId,
      block.from,
      block.until,
    );
    if (availability === 'INACTIVE') throw accountInactive();
    if (availability === 'BLOCKED') return this.slotConflict(tx, attempt, now);
    const previous = await this.assignments.latestEndedForBooking(tx, booking.id);
    let assignment: AssignmentRecord;
    try {
      assignment = await tx.savepoint((sp) =>
        this.assignments.insert(sp, {
          bookingId: booking.id,
          photographerId: attempt.photographerId,
          blockedFrom: block.from,
          blockedUntil: block.until,
          acceptedAt: now,
          replacedAssignmentId: previous?.id ?? null,
        }),
      );
    } catch (error) {
      if (sqlState(error) === EXCLUSION_VIOLATION) return this.slotConflict(tx, attempt, now);
      if (sqlState(error) === UNIQUE_VIOLATION) {
        throw conflict('ALREADY_TAKEN', 'Another photographer accepted this booking first');
      }
      throw error;
    }
    await this.fill(tx, attempt, assignment, now);
    return { kind: 'ASSIGNED', assignment };
  }

  private async fill(
    tx: Tx,
    attempt: AttemptRecord,
    assignment: AssignmentRecord,
    now: Date,
  ): Promise<void> {
    await this.attempts.resolve(tx, attempt.id, 'ACCEPTED', now);
    await this.attempts.markLostRace(tx, attempt.bookingId, attempt.id, now);
    await this.rounds.end(tx, attempt.roundId, 'FILLED', now);
    await this.rounds.endOpen(tx, attempt.bookingId, 'CANCELLED', now);
    await this.bookings.transition(tx, {
      bookingId: attempt.bookingId,
      to: 'ASSIGNED',
      actor: { kind: 'PHOTOGRAPHER', id: attempt.photographerId },
      occurredAt: now,
      reason: 'Photographer accepted the offer',
      payload: {
        photographer_id: attempt.photographerId,
        assignment_id: assignment.id,
        dispatch_round_id: attempt.roundId,
        rank_score: attempt.rankScore,
      },
    });
  }

  /** The EXCLUDE constraint refused the slot: this offer is void; the wave may now be resolved. */
  private async slotConflict(tx: Tx, attempt: AttemptRecord, now: Date): Promise<AcceptOutcome> {
    await this.attempts.resolve(tx, attempt.id, 'CANCELLED', now, 'SLOT_CONFLICT');
    return { kind: 'SLOT_CONFLICT', timers: await this.afterResponse(tx, attempt, now) };
  }

  private async declineInTx(
    tx: Tx,
    offer: AttemptRecord,
    reason: string | null,
    now: Date,
  ): Promise<DispatchTimer[]> {
    await this.bookings.lock(tx, offer.bookingId);
    const attempt = await this.attempts.lock(tx, offer.id);
    if (!attempt || attempt.outcome === 'DECLINED') return [];
    if (attempt.outcome !== 'PENDING') {
      throw conflict('OFFER_CLOSED', 'This offer is no longer open');
    }
    if (attempt.expiresAt <= now) throw conflict('OFFER_EXPIRED', 'This offer has expired');
    await this.attempts.resolve(tx, attempt.id, 'DECLINED', now, reason);
    return this.afterResponse(tx, attempt, now);
  }

  /** Once nobody in the wave can still accept, the next wave opens immediately (ADR-0010). */
  private async afterResponse(tx: Tx, attempt: AttemptRecord, now: Date): Promise<DispatchTimer[]> {
    if ((await this.attempts.pendingCount(tx, attempt.roundId)) > 0) return [];
    const facts = await this.bookings.dispatchFacts(tx, attempt.bookingId);
    if (facts.status !== 'DISPATCHING') return [];
    await this.rounds.end(tx, attempt.roundId, 'EXHAUSTED', now);
    return this.engine.continueRun(tx, facts, now);
  }
}

function assertAttemptOpen(attempt: AttemptRecord, now: Date): void {
  if (attempt.outcome === 'ACCEPTED') {
    throw conflict('ALREADY_ACCEPTED', 'You have already accepted this booking');
  }
  if (attempt.outcome === 'LOST_RACE') {
    throw conflict('ALREADY_TAKEN', 'Another photographer accepted this booking first');
  }
  if (attempt.outcome !== 'PENDING') throw conflict('OFFER_CLOSED', 'This offer is no longer open');
  if (attempt.expiresAt <= now) throw conflict('OFFER_EXPIRED', 'This offer has expired');
}

function assertAcceptable(booking: BookingRow, attempt: AttemptRecord, now: Date): void {
  assertAttemptOpen(attempt, now);
  if (booking.status === 'ASSIGNED') {
    throw conflict('ALREADY_TAKEN', 'Another photographer accepted this booking first');
  }
  if (booking.status !== 'DISPATCHING') {
    throw conflict('OFFER_CLOSED', 'This offer is no longer open');
  }
}
