import { type ProEarnings, ProEarnings as ProEarningsSchema } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { BookingsService } from '../bookings/bookings.service';
import { AssignmentsService } from '../dispatch/assignments.service';
import { ONSITE_CONFIG } from './onsite.config';
import { bucketEarnings } from './rules/earnings';

/** Lifetime checked-out jobs read for the totals (pending = all of it until payouts, S8). */
const MAX_JOBS_SCANNED = 2_000;

/**
 * G-23 earnings (ADR-0013 D13): expected gross payouts for checked-out jobs — the accepted offer
 * (incentive included) plus extension/waiting payout shares. TDS, penalties and payout batches
 * arrive in S8, so everything is "expected" and pending.
 */
@Injectable()
export class EarningsService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
  ) {}

  async forPhotographer(photographerId: string): Promise<ProEarnings> {
    const now = this.clock();
    const done = await this.assignments.checkedOutFor(photographerId, MAX_JOBS_SCANNED);
    const ids = done.map((a) => a.bookingId);
    const [offered, extras, summaries] = await Promise.all([
      this.assignments.acceptedPayouts(photographerId, ids),
      this.bookings.extraPayouts(ids),
      this.bookings.offerSummaries(ids),
    ]);
    const byId = new Map(summaries.map((s) => [s.bookingId, s]));
    const jobs = done.flatMap((a) => {
      const booking = byId.get(a.bookingId);
      if (!booking || !a.checkOutAt) return [];
      const base = offered.get(a.bookingId) ?? booking.expectedPayoutPaise;
      const extra = extras.get(a.bookingId) ?? 0n;
      return [{ a, booking, checkedOutAt: a.checkOutAt, base, extra, totalPaise: base + extra }];
    });
    const totals = bucketEarnings(jobs, now);
    return ProEarningsSchema.parse({
      basis: 'EXPECTED',
      asOf: now.toISOString(),
      todayPaise: fromPaiseBigint(totals.todayPaise),
      weekPaise: fromPaiseBigint(totals.weekPaise),
      monthPaise: fromPaiseBigint(totals.monthPaise),
      pendingPayoutPaise: fromPaiseBigint(totals.pendingPaise),
      jobs: jobs.slice(0, ONSITE_CONFIG.earningsJobs).map((j) => ({
        assignmentId: j.a.id,
        bookingId: j.a.bookingId,
        bookingReference: j.booking.reference,
        categoryCode: j.booking.categoryCode,
        scheduledStart: j.booking.scheduledStart.toISOString(),
        checkedOutAt: j.checkedOutAt.toISOString(),
        basePayoutPaise: fromPaiseBigint(j.base),
        extrasPayoutPaise: fromPaiseBigint(j.extra),
        totalPayoutPaise: fromPaiseBigint(j.totalPaise),
      })),
    });
  }
}
