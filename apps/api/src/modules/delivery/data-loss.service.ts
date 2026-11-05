import { type BookingStatus, DATA_LOSS_FROM_STATUSES } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent, appendDomainEventOnce } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import type { BookingRow } from '../bookings/bookings.types';
import { BookingMoneyReader } from '../refunds/booking-money.reader';
import { qmCeilingPaise, refundNeedsStepUp, rupees } from '../refunds/refund-rules';
import { RefundsService } from '../refunds/refunds.service';
import { ReviewsService } from '../refunds/reviews.service';
import { completeLossRefund, partialLossShare, splitPartialRefund } from './data-loss-rules';
import { conflict } from './http-errors';

type Tx = postgres.TransactionSql;

const COMPLETE_BPS = 10_000;
const SUPERSEDED = 'Superseded by data loss';
/** The published rule that decides the refund (no person approves a rule refund). */
const RULE_COMPLETE = 'T&C §5.5: complete loss, full refund of all amounts paid';
const RULE_PARTIAL = 'T&C §5.5: partial loss, pro-rata refund';
/** The review item for what a partial loss could not refund yet (settled on "To settle"). */
export const PARTIAL_REMAINDER_REASON = 'PARTIAL_DATA_LOSS_REMAINDER';

export interface LossConfirmer {
  readonly staffId: string;
  readonly note: string;
  /**
   * The second person holds FINANCE or SUPER_ADMIN in the city. Without it, a refund above the
   * Quality Manager's ceiling (refunds and credits already committed included) is refused: rule
   * refunds skip the refund desk's ceiling, so the confirmation carries it (ADR-0030 D2).
   */
  readonly coApproverUnlimited: boolean;
}

export interface CompleteLoss {
  readonly bookingId: string;
  readonly status: 'DATA_LOSS';
  readonly refundPaise: bigint;
  readonly refundIds: readonly string[];
  readonly supersededRefundIds: readonly string[];
}

export interface PartialLoss {
  readonly bookingId: string;
  readonly status: BookingStatus;
  readonly affectedProportionBps: number;
  readonly owedPaise: bigint;
  readonly refundPaise: bigint;
  readonly dueAfterBalancePaise: bigint;
  readonly refundIds: readonly string[];
}

const STAGE_LABEL: Partial<Record<BookingStatus, string>> = {
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  QA: 'in QA',
};

/**
 * The QA gate's other exits (ADR-0016 D1, ADR-0030 D2): staff confirm that a booking's shoot files
 * were lost before delivery (DOMAIN §2: UPLOADING / PROCESSING / QA, STAFF). The confirming desk
 * has already checked four-eyes; refunds here are decided by T&C §5.5, so they are issued by rule
 * (no approver) and sent to the gateway once the transaction commits.
 * - Complete: refunds still waiting or failed are superseded; the booking ends in DATA_LOSS
 *   (`booking.data_loss`, DOMAIN §3 payload); everything paid and not already on its way back goes
 *   back. Payouts (full payout, third in a year held) and SLA (clocks cancelled) follow the event.
 * - Partial: the booking carries on; the affected share of the whole booking goes back as far as
 *   it can now; the rest is a `booking.needs_review` item settled after the balance is paid;
 *   `booking.partial_data_loss` records it (once per booking).
 */
