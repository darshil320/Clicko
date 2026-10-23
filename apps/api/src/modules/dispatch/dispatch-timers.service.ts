import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { DISPATCH_CONFIG } from './dispatch.config';
import type { DispatchTimer, Tx } from './dispatch.types';
import { DispatchEngine } from './dispatch-engine.service';
import { AttemptsRepository } from './repositories/attempts.repository';
import { RoundsRepository } from './repositories/rounds.repository';
import { DispatchRunState } from './run-state.service';
import { DispatchTimerScheduler } from './timer-scheduler';
import { waveClosesAt } from './wave-plan';

const errorName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

/**
 * What the BullMQ dispatch jobs do (src/jobs/). Each handler re-reads state under the booking lock
 * and is a no-op when the world has moved on (filled, cancelled, already expired) — jobs may run
 * twice or late. A job that fires early re-arms itself under a fresh job id.
 */
@Injectable()
export class DispatchTimersService {
  private readonly logger = new Logger(DispatchTimersService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(DispatchEngine) private readonly engine: DispatchEngine,
    @Inject(DispatchRunState) private readonly runs: DispatchRunState,
    @Inject(RoundsRepository) private readonly rounds: RoundsRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(DispatchTimerScheduler) private readonly timers: DispatchTimerScheduler,
  ) {}

  /** A wave's window closed: unanswered offers EXPIRE, and the cascade moves on. */
  async expireRound(roundId: string): Promise<void> {
    const ref = await this.rounds.find(this.sql, roundId);
    if (!ref || ref.endedAt) return;
    const now = this.clock();
    const timers = await this.sql.begin((tx) => this.expireInTx(tx, ref.bookingId, roundId, now));
    await this.timers.schedule(timers);
  }

  /**
   * ADR-0012 D1: a booking still DISPATCHING at start − auto_refund_minutes_before is ended —
   * CANCELLED_PRO (or PRO_NO_SHOW for a no-show replacement). Money follows via the outbox.
   */
  async deadline(bookingId: string): Promise<void> {
    const now = this.clock();
    const timers = await this.sql.begin((tx) => this.deadlineInTx(tx, bookingId, now));
    await this.timers.schedule(timers);
  }

  /**
   * The backup for lost jobs (enqueue failed after commit): closes overdue waves, and ends
   * DISPATCHING bookings that are past their deadline.
   */
  async sweep(): Promise<number> {
    const now = this.clock();
    const cutoff = new Date(now.getTime() - DISPATCH_CONFIG.sweepGraceSeconds * 1000);
    const overdue = await this.rounds.overdue(this.sql, cutoff, DISPATCH_CONFIG.sweepBatchSize);
    const horizon = new Date(now.getTime() + DISPATCH_CONFIG.deadlineSweepHorizonMinutes * 60_000);
    const due = await this.bookings.dispatchingStartingBefore(
      horizon,
      DISPATCH_CONFIG.sweepBatchSize,
    );
    for (const roundId of overdue)
      await this.safely(`round ${roundId}`, () => this.expireRound(roundId));
    for (const bookingId of due)
      await this.safely(`booking ${bookingId}`, () => this.deadline(bookingId));
    return overdue.length + due.length;
  }

  private async safely(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(`Sweep failed on ${what} (${errorName(error)})`);
    }
  }

  private async expireInTx(
    tx: Tx,
    bookingId: string,
    roundId: string,
    now: Date,
  ): Promise<DispatchTimer[]> {
    const booking = await this.bookings.lock(tx, bookingId);
    const round = await this.rounds.lock(tx, roundId);
    if (!round || round.endedAt) return [];
    if (booking.status !== 'DISPATCHING') {
      await this.attempts.cancelPending(tx, bookingId);
      await this.rounds.end(tx, roundId, 'CANCELLED', now);
      return [];
    }
    const closesAt = waveClosesAt(round);
    if (now < closesAt) return [{ kind: 'WAVE_EXPIRY', roundId, at: closesAt, rearm: true }];
    await this.attempts.expirePending(tx, roundId);
    await this.rounds.end(tx, roundId, 'EXHAUSTED', now);
    return this.engine.continueRun(tx, await this.bookings.dispatchFacts(tx, bookingId), now);
  }

  private async deadlineInTx(tx: Tx, bookingId: string, now: Date): Promise<DispatchTimer[]> {
    const booking = await this.bookings.lock(tx, bookingId);
    if (booking.status !== 'DISPATCHING') return [];
    const facts = await this.bookings.dispatchFacts(tx, bookingId);
    const deadline = await this.runs.deadline(facts);
    if (now < deadline) return [{ kind: 'DEADLINE', bookingId, at: deadline, rearm: true }];
    const kind = await this.runs.kind(tx, bookingId);
    const run = await this.runs.currentRun(tx, bookingId);
    if (!this.runs.deadlineApplies(kind, run[0]?.startedAt ?? null, deadline)) return [];
    await this.runs.terminate(
      tx,
      bookingId,
      kind,
      now,
      'No photographer accepted before the deadline',
    );
    return [];
  }
}
