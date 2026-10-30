import type { AdminPayoutsOverview } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import { AssignmentReads } from '../dispatch/assignment-reads.service';
import { AssignmentsService } from '../dispatch/assignments.service';
import { PAYOUT_CONFIG } from './payouts.config';
import { BatchesRepository } from './repositories/batches.repository';
import { PayoutsRepository } from './repositories/payouts.repository';
import { nextIstWeekStart } from './rules/ist-calendar';

const DAY_MS = 86_400_000;

export type AccrualOutcome = 'CREATED' | 'EXISTS' | 'NOT_DELIVERED' | 'NO_COMPLETED_ASSIGNMENT';

/**
 * Payouts (ADR-0026 D3): one per completed assignment, created when the booking is delivered and
 * due 3 days later (v0.2 G-23). Gross = the accepted offer (incentive included, ADR-0012) — or
 * the quote snapshot's expected payout when no offer is on record — plus the extension and
 * waiting payout shares (ADR-0013 D13). Deductions and TDS are worked out when a batch is made.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentReads) private readonly assignmentReads: AssignmentReads,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(PayoutsRepository) private readonly payouts: PayoutsRepository,
    @Inject(BatchesRepository) private readonly batches: BatchesRepository,
  ) {}

  /** Idempotent: the `booking.delivered` subscriber is at-least-once. */
  async accrueForDelivery(bookingId: string): Promise<AccrualOutcome> {
    const facts = await this.bookings.deliveryFacts(this.sql, bookingId);
    if (!facts.deliveredAt) return 'NOT_DELIVERED';
    const assignment = (await this.assignmentReads.latestForBookings([bookingId])).get(bookingId);
    if (assignment?.status !== 'COMPLETED') {
      this.logger.warn(`booking ${bookingId} delivered without a completed assignment: no payout`);
      return 'NO_COMPLETED_ASSIGNMENT';
    }
    const photographerId = assignment.photographerId;
    const [offered, extras, [summary]] = await Promise.all([
      this.assignments.acceptedPayouts(photographerId, [bookingId]),
      this.bookings.extraPayouts([bookingId]),
      this.bookings.offerSummaries([bookingId]),
    ]);
    const base = offered.get(bookingId) ?? summary?.expectedPayoutPaise;
    if (base === undefined) throw new Error(`booking ${bookingId} has no expected payout`);
    const grossPaise = base + (extras.get(bookingId) ?? 0n);
    const eligibleAt = new Date(
      facts.deliveredAt.getTime() + PAYOUT_CONFIG.daysAfterDelivery * DAY_MS,
    );
    return this.sql.begin(async (tx) => {
      const row = await this.payouts.insert(tx, {
        bookingId,
        photographerId,
        grossPaise,
        eligibleAt,
      });
      if (!row.created) return 'EXISTS';
      await appendDomainEvent(tx, {
        eventType: 'payout.created',
        aggregateKind: 'payout',
        aggregateId: row.id,
        occurredAt: facts.deliveredAt ?? eligibleAt,
        payload: {
          payout_id: row.id,
          booking_id: bookingId,
          photographer_id: photographerId,
          gross_paise: fromPaiseBigint(grossPaise),
          eligible_at: eligibleAt.toISOString(),
        },
      });
      return 'CREATED';
    });
  }

  /**
   * TODAY PAGE HOOK (ADR-0026 D8): payouts not yet in a batch and due before next Monday's run
   * (IST), and exported batches still waiting for their UTRs. Two cheap aggregate queries.
   */
  async overviewCount(now: Date): Promise<AdminPayoutsOverview> {
    const [due, awaiting] = await Promise.all([
      this.payouts.dueCount(this.sql, nextIstWeekStart(now)),
      this.batches.awaitingPaymentCount(this.sql),
    ]);
    return {
      dueThisWeek: { payoutCount: due.count, grossPaise: due.grossPaise },
      batchesAwaitingPayment: awaiting,
    };
  }
}
