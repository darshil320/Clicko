import type { AdminPayoutsOverview, BookingStatus } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent, appendDomainEventOnce } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import { AssignmentReads } from '../dispatch/assignment-reads.service';
import { AssignmentsService } from '../dispatch/assignments.service';
import { PAYOUT_CONFIG } from './payouts.config';
import type { Tx } from './ports';
import { BatchesRepository } from './repositories/batches.repository';
import { PayoutsRepository } from './repositories/payouts.repository';
import { nextIstWeekStart } from './rules/ist-calendar';
import {
  DATA_LOSS_CAP,
  dataLossWithheld,
  OUTCOME_PAYOUT_RULES,
  outcomeGross,
  type PayoutBasis,
  type UndeliveredBasis,
} from './rules/outcome-payouts';

const DAY_MS = 86_400_000;

export type AccrualOutcome =
  | 'CREATED'
  | 'WITHHELD'
  | 'EXISTS'
  | 'NOT_DELIVERED'
  | 'WRONG_OUTCOME'
  | 'NO_COMPLETED_ASSIGNMENT';

/**
 * The status a staff-confirmed outcome leaves the booking in (both terminal, DOMAIN §2). A client
 * absence has none of its own — the booking is checked out and may still be uploaded to — so its
 * proof is the settled CLIENT_NON_ATTENDANCE review (see accrueForClientAbsence).
 */
const OUTCOME_STATUS: Readonly<Record<Exclude<UndeliveredBasis, 'CLIENT_ABSENT'>, BookingStatus>> =
  {
    DATA_LOSS: 'DATA_LOSS',
    ACCESS_DENIED: 'ACCESS_DENIED',
  };

interface Accrual {
  readonly bookingId: string;
  readonly basis: PayoutBasis;
  /** Delivery, the confirmed outcome, or the absent client's check-out: the T+3 anchor. */
  readonly outcomeAt: Date;
}

