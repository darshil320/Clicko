import { type ProEarnings, ProEarnings as ProEarningsSchema } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { BookingsService } from '../bookings/bookings.service';
import { AssignmentsService } from '../dispatch/assignments.service';
import { type ProPayoutFact, ProPayoutsReader } from '../payouts/pro-payouts.reader';
import { ONSITE_CONFIG } from './onsite.config';
import { bucketEarnings } from './rules/earnings';

/** Lifetime checked-out jobs read for the totals. */
const MAX_JOBS_SCANNED = 2_000;

/** Paid, or held back: either way no longer pending. */
const isSettled = (p: ProPayoutFact | undefined): boolean =>
  p?.status === 'PAID' || p?.status === 'WITHHELD';

/**
 * G-23 earnings (ADR-0013 D13, ADR-0027 D5): what each checked-out job pays — the accepted offer
 * (incentive included) plus extension/waiting payout shares until a payout is accrued, then the
 * payout itself — plus shoots that ended without a check-out but still pay (access denied), and
 * the transfers already paid with their TDS. Payout facts come from the payouts module's own
 * reader. Pending is everything neither paid nor withheld.
 */
@Injectable()
export class EarningsService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(ProPayoutsReader) private readonly payouts: ProPayoutsReader,
  ) {}

  async forPhotographer(photographerId: string): Promise<ProEarnings> {
    const now = this.clock();
    const done = await this.assignments.checkedOutFor(photographerId, MAX_JOBS_SCANNED);
    const ids = done.map((a) => a.bookingId);
    const [offered, extras, summaries, paid] = await Promise.all([
      this.assignments.acceptedPayouts(photographerId, ids),
      this.bookings.extraPayouts(ids),
      this.bookings.offerSummaries(ids),
      this.payouts.forPhotographer(photographerId),
    ]);
    const byId = new Map(summaries.map((s) => [s.bookingId, s]));
    const jobs = done.flatMap((a) => {
      const booking = byId.get(a.bookingId);
      if (!booking || !a.checkOutAt) return [];
      const base = offered.get(a.bookingId) ?? booking.expectedPayoutPaise;
      const extra = extras.get(a.bookingId) ?? 0n;
      const payout = paid.payouts.get(a.bookingId);
      return [
        {
          a,
          booking,
          endedAt: a.checkOutAt,
          base,
          extra,
          // Once accrued, the payout says what the job pays (ADR-0027 D5).
          totalPaise: payout ? payout.payingPaise : base + extra,
          settled: isSettled(payout),
          payout,
        },
      ];
    });
    const listed = new Set(jobs.map((j) => j.a.bookingId));
    // Shoots that ended without a check-out but still pay (access denied), by when they ended.
    const unlisted = [...paid.payouts]
      .filter(([bookingId]) => !listed.has(bookingId))
      .map(([, p]) => ({ endedAt: p.outcomeAt, totalPaise: p.payingPaise, settled: isSettled(p) }));
    const totals = bucketEarnings([...jobs, ...unlisted], now);
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
        checkedOutAt: j.endedAt.toISOString(),
        basePayoutPaise: fromPaiseBigint(j.base),
        extrasPayoutPaise: fromPaiseBigint(j.extra),
        totalPayoutPaise: fromPaiseBigint(j.totalPaise),
        ...(j.payout ? { payoutStatus: j.payout.status, payoutBasis: j.payout.basis } : {}),
      })),
      paidTransfers: paid.paidTransfers,
    });
  }
}
