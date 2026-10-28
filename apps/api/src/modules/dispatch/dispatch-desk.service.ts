import type { DispatchDeskView } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { PhotographersService } from '../photographers/photographers.service';
import { AssignmentsRepository } from './repositories/assignments.repository';
import { AttemptsRepository } from './repositories/attempts.repository';
import { RoundsRepository } from './repositories/rounds.repository';
import { DispatchRunState } from './run-state.service';
import { toDeskView } from './views';
import { currentRun } from './wave-plan';

/** Where a DISPATCHING booking's search stands, for the staff dispatch desk (ADR-0025 D5). */
export interface DispatchQueueFacts {
  /** The current run's latest wave (0 before the first round opens). */
  readonly wave: number;
  /** Every wave of the current run ended unfilled (dispatch.exhausted). */
  readonly exhausted: boolean;
  readonly pendingOffers: number;
  /** start − auto_refund_minutes_before of the booking's ruleset (ADR-0012 D1). */
  readonly deadlineAt: Date;
}

/** Rounds, offers and assignments for one booking — the dispatch desk (staff panel + dev console). */
@Injectable()
export class DispatchDeskService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(RoundsRepository) private readonly rounds: RoundsRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(AssignmentsRepository) private readonly assignments: AssignmentsRepository,
    @Inject(DispatchRunState) private readonly runs: DispatchRunState,
  ) {}

  /** One small read per booking: the queue is the DISPATCHING bookings of the caller's cities. */
  async queue(bookingIds: readonly string[]): Promise<Map<string, DispatchQueueFacts>> {
    const entries = await Promise.all(
      bookingIds.map(async (id) => [id, await this.queueFacts(id)] as const),
    );
    return new Map(entries);
  }

  private async queueFacts(bookingId: string): Promise<DispatchQueueFacts> {
    const facts = await this.bookings.dispatchFacts(this.sql, bookingId);
    const [rounds, attempts, deadlineAt] = await Promise.all([
      this.rounds.forBooking(this.sql, bookingId),
      this.attempts.forBooking(this.sql, bookingId),
      this.runs.deadline(facts),
    ]);
    const run = currentRun(rounds);
    const last = run.at(-1);
    const open = new Set(run.filter((r) => r.endedAt === null).map((r) => r.id));
    return {
      wave: last?.wave ?? 0,
      exhausted: last !== undefined && last.endedAt !== null && last.outcome === 'EXHAUSTED',
      pendingOffers: attempts.filter((a) => a.outcome === 'PENDING' && open.has(a.roundId)).length,
      deadlineAt,
    };
  }

  async view(bookingId: string): Promise<DispatchDeskView> {
    const facts = await this.bookings.dispatchFacts(this.sql, bookingId);
    const [rounds, attempts, assignments] = await Promise.all([
      this.rounds.forBooking(this.sql, bookingId),
      this.attempts.forBooking(this.sql, bookingId),
      this.assignments.forBooking(this.sql, bookingId),
    ]);
    const names = await this.photographers.displayNames([
      ...attempts.map((a) => a.photographerId),
      ...assignments.map((a) => a.photographerId),
    ]);
    return toDeskView({ bookingId, status: facts.status, rounds, attempts, assignments, names });
  }
}
