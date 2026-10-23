import type { DispatchDeskView } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { PhotographersService } from '../photographers/photographers.service';
import { AssignmentsRepository } from './repositories/assignments.repository';
import { AttemptsRepository } from './repositories/attempts.repository';
import { RoundsRepository } from './repositories/rounds.repository';
import { toDeskView } from './views';

/** Rounds, offers and assignments for one booking — the ops console's dispatch desk (dev only). */
@Injectable()
export class DispatchDeskService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(RoundsRepository) private readonly rounds: RoundsRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(AssignmentsRepository) private readonly assignments: AssignmentsRepository,
  ) {}

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
