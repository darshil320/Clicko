import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { PaymentRefundsService } from '../payments/payment-refunds.service';
import type { RefundTarget } from '../payments/refunds.types';
import type { CreditRecord, Db, RefundRecord } from './refunds.types';
import { CreditsRepository } from './repositories/credits.repository';
import { RefundsRepository } from './repositories/refunds.repository';

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
