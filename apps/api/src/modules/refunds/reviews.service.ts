import { Uuid } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import type { IdSubquery } from '../../infra/db/id-subquery';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import type { AdminBookingFacts } from '../bookings/bookings.types';
import { type AlertRecord, OpsAlertsReader } from '../ops/ops-alerts.reader';
import { type BreachRecord, isOwed } from '../sla/sla.public';
import { SlaDeskService } from '../sla/sla-desk.service';
import { BookingMoneyReader } from './booking-money.reader';
import { CreditsService } from './credits.service';
import type { CreditReasonCode, RefundReasonCode } from './refunds.config';
import { RefundsService } from './refunds.service';
import type { CreditRecord, MoneyActor, RefundRecord, ResolutionRecord, Tx } from './refunds.types';
import { RefundsRepository } from './repositories/refunds.repository';
import { ResolutionsRepository } from './repositories/resolutions.repository';
import { type ReviewOutcome, type Suggestion, suggestOutcome } from './review-suggestions';

export type SettleDecision =
  | {
      readonly outcome: 'REFUND_REQUESTED';
      readonly amountPaise: bigint;
      readonly refundReason: RefundReasonCode;
      readonly creditPaise: bigint;
      readonly note: string;
    }
  | {
      readonly outcome: 'CREDIT_ISSUED';
      readonly amountPaise: bigint;
      readonly creditReason: CreditReasonCode;
      readonly note: string;
    }
  | { readonly outcome: 'CHARGE_RAISED'; readonly amountPaise: bigint; readonly note: string }
  | { readonly outcome: 'NO_ACTION'; readonly note: string };

export interface ReviewContext {
  readonly review: AlertRecord;
  readonly booking: AdminBookingFacts | null;
  readonly paymentId: string | null;
  readonly paidPaise: bigint;
  readonly refundablePaise: bigint;
  readonly breach: BreachRecord | null;
  readonly suggestion: Suggestion;
  readonly resolution: ResolutionRecord | null;
  readonly refunds: readonly RefundRecord[];
}

export interface ReviewPageInput {
  readonly bookings: IdSubquery | null;
  readonly status: 'OPEN' | 'SETTLED' | 'ALL';
  readonly after?: { readonly occurredAt: Date; readonly seq: string };
  readonly limit: number;
}

const NOT_FOUND = { code: 'REVIEW_NOT_FOUND', message: 'This item was not found' };

const uuidIn = (details: Readonly<Record<string, unknown>>, key: string): string | null => {
  const v = details[key];
  return typeof v === 'string' && Uuid.safeParse(v).success ? v : null;
};

/** The apology credit that rides on a refund outcome, by refund reason. */
const CREDIT_WITH_REFUND: Partial<Record<RefundReasonCode, CreditReasonCode>> = {
  PRO_NO_SHOW: 'PRO_NO_SHOW',
  SLA_BREACH: 'SLA_BREACH',
  QUALITY: 'QUALITY',
};

