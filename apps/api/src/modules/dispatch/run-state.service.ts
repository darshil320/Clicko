import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import type { DispatchFacts } from '../bookings/bookings.types';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import { PricingService } from '../pricing/pricing.service';
import type { RoundRecord, Tx } from './dispatch.types';
import { AssignmentsRepository } from './repositories/assignments.repository';
import { AttemptsRepository } from './repositories/attempts.repository';
import { RoundsRepository } from './repositories/rounds.repository';
import { currentRun, type RunKind, terminalFor } from './wave-plan';

/**
 * What the current search is (ADR-0012 D5/D6) and how it ends. The kind is derived from the
 * booking's history: no ended assignment ⇒ INITIAL; the latest ended one RELEASED ⇒ a
 * replacement after a cancellation; ABANDONED ⇒ a no-show replacement.
 */
@Injectable()
export class DispatchRunState {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(RoundsRepository) private readonly rounds: RoundsRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(AssignmentsRepository) private readonly assignments: AssignmentsRepository,
  ) {}

  async kind(tx: Tx, bookingId: string): Promise<RunKind> {
    const ended = await this.assignments.latestEndedForBooking(tx, bookingId);
    if (!ended) return 'INITIAL';
    return ended.status === 'ABANDONED' ? 'NO_SHOW' : 'PRO_CANCELLED';
  }

  async currentRun(tx: Tx, bookingId: string): Promise<RoundRecord[]> {
    return currentRun(await this.rounds.forBooking(tx, bookingId));
  }

  /** The run's offer: the snapshot payout, or the no-show incentive computed by pricing. */
  payoutFor(facts: DispatchFacts, kind: RunKind): bigint {
    return kind === 'NO_SHOW'
      ? this.pricing.noShowPayoutPaise(facts.payout)
      : facts.expectedPayoutPaise;
  }

  /** scheduled_start − auto_refund_minutes_before of the booking's own ruleset (ADR-0012 D1). */
  async deadline(facts: DispatchFacts): Promise<Date> {
    const minutes = await this.pricing.autoRefundMinutesBefore(
      facts.rulesetId,
      facts.emergencyBand,
    );
    return new Date(facts.scheduledStart.getTime() - minutes * 60_000);
  }

  /**
   * Whether the deadline governs this run. Always for the first search; for a replacement only
   * if it started before the deadline — a no-show (or a late cancellation) re-broadcast that
   * starts after it runs its waves and ends by exhaustion instead.
   */
  deadlineApplies(kind: RunKind, runStartedAt: Date | null, deadline: Date): boolean {
    return kind === 'INITIAL' || (runStartedAt !== null && runStartedAt < deadline);
  }

  /** Closes the search and ends the booking (caller holds the booking lock). */
  async terminate(tx: Tx, bookingId: string, kind: RunKind, now: Date, why: string): Promise<void> {
    const outcome = terminalFor(kind);
    await this.attempts.cancelPending(tx, bookingId);
    await this.rounds.endOpen(tx, bookingId, 'CANCELLED', now);
    await this.bookings.transition(tx, {
      bookingId,
      to: outcome.to,
      actor: SYSTEM_ACTOR,
      occurredAt: now,
      reason: why,
      cancellationReason: outcome.reason,
      payload: { reason: outcome.reason, run_kind: kind },
    });
  }
}
