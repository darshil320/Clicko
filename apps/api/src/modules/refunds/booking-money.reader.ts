import type {
  ClientBookingCredit,
  ClientBookingMoney,
  ClientBookingRefund,
  ClientRefundStatus,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { PaymentRefundsService } from '../payments/payment-refunds.service';
import type { RefundTarget } from '../payments/refunds.types';
import { isSupersedable } from './refund-rules';
import type { CreditRecord, Db, RefundRecord } from './refunds.types';
import { CreditsRepository } from './repositories/credits.repository';
import { IN_FLIGHT, RefundsRepository } from './repositories/refunds.repository';

export interface RefundableTarget extends RefundTarget {
  readonly inFlightPaise: bigint;
  /** captured − refunded − in flight, never below zero. */
  readonly refundablePaise: bigint;
}

export interface BookingMoneyFacts {
  readonly targets: readonly RefundableTarget[];
  readonly paidPaise: bigint;
  readonly refundedPaise: bigint;
  readonly inFlightPaise: bigint;
  readonly refundablePaise: bigint;
  readonly creditedPaise: bigint;
  readonly refunds: readonly RefundRecord[];
  readonly credits: readonly CreditRecord[];
}

const sum = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);

/**
 * What the client sees of a refund (ADR-0027 D5): only once a second person approved it. A
 * request still waiting, or rejected, is a staff decision in progress and is not shown; a gateway
 * failure is retried by staff, so to the client it is still on its way.
 */
function clientRefundStatus(r: RefundRecord): ClientRefundStatus | null {
  if (r.status === 'COMPLETED') return 'REFUNDED';
  if (r.status === 'APPROVED' || r.status === 'PROCESSING' || r.status === 'FAILED') {
    return 'PROCESSING';
  }
  return null;
}

const clientRefund = (r: RefundRecord): ClientBookingRefund[] => {
  const status = clientRefundStatus(r);
  if (!status) return [];
  return [
    {
      id: r.id,
      amountPaise: fromPaiseBigint(r.amountPaise),
      status,
      initiatedAt: (r.approvedAt ?? r.processingAt ?? r.createdAt).toISOString(),
      completedAt: status === 'REFUNDED' ? (r.completedAt?.toISOString() ?? null) : null,
    },
  ];
};

const clientCredit = (c: CreditRecord, now: Date): ClientBookingCredit => {
  const left = c.amountPaise - c.consumedPaise;
  return {
    id: c.id,
    amountPaise: fromPaiseBigint(c.amountPaise),
    remainingPaise: fromPaiseBigint(left > 0n ? left : 0n),
    reason: c.reasonCode,
    issuedAt: c.createdAt.toISOString(),
    expiresAt: c.expiresAt.toISOString(),
    expired: c.expiresAt.getTime() <= now.getTime(),
  };
};

/**
 * A booking's money as the refund and credit desks see it (ADR-0026 D1): what each payment
 * captured, what went back, what is on its way back, and what can still be refunded.
 */
@Injectable()
export class BookingMoneyReader {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(PaymentRefundsService) private readonly payments: PaymentRefundsService,
    @Inject(RefundsRepository) private readonly refunds: RefundsRepository,
    @Inject(CreditsRepository) private readonly credits: CreditsRepository,
  ) {}

  async refundTargets(db: Db, bookingId: string): Promise<RefundableTarget[]> {
    const targets = await this.payments.targetsForBooking(bookingId, db);
    const inFlight = await this.refunds.inFlightByPayment(
      db,
      targets.map((t) => t.id),
    );
    return targets.map((t) => {
      const held = inFlight.get(t.id) ?? 0n;
      const left = t.capturedPaise - t.refundedPaise - held;
      return { ...t, inFlightPaise: held, refundablePaise: left > 0n ? left : 0n };
    });
  }

  /**
   * What the booking still holds of the client's money once its supersedable refunds (REQUESTED or
   * FAILED, not from a review settlement) are closed: captured − refunded − refunds still on their
   * way back. The cancellation quote shows this, and after `supersedeOpenByRuleIn` it equals what
   * `refundTargets` leaves refundable — so the quote and the POST agree.
   */
  async heldIfOpenSuperseded(db: Db, bookingId: string): Promise<bigint> {
    const [targets, refunds] = await Promise.all([
      this.payments.targetsForBooking(bookingId, db),
      this.refunds.forBooking(db, bookingId),
    ]);
    const kept = sum(targets.map((t) => t.capturedPaise - t.refundedPaise));
    const onTheirWay = sum(
      refunds
        .filter((r) => IN_FLIGHT.includes(r.status) && !isSupersedable(r))
        .map((r) => r.amountPaise),
    );
    const held = kept - onTheirWay;
    return held > 0n ? held : 0n;
  }

  /**
   * The client's view of their booking's refunds and credits (GET /bookings/:id/money). The
   * caller has already proved the booking is theirs; credits are also matched to them.
   */
  async forClient(userId: string, bookingId: string, now: Date): Promise<ClientBookingMoney> {
    const [refunds, credits] = await Promise.all([
      this.refunds.forBooking(this.sql, bookingId),
      this.credits.forBooking(this.sql, bookingId),
    ]);
    return {
      bookingId,
      refunds: refunds.flatMap(clientRefund),
      credits: credits.filter((c) => c.userId === userId).map((c) => clientCredit(c, now)),
    };
  }

  async facts(bookingId: string): Promise<BookingMoneyFacts> {
    const [targets, refunds, credits] = await Promise.all([
      this.refundTargets(this.sql, bookingId),
      this.refunds.forBooking(this.sql, bookingId),
      this.credits.forBooking(this.sql, bookingId),
    ]);
    return {
      targets,
      paidPaise: sum(targets.map((t) => t.capturedPaise)),
      refundedPaise: sum(targets.map((t) => t.refundedPaise)),
      inFlightPaise: sum(targets.map((t) => t.inFlightPaise)),
      refundablePaise: sum(targets.map((t) => t.refundablePaise)),
      creditedPaise: sum(credits.map((c) => c.amountPaise)),
      refunds,
      credits,
    };
  }
}