/**
 * Review items (ADR-0026 D2): the `*.needs_review` events, read through the ops module, each
 * settled exactly once (review_resolutions) with an outcome and a note. A refund outcome raises
 * refund requests (approved on the refund desk, four-eyes); a credit is issued at once; a charge
 * is recorded only. A late delivery (SLA_BREACH_REMEDY) settles by the ADR-0016 table and applies
 * the breach (`applied_at`, the payout deduction) in the same transaction.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OpsAlertsReader) private readonly reader: OpsAlertsReader,
    @Inject(ResolutionsRepository) private readonly resolutions: ResolutionsRepository,
    @Inject(RefundsRepository) private readonly refundRows: RefundsRepository,
    @Inject(RefundsService) private readonly refunds: RefundsService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(BookingMoneyReader) private readonly money: BookingMoneyReader,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(SlaDeskService) private readonly sla: SlaDeskService,
  ) {}

  page(q: ReviewPageInput): Promise<AlertRecord[]> {
    return this.reader.reviewPage({ ...q, settled: this.resolutions.settledEventIds(this.sql) });
  }

  /** Open review items in scope — the Today page and the nav count (ADR-0026 D8). */
  countOpen(bookings: IdSubquery | null): Promise<number> {
    return this.reader.reviewCount({
      bookings,
      status: 'OPEN',
      settled: this.resolutions.settledEventIds(this.sql),
    });
  }

  async find(eventId: string): Promise<AlertRecord | null> {
    return Uuid.safeParse(eventId).success ? this.reader.review(eventId) : null;
  }

  /** Everything a desk needs per item: booking money, the breach, the suggestion, the settlement. */
  async describe(reviews: readonly AlertRecord[]): Promise<ReviewContext[]> {
    const bookingIds = [...new Set(reviews.flatMap((r) => (r.bookingId ? [r.bookingId] : [])))];
    const [facts, money, settled] = await Promise.all([
      this.bookings.adminFacts(bookingIds),
      Promise.all(bookingIds.map(async (id) => [id, await this.money.facts(id)] as const)),
      this.resolutions.byEventIds(
        this.sql,
        reviews.map((r) => r.eventId),
      ),
    ]);
    const byBooking = new Map(facts.map((b) => [b.id, b]));
    const moneyBy = new Map(money);
    const resolutionBy = new Map(settled.map((s) => [s.reviewEventId, s]));
    const refunds = await this.refundRows.forResolutions(
      this.sql,
      settled.map((s) => s.id),
    );
    return Promise.all(
      reviews.map(async (review) => {
        const booking = review.bookingId ? (byBooking.get(review.bookingId) ?? null) : null;
        const m = review.bookingId ? moneyBy.get(review.bookingId) : undefined;
        const paymentId = uuidIn(review.details, 'payment_id');
        const breachId = uuidIn(review.details, 'breach_id');
        const breach = breachId ? await this.sla.breach(breachId) : null;
        const target = paymentId ? m?.targets.find((t) => t.id === paymentId) : undefined;
        const paidPaise = m ? m.paidPaise - m.refundedPaise - m.inFlightPaise : 0n;
        const refundablePaise = paymentId
          ? (target?.refundablePaise ?? 0n)
          : (m?.refundablePaise ?? 0n);
        const total = booking?.totalPaise ?? 0n;
        const owes = booking ? total - booking.amountPaidPaise : 0n;
        const resolution = resolutionBy.get(review.eventId) ?? null;
        return {
          review,
          booking,
          paymentId,
          paidPaise,
          refundablePaise,
          breach,
          resolution,
          refunds: resolution ? refunds.filter((r) => r.reviewResolutionId === resolution.id) : [],
          suggestion: suggestOutcome({
            type: review.type,
            reason: review.reason ?? '',
            details: review.details,
            bookingTotalPaise: total,
            netPaidPaise: paidPaise,
            refundablePaise,
            balanceDuePaise: owes > 0n ? owes : 0n,
            breach: breach
              ? {
                  remedyKind: breach.remedyKind,
                  remedyPaise: breach.remedyPaise,
                  owed: isOwed(breach),
                }
              : null,
          }),
        };
      }),
    );
  }

  /** Settles a review item exactly once, in one transaction with every money effect. */
  async settle(
    eventId: string,
    decision: SettleDecision,
    actor: MoneyActor,
    hook?: TxHook,
  ): Promise<ResolutionRecord> {
    const review = await this.find(eventId);
    if (!review) throw new NotFoundException(NOT_FOUND);
    const breachId = uuidIn(review.details, 'breach_id');
    const paymentId = uuidIn(review.details, 'payment_id');
    return this.sql.begin(async (tx) => {
      if (review.bookingId) await this.bookings.lock(tx, review.bookingId);
      if (review.reason === 'SLA_BREACH_REMEDY' && !breachId) {
        throw new ConflictException({
          code: 'BREACH_MISSING',
          message: 'This late-delivery item has no breach to settle; ask an engineer to look',
        });
      }
      const breach =
        breachId && review.reason === 'SLA_BREACH_REMEDY'
          ? await this.sla.lockForRemedy(tx, breachId)
          : null;
      if (breach) {
        const refundable = review.bookingId
          ? (await this.money.refundTargets(tx, review.bookingId)).reduce(
              (sum, t) => sum + t.refundablePaise,
              0n,
            )
          : 0n;
        assertBreachDecision(breach, decision, refundable);
      }
      const needsBooking =
        decision.outcome === 'REFUND_REQUESTED' || decision.outcome === 'CREDIT_ISSUED';
      if (needsBooking && !review.bookingId) {
        throw new ConflictException({
          code: 'REVIEW_HAS_NO_BOOKING',
          message: 'Money can only be settled on an item about a booking',
        });
      }
      const credit = await this.creditFor(tx, review.bookingId, decision, actor);
      const now = this.clock();
      const resolution = await this.resolutions.insert(tx, {
        reviewEventId: review.eventId,
        reviewType: review.type,
        reason: review.reason ?? review.type,
        bookingId: review.bookingId,
        outcome: decision.outcome,
        amountPaise: decision.outcome === 'NO_ACTION' ? null : decision.amountPaise,
        creditId: credit?.id ?? null,
        breachId: breach?.id ?? null,
        note: decision.note,
        resolvedBy: actor.staffId,
        resolvedAt: now,
      });
      if (!resolution) {
        throw new ConflictException({
          code: 'REVIEW_ALREADY_SETTLED',
          message: 'Someone already settled this item',
        });
      }
      const refunds =
        decision.outcome === 'REFUND_REQUESTED' && review.bookingId
          ? await this.refunds.requestIn(tx, {
              bookingId: review.bookingId,
              amountPaise: decision.amountPaise,
              reasonCode: decision.refundReason,
              note: decision.note,
              ...(paymentId ? { paymentId } : {}),
              staffId: actor.staffId,
              reviewResolutionId: resolution.id,
            })
          : [];
      // A credit remedy is applied now. A refund remedy is applied when its refund completes
      // (RefundsService): a rejected or failed refund leaves the breach owed (domain review M1).
      if (breach && isOwed(breach) && decision.outcome === 'CREDIT_ISSUED') {
        await this.sla.markRemedyApplied(tx, breach, actor.staffId, now);
      }
      await appendDomainEvent(tx, {
        eventType: 'review.settled',
        aggregateKind: review.bookingId ? 'booking' : 'review',
        aggregateId: review.bookingId ?? review.eventId,
        occurredAt: now,
        payload: {
          review_event_id: review.eventId,
          booking_id: review.bookingId,
          reason: review.reason,
          outcome: decision.outcome,
          amount_paise:
            decision.outcome === 'NO_ACTION' ? null : fromPaiseBigint(decision.amountPaise),
          refund_ids: refunds.map((r) => r.id),
          credit_id: credit?.id ?? null,
          breach_id: breach?.id ?? null,
          staff_id: actor.staffId,
        },
      });
      await hook?.(tx, {
        before: { settled: false, reason: review.reason },
        after: {
          outcome: decision.outcome,
          amount_paise:
            decision.outcome === 'NO_ACTION' ? null : fromPaiseBigint(decision.amountPaise),
          note: decision.note,
          refund_ids: refunds.map((r) => r.id),
          credit_id: credit?.id ?? null,
          breach_id: breach?.id ?? null,
        },
      });
      return resolution;
    });
  }

  private async creditFor(
    tx: Tx,
    bookingId: string | null,
    decision: SettleDecision,
    actor: MoneyActor,
  ): Promise<CreditRecord | null> {
    if (!bookingId) return null;
    if (decision.outcome === 'CREDIT_ISSUED') {
      return this.credits.issueIn(tx, {
        bookingId,
        amountPaise: decision.amountPaise,
        reasonCode: decision.creditReason,
        note: decision.note,
        actor,
      });
    }
    if (decision.outcome === 'REFUND_REQUESTED' && decision.creditPaise > 0n) {
      return this.credits.issueIn(tx, {
        bookingId,
        amountPaise: decision.creditPaise,
        reasonCode: CREDIT_WITH_REFUND[decision.refundReason] ?? 'GOODWILL',
        note: decision.note,
        actor,
      });
    }
    return null;
  }
}

