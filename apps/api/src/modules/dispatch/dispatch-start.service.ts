import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import type { DispatchTimer, Tx } from './dispatch.types';
import { DispatchEngine } from './dispatch-engine.service';
import { AttemptsRepository } from './repositories/attempts.repository';
import { RoundsRepository } from './repositories/rounds.repository';
import { DispatchTimerScheduler } from './timer-scheduler';

/**
 * Outbox-driven entry points. `booking.confirmed` → CONFIRMED → DISPATCHING and the first wave;
 * a cancellation closes any open offers. Both are safe to receive twice.
 */
@Injectable()
export class DispatchStartService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(DispatchEngine) private readonly engine: DispatchEngine,
    @Inject(RoundsRepository) private readonly rounds: RoundsRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(DispatchTimerScheduler) private readonly timers: DispatchTimerScheduler,
  ) {}

  /**
   * Scheduling failures throw: the event stays unpublished and the redelivery re-arms the timers
   * of the run already started (it never opens a second one).
   */
  async onConfirmed(bookingId: string): Promise<void> {
    const now = this.clock();
    const timers = await this.sql.begin((tx) => this.startInTx(tx, bookingId, now));
    await this.timers.schedule(timers);
  }

  /** The booking left dispatch for good: nobody may accept a stale offer. */
  async onCancelled(bookingId: string): Promise<void> {
    const now = this.clock();
    await this.sql.begin(async (tx) => {
      await this.attempts.cancelPending(tx, bookingId);
      await this.rounds.endOpen(tx, bookingId, 'CANCELLED', now);
    });
  }

  private async startInTx(tx: Tx, bookingId: string, now: Date): Promise<DispatchTimer[]> {
    const booking = await this.bookings.lock(tx, bookingId);
    if (booking.status === 'DISPATCHING') {
      return this.engine.pendingTimers(tx, await this.bookings.dispatchFacts(tx, bookingId), now);
    }
    if (booking.status !== 'CONFIRMED') return [];
    await this.bookings.transition(tx, {
      bookingId,
      to: 'DISPATCHING',
      actor: SYSTEM_ACTOR,
      occurredAt: now,
      reason: 'Dispatch started',
    });
    const facts = await this.bookings.dispatchFacts(tx, bookingId);
    return this.engine.startRun(tx, facts, 'INITIAL', now);
  }
}