/**
 * Payouts (ADR-0026 D3, ADR-0027 D5): one per completed assignment, created when the booking is
 * delivered — or ends without a delivery (data loss, access denied, client absent) — and due 3
 * days after that outcome (v0.2 G-23). The full payout is the accepted offer (incentive included,
 * ADR-0012) — or the quote snapshot's expected payout when no offer is on record — plus the
 * extension and waiting payout shares (ADR-0013 D13); each outcome pays its share of it
 * (rules/outcome-payouts). Deductions and TDS are worked out when a batch is made, the same for
 * every basis. A payout that cannot be accrued raises an ops alert instead of vanishing.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
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
    return this.accrue({ bookingId, basis: 'DELIVERED', outcomeAt: facts.deliveredAt });
  }

  /**
   * Staff confirmed data loss or a denied venue (ADR-0027 D5). `outcomeAt` is the event's own
   * time, so a redelivered event computes the same payout. Idempotent per booking.
   */
  async accrueForOutcome(
    bookingId: string,
    basis: Exclude<UndeliveredBasis, 'CLIENT_ABSENT'>,
    outcomeAt: Date,
  ): Promise<AccrualOutcome> {
    const facts = await this.bookings.deliveryFacts(this.sql, bookingId);
    if (facts.status !== OUTCOME_STATUS[basis]) {
      await this.notAccrued(bookingId, basis, `the booking is ${facts.status}`);
      return 'WRONG_OUTCOME';
    }
    return this.accrue({ bookingId, basis, outcomeAt });
  }

  /**
   * T&C §3.8: the client did not attend (ADR-0013 D12). The photographer reports it, so it is paid
   * only once staff have settled the CLIENT_NON_ATTENDANCE review — the review is the proof — and
   * falls due 3 days after the check-out (at once when the review took longer). Idempotent.
   */
  async accrueForClientAbsence(bookingId: string): Promise<AccrualOutcome> {
    const facts = await this.bookings.deliveryFacts(this.sql, bookingId);
    if (!facts.slaT0) {
      await this.notAccrued(bookingId, 'CLIENT_ABSENT', 'the booking was never checked out');
      return 'WRONG_OUTCOME';
    }
    return this.accrue({ bookingId, basis: 'CLIENT_ABSENT', outcomeAt: facts.slaT0 });
  }

  private async accrue(a: Accrual): Promise<AccrualOutcome> {
    const { bookingId } = a;
    const assignment = (await this.assignmentReads.latestForBookings([bookingId])).get(bookingId);
    if (assignment?.status !== 'COMPLETED') {
      await this.notAccrued(bookingId, a.basis, 'no completed assignment');
      return 'NO_COMPLETED_ASSIGNMENT';
    }
    const photographerId = assignment.photographerId;
    const [offered, extras, [summary], dispatch] = await Promise.all([
      this.assignments.acceptedPayouts(photographerId, [bookingId]),
      this.bookings.extraPayouts([bookingId]),
      this.bookings.offerSummaries([bookingId]),
      this.bookings.dispatchFacts(this.sql, bookingId),
    ]);
    const base = offered.get(bookingId) ?? summary?.expectedPayoutPaise;
    if (base === undefined) throw new Error(`booking ${bookingId} has no expected payout`);
    const job = {
      basePaise: base,
      extrasPaise: extras.get(bookingId) ?? 0n,
      travelPaise: dispatch.payout.travelAmountPaise,
    };
    const { grossPaise, shareBps } = outcomeGross(a.basis, job);
    const eligibleAt = new Date(a.outcomeAt.getTime() + PAYOUT_CONFIG.daysAfterDelivery * DAY_MS);
    return this.sql.begin(async (tx) => {
      const withheldReason =
        a.basis === 'DATA_LOSS'
          ? await this.dataLossCapReason(tx, photographerId, bookingId, eligibleAt)
          : null;
      const row = await this.payouts.insert(tx, {
        bookingId,
        photographerId,
        grossPaise,
        eligibleAt,
        basis: a.basis,
        basisBps: shareBps,
        withheldReason,
      });
      if (!row.created) return 'EXISTS';
      const payload = {
        payout_id: row.id,
        booking_id: bookingId,
        photographer_id: photographerId,
        basis: a.basis,
        basis_bps: shareBps,
        // How the gross was reached (audit): the full payout's parts and what the basis counts.
        base_paise: fromPaiseBigint(job.basePaise),
        extras_paise: fromPaiseBigint(job.extrasPaise),
        travel_paise: fromPaiseBigint(job.travelPaise),
        includes_extras: OUTCOME_PAYOUT_RULES[a.basis].includesExtras,
        gross_paise: fromPaiseBigint(grossPaise),
        eligible_at: eligibleAt.toISOString(),
      };
      const event = { aggregateKind: 'payout', aggregateId: row.id, occurredAt: a.outcomeAt };
      if (withheldReason === null) {
        await appendDomainEvent(tx, { ...event, eventType: 'payout.created', payload });
        return 'CREATED';
      }
      await appendDomainEvent(tx, {
        ...event,
        eventType: 'payout.withheld',
        payload: { ...payload, reason: withheldReason },
      });
      // On the booking (so its page and the city-scoped feeds show it), raised now.
      await appendDomainEvent(tx, {
        eventType: 'ops.alert',
        aggregateKind: 'booking',
        aggregateId: bookingId,
        occurredAt: this.clock(),
        payload: {
          booking_id: bookingId,
          severity: 'MEDIUM',
          source_event_id: null,
          source_event_type: 'payout.withheld',
          details: { ...payload, reason: withheldReason },
        },
      });
      return 'WITHHELD';
    });
  }

  /**
   * DOMAIN §2 / G-13: a full payout on data loss at most twice per photographer a year; from the
   * third it is withheld. Counted under a per-photographer lock, so two losses at once cannot
   * both slip under the cap. Null when this one is paid.
   */
  private async dataLossCapReason(
    tx: Tx,
    photographerId: string,
    bookingId: string,
    eligibleAt: Date,
  ): Promise<string | null> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`payouts:data-loss:${photographerId}`}))`;
    const since = new Date(eligibleAt.getTime() - DATA_LOSS_CAP.windowDays * DAY_MS);
    const earlier = await this.payouts.dataLossCount(tx, photographerId, bookingId, since);
    if (!dataLossWithheld(earlier)) return null;
    return (
      `Data loss number ${earlier + 1} for this photographer in ${DATA_LOSS_CAP.windowDays} ` +
      `days: a full payout is capped at ${DATA_LOSS_CAP.incidents} a year (DOMAIN §2)`
    );
  }

  /** A money event that should have owed a payout but could not: ops looks (once per basis). */
  private async notAccrued(bookingId: string, basis: PayoutBasis, why: string): Promise<void> {
    this.logger.warn(`booking ${bookingId} (${basis}): no payout, ${why}`);
    const now = this.clock();
    await this.sql.begin((tx) =>
      appendDomainEventOnce(tx, {
        eventType: 'ops.alert',
        aggregateKind: 'booking',
        aggregateId: bookingId,
        occurredAt: now,
        dedupeKey: `payout.not_accrued:${basis}`,
        payload: {
          booking_id: bookingId,
          severity: 'HIGH',
          source_event_id: null,
          source_event_type: 'payout.not_accrued',
          details: { basis, why },
        },
      }),
    );
  }

  /**
   * Finance pays a withheld payout after all (ADR-0027 D5): WITHHELD → PENDING, falling due at
   * once if its date has passed. The caller verified a fresh authenticator code; the audit row
   * commits with the change.
   */
  async releaseWithheld(r: {
    readonly payoutId: string;
    readonly staffId: string;
    readonly note: string;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<{ payoutId: string; eligibleAt: Date }> {
    return this.sql.begin(async (tx) => {
      const held = await this.payouts.lockForRelease(tx, r.payoutId);
      if (!held) {
        throw new NotFoundException({ code: 'PAYOUT_NOT_FOUND', message: 'Payout not found' });
      }
      if (held.status !== 'WITHHELD') {
        throw new ConflictException({
          code: 'PAYOUT_NOT_WITHHELD',
          message: 'This payout is no longer held back',
        });
      }
      await this.payouts.releaseWithheld(tx, r.payoutId);
      await appendDomainEvent(tx, {
        eventType: 'payout.released',
        aggregateKind: 'payout',
        aggregateId: r.payoutId,
        occurredAt: r.now,
        payload: {
          payout_id: r.payoutId,
          booking_id: held.bookingId,
          photographer_id: held.photographerId,
          gross_paise: fromPaiseBigint(held.grossPaise),
          released_by: r.staffId,
        },
      });
      await r.audit(tx, {
        before: { status: 'WITHHELD', reason: held.withheldReason },
        after: { status: 'PENDING', note: r.note, gross_paise: fromPaiseBigint(held.grossPaise) },
      });
      return { payoutId: r.payoutId, eligibleAt: held.eligibleAt };
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