/** ADR-0016 table: an owed breach settles exactly as priced; one that owes nothing, with no action. */
function assertBreachDecision(
  breach: BreachRecord,
  d: SettleDecision,
  refundablePaise: bigint,
): void {
  if (d.outcome === 'REFUND_REQUESTED' && d.creditPaise > 0n) {
    throw new ConflictException({
      code: 'BREACH_REMEDY_FIXED',
      message: 'A late delivery gets the table remedy only — no extra credit on top',
    });
  }
  // A refund remedy with nothing left to refund cannot move money: settle it with no action.
  const nothingToRefund = breach.remedyKind !== 'CREDIT' && refundablePaise <= 0n;
  const expected: ReviewOutcome =
    !isOwed(breach) || nothingToRefund
      ? 'NO_ACTION'
      : breach.remedyKind === 'CREDIT'
        ? 'CREDIT_ISSUED'
        : 'REFUND_REQUESTED';
  if (expected === 'NO_ACTION' && d.outcome !== 'NO_ACTION') {
    throw new ConflictException({
      code: 'BREACH_NOT_OWED',
      message: 'This late delivery owes nothing now (waived, re-attributed or already applied)',
    });
  }
  if (expected !== 'NO_ACTION' && d.outcome === 'NO_ACTION') {
    throw new ConflictException({
      code: 'BREACH_STILL_OWED',
      message:
        'This late delivery is still owed. Apply the remedy, or waive it on the Breaches desk first.',
    });
  }
  if (
    d.outcome !== expected ||
    (d.outcome !== 'NO_ACTION' && d.amountPaise !== breach.remedyPaise)
  ) {
    throw new ConflictException({
      code: 'BREACH_REMEDY_FIXED',
      message: 'A late delivery is settled exactly as the remedy table prices it',
    });
  }
}