@Injectable()
export class DataLossService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(BookingMoneyReader) private readonly money: BookingMoneyReader,
    @Inject(RefundsService) private readonly refunds: RefundsService,
    @Inject(ReviewsService) private readonly reviewItems: ReviewsService,
  ) {}

  async confirmComplete(
    bookingId: string,
    by: LossConfirmer,
    audit: TxHook,
  ): Promise<CompleteLoss> {
    const now = this.clock();
    const result = await this.sql.begin(async (tx): Promise<CompleteLoss> => {
      const booking = await this.lockAtLossStage(tx, bookingId);
      const superseded = await this.refunds.supersedeOpenIn(tx, bookingId, by.staffId, SUPERSEDED);
      // In flight now means approved or at the gateway only: the waiting ones were just closed.
      const targets = await this.money.refundTargets(tx, bookingId);
      const refundPaise = completeLossRefund(
        targets.map((t) => ({
          capturedPaise: t.capturedPaise,
          refundedPaise: t.refundedPaise,
          committedPaise: t.inFlightPaise,
        })),
      );
      await this.assertWithinApproval(tx, booking, refundPaise, by);
      await this.bookings.transition(tx, {
        bookingId,
        to: 'DATA_LOSS',
        actor: { kind: 'STAFF', id: by.staffId },
        occurredAt: now,
        reason: 'Staff confirmed the shoot files were lost before delivery',
        payload: {
          loss_kind: 'COMPLETE',
          affected_proportion_bps: COMPLETE_BPS,
          refund_amount_paise: fromPaiseBigint(refundPaise),
        },
      });
      const refundIds = await this.issue(tx, bookingId, refundPaise, by.note, RULE_COMPLETE);
      const supersededRefundIds = superseded.map((r) => r.id);
      // A partial loss's remainder is part of "everything paid" now: its review item is closed.
      const closedReviews = await this.reviewItems.closeOpenIn(
        tx,
        bookingId,
        [PARTIAL_REMAINDER_REASON],
        by.staffId,
        SUPERSEDED,
      );
      await audit(tx, {
        before: { status: booking.status },
        after: {
          status: 'DATA_LOSS',
          note: by.note,
          refund_amount_paise: fromPaiseBigint(refundPaise),
          refund_ids: refundIds,
          superseded_refund_ids: supersededRefundIds,
          closed_review_event_ids: closedReviews,
        },
      });
      return { bookingId, status: 'DATA_LOSS', refundPaise, refundIds, supersededRefundIds };
    });
    await this.refunds.sendIssued(result.refundIds);
    return result;
  }

  async confirmPartial(
    bookingId: string,
    affectedBps: number,
    by: LossConfirmer,
    audit: TxHook,
  ): Promise<PartialLoss> {
    const now = this.clock();
    const result = await this.sql.begin(async (tx): Promise<PartialLoss> => {
      const booking = await this.lockAtLossStage(tx, bookingId);
      const totals = await this.bookings.allSnapshotTotals(tx, bookingId);
      const owedPaise = partialLossShare(totals.totalPaise, affectedBps);
      const targets = await this.money.refundTargets(tx, bookingId);
      const refundable = targets.reduce((sum, t) => sum + t.refundablePaise, 0n);
      const { nowPaise, laterPaise } = splitPartialRefund(owedPaise, refundable);
      await this.assertWithinApproval(tx, booking, nowPaise, by);
      const recorded = await appendDomainEventOnce(tx, {
        eventType: 'booking.partial_data_loss',
        aggregateKind: 'booking',
        aggregateId: bookingId,
        occurredAt: now,
        dedupeKey: 'partial-data-loss',
        payload: {
          booking_id: bookingId,
          status: booking.status,
          loss_kind: 'PARTIAL',
          affected_proportion_bps: affectedBps,
          refund_amount_paise: fromPaiseBigint(owedPaise),
          refunded_now_paise: fromPaiseBigint(nowPaise),
          due_after_balance_paise: fromPaiseBigint(laterPaise),
          staff_id: by.staffId,
        },
      });
      if (!recorded) {
        throw conflict(
          'PARTIAL_LOSS_ALREADY_RECORDED',
          'A partial loss is already recorded on this booking. If more was lost, confirm a complete loss.',
        );
      }
      const refundIds = await this.issue(tx, bookingId, nowPaise, by.note, RULE_PARTIAL);
      if (laterPaise > 0n) {
        await appendDomainEvent(tx, {
          eventType: 'booking.needs_review',
          aggregateKind: 'booking',
          aggregateId: bookingId,
          occurredAt: now,
          payload: {
            booking_id: bookingId,
            reason: PARTIAL_REMAINDER_REASON,
            amount_paise: fromPaiseBigint(laterPaise),
            affected_proportion_bps: affectedBps,
          },
        });
      }
      await audit(tx, {
        before: { status: booking.status },
        after: {
          status: booking.status,
          note: by.note,
          affected_proportion_bps: affectedBps,
          owed_paise: fromPaiseBigint(owedPaise),
          refund_amount_paise: fromPaiseBigint(nowPaise),
          due_after_balance_paise: fromPaiseBigint(laterPaise),
          refund_ids: refundIds,
        },
      });
      return {
        bookingId,
        status: booking.status,
        affectedProportionBps: affectedBps,
        owedPaise,
        refundPaise: nowPaise,
        dueAfterBalancePaise: laterPaise,
        refundIds,
      };
    });
    await this.refunds.sendIssued(result.refundIds);
    return result;
  }

  /** Above the QM ceiling, only a finance or super-admin second person may send money back. */
  private async assertWithinApproval(
    tx: Tx,
    booking: BookingRow,
    refundPaise: bigint,
    by: LossConfirmer,
  ): Promise<void> {
    if (refundPaise <= 0n || by.coApproverUnlimited) return;
    const committedPaise = await this.refunds.committedOnBooking(booking.id, tx);
    const facts = {
      amountPaise: refundPaise,
      bookingTotalPaise: booking.totalPaise,
      committedPaise,
    };
    if (!refundNeedsStepUp(facts)) return;
    throw new ForbiddenException({
      code: 'CO_APPROVER_INVALID',
      message: `This sends ${rupees(refundPaise)} back, above the Quality Manager's limit of ${rupees(qmCeilingPaise(booking.totalPaise))} on this booking, so the second person must be finance or a super admin.`,
    });
  }

  private async lockAtLossStage(tx: Tx, bookingId: string): Promise<BookingRow> {
    const booking = await this.bookings.lock(tx, bookingId);
    if (!DATA_LOSS_FROM_STATUSES.includes(booking.status)) {
      const stage =
        STAGE_LABEL[booking.status] ?? booking.status.toLowerCase().replaceAll('_', ' ');
      throw conflict(
        'DATA_LOSS_WRONG_STAGE',
        `A loss is confirmed while the files are uploading, processing or in QA. This booking is ${stage}.`,
      );
    }
    return booking;
  }

  private async issue(
    tx: Tx,
    bookingId: string,
    amountPaise: bigint,
    note: string,
    rule: string,
  ): Promise<string[]> {
    if (amountPaise <= 0n) return [];
    const rows = await this.refunds.issueByRuleIn(tx, {
      bookingId,
      amountPaise,
      reasonCode: 'DATA_LOSS',
      note,
      requestedBy: { kind: 'SYSTEM', id: null },
      rule,
    });
    return rows.map((r) => r.id);
  }
}
