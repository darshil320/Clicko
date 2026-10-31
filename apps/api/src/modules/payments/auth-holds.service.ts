import { randomUUID } from 'node:crypto';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { RedisLocks } from '../../infra/queues/redis-lock';
import {
  type CaptureResult,
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
} from './gateways/payment-gateway.port';
import { PaymentsService } from './payments.service';
import type { Db, InvoiceBasis, PaymentRecord, Tx } from './payments.types';
import { PaymentsRepository } from './repositories/payments.repository';

/**
 * Audit L5: a release checks the status at the gateway, releases, and may re-check — up to three
 * round-trips with a 10 s timeout each — then writes to the database. 30 s could lapse mid-way and
 * let a capture start; 90 s covers the worst case with slack.
 */
export const HOLD_LOCK_MS = 90_000;

/** Another capture/release of this payment is in flight, or Redis is down: retry later. */
export class HoldBusyError extends Error {
  constructor(paymentId: string) {
    super(`Payment ${paymentId} is being captured or released elsewhere`);
    this.name = 'HoldBusyError';
  }
}

export type HoldCaptureRecord =
  | { readonly kind: 'RECORDED'; readonly amountPaise: bigint; readonly invoiceId: string }
  /** A webhook (or an earlier delivery) already booked this capture. */
  | { readonly kind: 'ALREADY_RECORDED' }
  /** Captured although we had released it: the money is booked and flagged for refund. */
  | { readonly kind: 'CAPTURED_AFTER_RELEASE'; readonly amountPaise: bigint };

export type HoldReleaseOutcome = 'RELEASED' | 'NONE' | 'FLAGGED';

/**
 * Authorise-only payments (<3h emergency, ADR-0010/0011/0012 D4). Capture and release of one
 * payment are serialised by a Redis lease `payment:{id}` held across the gateway call, and the
 * database status is re-checked afterwards; any mismatch is flagged for a human, never guessed.
 */
@Injectable()
export class AuthHoldsService {
  private readonly logger = new Logger(AuthHoldsService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentsService) private readonly service: PaymentsService,
    @Inject(RedisLocks) private readonly locks: RedisLocks,
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The authorise-only payment still holding the client's money for a booking, if any. */
  held(db: Db, bookingId: string): Promise<PaymentRecord | null> {
    return this.payments.heldForBooking(db, bookingId);
  }

  /** Runs `fn` holding the payment's lease. Busy or Redis down ⇒ HoldBusyError (retry later). */
  async withLock<T>(paymentId: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const key = `payment:${paymentId}`;
    if ((await this.locks.acquire(key, token, HOLD_LOCK_MS)) !== 'ACQUIRED') {
      throw new HoldBusyError(paymentId);
    }
    try {
      return await fn();
    } finally {
      await this.locks.release(key, token);
    }
  }

  /** Gateway capture of a hold. Call inside withLock, outside any transaction. */
  async capture(hold: PaymentRecord): Promise<CaptureResult> {
    if (!hold.providerPaymentId) throw new Error(`Payment ${hold.id} has no gateway payment`);
    return this.gateway.capture(hold.providerPaymentId, hold.amountPaise);
  }

  /**
   * Books a captured hold (ADR-0011: invoice + ledger at capture). Locks the payment row — the
   * caller has already locked the booking (lock order booking → payment).
   */
  async recordCapture(
    tx: Tx,
    paymentId: string,
    capturedAt: Date,
    basis: InvoiceBasis,
  ): Promise<HoldCaptureRecord> {
    const p = await this.payments.lockById(tx, paymentId);
    if (!p?.providerPaymentId) throw new Error(`Payment ${paymentId} cannot be captured`);
    if (p.status === 'AUTHORIZED') {
      await this.service.postCaptured(tx, p, p.amountPaise, p.providerPaymentId, capturedAt);
      const invoiceId = await this.service.issueInvoice(tx, p, p.amountPaise, basis, capturedAt);
      await this.payments.markAuthCaptured(
        tx,
        p.id,
        { capturedPaise: p.amountPaise, capturedAt, invoiceId },
        'AUTHORIZED',
      );
      return { kind: 'RECORDED', amountPaise: p.amountPaise, invoiceId };
    }
    if (p.status === 'AUTH_RELEASED') {
      await this.service.postCaptured(tx, p, p.amountPaise, p.providerPaymentId, capturedAt);
      await this.payments.markAuthCaptured(
        tx,
        p.id,
        { capturedPaise: p.amountPaise, capturedAt, invoiceId: null },
        'AUTH_RELEASED',
      );
      await this.service.flagForReviewOnce(tx, p, 'CAPTURED_AFTER_RELEASE', p.amountPaise);
      return { kind: 'CAPTURED_AFTER_RELEASE', amountPaise: p.amountPaise };
    }
    return { kind: 'ALREADY_RECORDED' };
  }

  /**
   * Gives the client's money back on an uncaptured hold. Under the lease: confirm at the gateway
   * that it is not captured, release, then AUTH_RELEASED + `payment.auth_released`. A capture the
   * gateway reports instead is flagged. UNKNOWN throws (the caller's outbox delivery retries).
   */
  async release(bookingId: string, reason: string): Promise<HoldReleaseOutcome> {
    const hold = await this.payments.heldForBooking(this.sql, bookingId);
    if (!hold?.providerPaymentId) return 'NONE';
    const providerPaymentId = hold.providerPaymentId;
    return this.withLock(hold.id, async () => {
      const current = await this.payments.findById(this.sql, hold.id);
      if (current?.status !== 'AUTHORIZED') return 'NONE';
      const result = await this.gateway.releaseAuthorization(providerPaymentId, hold.amountPaise);
      if (result === 'UNKNOWN') throw new Error(`Release of payment ${hold.id} is unconfirmed`);
      return this.sql.begin((tx) => this.recordRelease(tx, hold, result, reason));
    });
  }

  private async recordRelease(
    tx: Tx,
    hold: PaymentRecord,
    result: 'RELEASED' | 'CAPTURED',
    reason: string,
  ): Promise<HoldReleaseOutcome> {
    const locked = await this.payments.lockById(tx, hold.id);
    if (result === 'CAPTURED' || locked?.status === 'CAPTURED') {
      this.logger.warn(`Payment ${hold.id} was captured at the gateway while being released`);
      await this.service.flagForReviewOnce(tx, hold, 'CAPTURED_AT_RELEASE', hold.amountPaise);
      return 'FLAGGED';
    }
    if (locked?.status !== 'AUTHORIZED') return 'NONE';
    await this.payments.markAuthReleased(tx, hold.id);
    await appendDomainEvent(tx, {
      eventType: 'payment.auth_released',
      aggregateKind: 'payment',
      aggregateId: hold.id,
      occurredAt: this.clock(),
      payload: {
        payment_id: hold.id,
        booking_id: hold.bookingId,
        reason,
        amount_paise: fromPaiseBigint(hold.amountPaise),
      },
    });
    return 'RELEASED';
  }
}
