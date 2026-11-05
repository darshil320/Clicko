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
  cancellationPayout,
  DATA_LOSS_CAP,
  dataLossWithheld,
  type FixedShareBasis,
  type JobPayout,
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
  | 'NO_COMPLETED_ASSIGNMENT'
  | 'NO_RELEASED_ASSIGNMENT'
  | 'NOTHING_OWED';

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
  readonly basis: FixedShareBasis;
  /** Delivery, the confirmed outcome, or the absent client's check-out: the T+3 anchor. */
  readonly outcomeAt: Date;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
/** A recorded paise figure: a non-negative safe integer, or null. */
const paiseOf = (v: unknown): bigint | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;

/** What gets written: a payout row, and the parts that explain its gross (audit). */
interface PayoutToWrite {
  readonly bookingId: string;
  readonly photographerId: string;
  readonly basis: PayoutBasis;
  readonly shareBps: number;
  readonly grossPaise: bigint;
  readonly job: JobPayout;
  readonly includesExtras: boolean;
  readonly outcomeAt: Date;
  /** Extra audit fields on the payout event. */
  readonly details?: Readonly<Record<string, string | number>>;
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

  /**
   * A client cancelled after this photographer accepted (CANCELLED_CLIENT from ASSIGNED / EN_ROUTE).
   * They are owed their share of what the client was charged (rules/outcome-payouts,
   * CLIENT_CANCELLATION_PAYOUT — owner-overridable); nothing kept, nothing owed. Every figure comes
   * from the cancellation as its status event recorded it — never from the outbox payload — and
   * what was kept can never exceed the advance (security review L2). The assignment must be the
   * one the cancellation released. Idempotent: one payout per booking and photographer.
   */
  async accrueForClientCancellation(bookingId: string): Promise<AccrualOutcome> {
    const [facts, recorded] = await Promise.all([
      this.bookings.deliveryFacts(this.sql, bookingId),
      this.bookings.clientCancellation(bookingId),
    ]);
    const m = recorded?.metadata ?? {};
    if (facts.status !== 'CANCELLED_CLIENT' || recorded?.actorKind !== 'USER') {
      await this.notAccrued(bookingId, 'CLIENT_CANCELLED', `the booking is ${facts.status}`);
      return 'WRONG_OUTCOME';
    }
    const photographerId = str(m.photographer_id);
    const assignmentId = str(m.assignment_id);
    const keptPaise = paiseOf(m.kept_paise);
    if (m.reason !== 'CLIENT_CANCELLED' || !photographerId || !assignmentId) return 'NOTHING_OWED';
    if (keptPaise === null || keptPaise > facts.advancePaise) {
      await this.notAccrued(bookingId, 'CLIENT_CANCELLED', 'the recorded amount kept is invalid');
      return 'WRONG_OUTCOME';
    }
    const latest = (await this.assignmentReads.latestForBookings([bookingId])).get(bookingId);
    if (
      latest?.assignmentId !== assignmentId ||
      latest.photographerId !== photographerId ||
      latest.status !== 'RELEASED'
    ) {
      await this.notAccrued(bookingId, 'CLIENT_CANCELLED', 'not the released assignment');
      return 'NO_RELEASED_ASSIGNMENT';
    }
    const job = await this.jobPayout(bookingId, photographerId, false);
    const { grossPaise, shareBps } = cancellationPayout(job, {
      keptPaise,
      bookingTotalPaise: facts.totalPaise,
      enRoute: recorded.fromStatus === 'EN_ROUTE',
    });
    if (grossPaise <= 0n) return 'NOTHING_OWED';
    return this.write({
      bookingId,
      photographerId,
      basis: 'CLIENT_CANCELLED',
      shareBps,
      grossPaise,
      job,
      includesExtras: false,
      outcomeAt: recorded.occurredAt,
      details: {
        kept_paise: fromPaiseBigint(keptPaise),
        booking_total_paise: fromPaiseBigint(facts.totalPaise),
        cancelled_from: recorded.fromStatus ?? '',
      },
    });
  }

  /** The full payout's parts: the accepted offer (or the quote's), extras and travel. */
  private async jobPayout(
    bookingId: string,
    photographerId: string,
    withExtras: boolean,
  ): Promise<JobPayout> {
    const [offered, extras, [summary], dispatch] = await Promise.all([
      this.assignments.acceptedPayouts(photographerId, [bookingId]),
      withExtras ? this.bookings.extraPayouts([bookingId]) : Promise.resolve(new Map()),
      this.bookings.offerSummaries([bookingId]),
      this.bookings.dispatchFacts(this.sql, bookingId),
    ]);
    const base = offered.get(bookingId) ?? summary?.expectedPayoutPaise;
    if (base === undefined) throw new Error(`booking ${bookingId} has no expected payout`);
    return {
      basePaise: base,
      extrasPaise: extras.get(bookingId) ?? 0n,
      travelPaise: dispatch.payout.travelAmountPaise,
    };
  }

  private async accrue(a: Accrual): Promise<AccrualOutcome> {
    const { bookingId } = a;
    const assignment = (await this.assignmentReads.latestForBookings([bookingId])).get(bookingId);
    if (assignment?.status !== 'COMPLETED') {
      await this.notAccrued(bookingId, a.basis, 'no completed assignment');
      return 'NO_COMPLETED_ASSIGNMENT';
    }
    const job = await this.jobPayout(bookingId, assignment.photographerId, true);
    const { grossPaise, shareBps } = outcomeGross(a.basis, job);
    return this.write({
      bookingId,
      photographerId: assignment.photographerId,
      basis: a.basis,
      shareBps,
      grossPaise,
      job,
      includesExtras: OUTCOME_PAYOUT_RULES[a.basis].includesExtras,
      outcomeAt: a.outcomeAt,
    });
  }

  /** The payout row and its event, due 3 days after the outcome (v0.2 G-23). */
  private async write(p: PayoutToWrite): Promise<AccrualOutcome> {
    const { bookingId, photographerId, job } = p;
    const eligibleAt = new Date(p.outcomeAt.getTime() + PAYOUT_CONFIG.daysAfterDelivery * DAY_MS);
    return this.sql.begin(async (tx) => {
      const withheldReason =
        p.basis === 'DATA_LOSS'
          ? await this.dataLossCapReason(tx, photographerId, bookingId, eligibleAt)
          : null;
      const row = await this.payouts.insert(tx, {
        bookingId,
        photographerId,
        grossPaise: p.grossPaise,
        eligibleAt,
        basis: p.basis,
        basisBps: p.shareBps,
        withheldReason,
      });
      if (!row.created) return 'EXISTS';
      const payload = {
        payout_id: row.id,
        booking_id: bookingId,
        photographer_id: photographerId,
        basis: p.basis,
        basis_bps: p.shareBps,
        // How the gross was reached (audit): the full payout's parts and what the basis counts.
        base_paise: fromPaiseBigint(job.basePaise),
        extras_paise: fromPaiseBigint(job.extrasPaise),
        travel_paise: fromPaiseBigint(job.travelPaise),
        includes_extras: p.includesExtras,
        gross_paise: fromPaiseBigint(p.grossPaise),
        eligible_at: eligibleAt.toISOString(),
        ...(p.details ?? {}),
      };
      const event = { aggregateKind: 'payout', aggregateId: row.id, occurredAt: p.outcomeAt };
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
