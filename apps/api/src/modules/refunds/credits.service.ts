import { fromPaiseBigint } from '@clickco/utils';
import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentRefundsService } from '../payments/payment-refunds.service';
import { creditCheck, creditExpiresAt } from './refund-rules';
import type { CreditReasonCode } from './refunds.config';
import type { CreditRecord, MoneyActor, Tx } from './refunds.types';
import { type CreditPageQuery, CreditsRepository } from './repositories/credits.repository';
import { RefundsRepository } from './repositories/refunds.repository';

export interface CreditIssue {
  readonly bookingId: string;
  readonly amountPaise: bigint;
  readonly reasonCode: CreditReasonCode;
  readonly note: string;
  readonly actor: MoneyActor;
}

/**
 * Client credits (ADR-0026 D2): integer paise, valid 12 months, issued by the QM (within the
 * ceiling, counted with the booking's refunds) or finance, with a reason. An issued credit cannot
 * be withdrawn (the table's trigger agrees). CREDIT_ISSUED posts at issue; checkout uses credits
 * from S11.
 */
@Injectable()
export class CreditsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CreditsRepository) private readonly credits: CreditsRepository,
    @Inject(RefundsRepository) private readonly refunds: RefundsRepository,
    @Inject(PaymentRefundsService) private readonly payments: PaymentRefundsService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  page(q: CreditPageQuery): Promise<CreditRecord[]> {
    return this.credits.page(this.sql, q);
  }

  byIds(ids: readonly string[]): Promise<CreditRecord[]> {
    return this.credits.byIds(this.sql, ids);
  }

  issue(c: CreditIssue, hook?: TxHook): Promise<CreditRecord> {
    return this.sql.begin((tx) => this.issueIn(tx, c, hook));
  }

  /** `issue`, inside the caller's transaction (settling a review item). */
  async issueIn(tx: Tx, c: CreditIssue, hook?: TxHook): Promise<CreditRecord> {
    const booking = await this.bookings.lock(tx, c.bookingId);
    const [refunded, credited] = await Promise.all([
      this.refunds.committedForBooking(tx, c.bookingId),
      this.credits.totalForBooking(tx, c.bookingId),
    ]);
    const check = creditCheck({
      roles: c.actor.roles,
      amountPaise: c.amountPaise,
      bookingTotalPaise: booking.totalPaise,
      committedPaise: refunded + credited,
    });
    if (!check.ok) {
      const body = { code: check.code, message: check.message };
      throw check.code === 'NOT_AN_APPROVER'
        ? new ForbiddenException(body)
        : new ConflictException(body);
    }
    // Never more back (refunds + credits) than the booking was worth, whoever issues it.
    if (refunded + credited + c.amountPaise > booking.totalPaise) {
      throw new ConflictException({
        code: 'CREDIT_TOO_LARGE',
        message: 'Refunds and credits on this booking would come to more than its total',
      });
    }
    const now = this.clock();
    const credit = await this.credits.insert(tx, {
      userId: booking.userId,
      bookingId: c.bookingId,
      amountPaise: c.amountPaise,
      reasonCode: c.reasonCode,
      reasonNote: c.note,
      issuedBy: c.actor.staffId,
      expiresAt: creditExpiresAt(now),
      createdAt: now,
    });
    await this.payments.postCreditIssued(tx, {
      bookingId: c.bookingId,
      userId: booking.userId,
      amountPaise: c.amountPaise,
      memo: `Credit ${credit.id} (${c.reasonCode})`,
      at: now,
    });
    await appendDomainEvent(tx, {
      eventType: 'credit.issued',
      aggregateKind: 'client_credit',
      aggregateId: credit.id,
      occurredAt: now,
      payload: {
        credit_id: credit.id,
        booking_id: c.bookingId,
        user_id: booking.userId,
        amount_paise: fromPaiseBigint(c.amountPaise),
        reason: c.reasonCode,
        expires_at: credit.expiresAt.toISOString(),
        staff_id: c.actor.staffId,
      },
    });
    await hook?.(tx, {
      before: null,
      after: {
        credit_id: credit.id,
        amount_paise: fromPaiseBigint(c.amountPaise),
        reason: c.reasonCode,
        note: c.note,
        expires_at: credit.expiresAt.toISOString(),
      },
    });
    return credit;
  }
}
