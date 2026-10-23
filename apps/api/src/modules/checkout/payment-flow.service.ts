import type { PayBookingResponse } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import type { BookingRow, Tx } from '../bookings/bookings.types';
import type {
  PaymentFailedEvent,
  PaymentSucceededEvent,
} from '../payments/gateways/payment-gateway.port';
import { PaymentsService } from '../payments/payments.service';
import type { IncomingWebhook, PaymentRecord, PaymentStatus } from '../payments/payments.types';
import { bookingNotFound, conflict } from './http-errors';
import { toPayBookingResponse } from './views';

/** Authorisation holds lapse 90 min before the shoot (emergency_multipliers.auto_refund_minutes_before). */
export const AUTH_RELEASE_LEAD_MS = 90 * 60_000;

/**
 * A payment opened inside the 15-minute quote window may complete up to this long after the quote
 * expires (UPI collect requests take minutes). Later money is flagged for refund, never confirmed:
 * the emergency band and split were computed for a lead time that no longer holds.
 */
export const PAYMENT_GRACE_MS = 30 * 60_000;

/** Statuses a capture may move a payment out of. Anything else is a replay or a second charge. */
const CAPTURABLE: readonly PaymentStatus[] = ['CREATED', 'FAILED', 'AUTHORIZED'];

function paymentWindowOpen(booking: BookingRow, now: Date): boolean {
  const expires = booking.quoteExpiresAt?.getTime();
  if (expires === undefined) return false;
  return now.getTime() < expires + PAYMENT_GRACE_MS && now < booking.scheduledStart;
}

export type WebhookOutcome =
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'DUPLICATE'
  | 'IGNORED'
  | 'UNKNOWN_ORDER'
  | 'NEEDS_REVIEW';

interface Applied {
  readonly outcome: WebhookOutcome;
  /** Stored as payment_webhook_events.processing_error for ops when something needs a human. */
  readonly note: string | null;
}

const applied: Applied = { outcome: 'APPLIED', note: null };
const alreadyApplied: Applied = { outcome: 'ALREADY_APPLIED', note: null };
const review = (note: string): Applied => ({ outcome: 'NEEDS_REVIEW', note });

/**
 * QUOTED → ADVANCE_PENDING (gateway order) and ADVANCE_PENDING → CONFIRMED (verified webhook).
 * Payments records the money; bookings records the status; both in one transaction here.
 */
@Injectable()
export class PaymentFlowService {
  private readonly logger = new Logger(PaymentFlowService.name);

  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Opens the advance (or full / authorise-only) payment. Re-asking returns the same open order. */
  async pay(userId: string, bookingId: string): Promise<PayBookingResponse> {
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, bookingId);
      if (booking.userId !== userId) throw bookingNotFound();
      const payment = await this.payableOrder(tx, booking, now);
      return toPayBookingResponse(payment, this.payments.gatewayName, this.payments.checkoutKeyId);
    });
  }

  /** Verified webhook → payment + booking updates in one tx. Gateway retries are safe no-ops. */
  async handleWebhook(w: IncomingWebhook): Promise<WebhookOutcome> {
    const ingest = await this.payments.ingestWebhook(w);
    if (ingest.kind === 'DUPLICATE') return 'DUPLICATE';
    if (ingest.kind === 'MALFORMED') return 'NEEDS_REVIEW';
    const { webhookEventId, event } = ingest;
    if (event.kind === 'IGNORED') {
      await this.payments.markWebhookProcessed(webhookEventId, null);
      return 'IGNORED';
    }
    try {
      const result = await this.sql.begin((tx) => this.apply(tx, event));
      await this.payments.markWebhookProcessed(webhookEventId, result.note);
      if (result.note) this.logger.warn(`Webhook ${webhookEventId}: ${result.note}`);
      return result.outcome;
    } catch (error) {
      // processed_at stays NULL: the gateway's retry (same event id) processes it again.
      await this.payments.markWebhookFailed(
        webhookEventId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async payableOrder(tx: Tx, booking: BookingRow, now: Date): Promise<PaymentRecord> {
    if (booking.status === 'ADVANCE_PENDING') {
      if (!paymentWindowOpen(booking, now)) {
        throw conflict('QUOTE_EXPIRED', 'This quote has expired — please start a new booking');
      }
      const open = await this.payments.findOpenForBooking(tx, booking.id);
      if (open) return open;
      throw conflict('PAYMENT_NOT_OPEN', 'This booking has no payment awaiting completion');
    }
    if (booking.status !== 'QUOTED') {
      throw conflict('BOOKING_NOT_PAYABLE', `A ${booking.status} booking has nothing to pay`);
    }
    if (!booking.quoteExpiresAt || booking.quoteExpiresAt.getTime() <= now.getTime()) {
      throw conflict('QUOTE_EXPIRED', 'This quote has expired — please start a new booking');
    }
    return this.openAdvance(tx, booking, now);
  }

  private async openAdvance(tx: Tx, booking: BookingRow, now: Date): Promise<PaymentRecord> {
    if (booking.advancePaise <= 0n) {
      throw new UnprocessableEntityException({
        code: 'NOTHING_TO_PAY',
        message: 'This booking has no amount due',
      });
    }
    const payment = await this.payments.createOrder(tx, {
      bookingId: booking.id,
      userId: booking.userId,
      // NONE/NEXT_DAY leave a balance; every other band is paid in full up front (doc 05 §8).
      purpose: booking.balancePaise > 0n ? 'ADVANCE' : 'FULL',
      amountPaise: booking.advancePaise,
      authorizeOnly: booking.emergencyBand === 'HOURS_UNDER_3',
    });
    await this.bookings.transition(tx, {
      bookingId: booking.id,
      to: 'ADVANCE_PENDING',
      actor: { kind: 'USER', id: booking.userId },
      occurredAt: now,
      reason: 'Client proceeded to pay',
      payload: {
        payment_id: payment.id,
        amount_paise: fromPaiseBigint(payment.amountPaise),
        provider_order_id: payment.providerOrderId,
        is_auth_only: payment.isAuthOnly,
      },
    });
    return payment;
  }

  private async apply(tx: Tx, event: PaymentSucceededEvent | PaymentFailedEvent): Promise<Applied> {
    const payment = await this.payments.lockByOrder(tx, event.providerOrderId);
    if (!payment) {
      return { outcome: 'UNKNOWN_ORDER', note: `No payment for order ${event.providerOrderId}` };
    }
    if (event.kind === 'PAYMENT_FAILED') return this.applyFailure(tx, payment, event);
    if (event.amountPaise !== payment.amountPaise) {
      const reason = `AMOUNT_MISMATCH: expected ${payment.amountPaise}, got ${event.amountPaise}`;
      await this.payments.flagForReview(tx, payment, reason, event.amountPaise);
      return review(reason);
    }
    return event.kind === 'PAYMENT_CAPTURED'
      ? this.applyCapture(tx, payment, event)
      : this.applyAuthorization(tx, payment, event);
  }

  private async applyCapture(
    tx: Tx,
    payment: PaymentRecord,
    event: PaymentSucceededEvent,
  ): Promise<Applied> {
    if (!CAPTURABLE.includes(payment.status)) {
      if (payment.providerPaymentId === event.providerPaymentId) return alreadyApplied;
      // A second successful payment on the same order: the client was charged twice.
      const reason = `SECOND_CAPTURE_ON_${payment.status}: ${event.providerPaymentId}`;
      await this.payments.flagForReview(tx, payment, reason, event.amountPaise);
      return review(reason);
    }
    const booking = await this.bookings.lock(tx, payment.bookingId);
    const now = this.clock();
    const awaiting = booking.status === 'ADVANCE_PENDING' && paymentWindowOpen(booking, now);
    await this.payments.recordCapture(tx, {
      payment,
      event,
      capturedAt: now,
      // No invoice for money that should not have arrived: it is flagged for refund instead.
      invoiceBasis: awaiting ? await this.bookings.quoteSnapshotTotals(tx, booking.id) : null,
    });
    await this.bookings.addAmountPaid(tx, booking.id, event.amountPaise);
    if (!awaiting) {
      const reason =
        booking.status === 'ADVANCE_PENDING'
          ? 'CAPTURED_AFTER_PAYMENT_WINDOW'
          : `CAPTURED_WHILE_${booking.status}`;
      await this.payments.flagForReview(tx, payment, reason, event.amountPaise);
      return review(`${reason}: refund or reconcile`);
    }
    await this.confirm(tx, booking.id, payment, event.amountPaise, now);
    return applied;
  }

  /** Authorise-only (<3h) confirms on authorisation; capture follows photographer acceptance (S5). */
  private async applyAuthorization(
    tx: Tx,
    payment: PaymentRecord,
    event: PaymentSucceededEvent,
  ): Promise<Applied> {
    // A normal payment is authorised then captured; only the capture counts.
    if (!payment.isAuthOnly) return { outcome: 'IGNORED', note: null };
    if (payment.status !== 'CREATED' && payment.status !== 'FAILED') return alreadyApplied;
    const booking = await this.bookings.lock(tx, payment.bookingId);
    const now = this.clock();
    const releaseAt = booking.scheduledStart.getTime() - AUTH_RELEASE_LEAD_MS;
    await this.payments.markAuthorized(tx, {
      payment,
      event,
      authorizedAt: now,
      // Lead time under 90 min: the release point has passed, so the hold is due back at once.
      authExpiresAt: new Date(Math.max(releaseAt, now.getTime())),
    });
    if (booking.status !== 'ADVANCE_PENDING' || !paymentWindowOpen(booking, now)) {
      const reason = `AUTHORISED_WHILE_${booking.status}: release the hold`;
      await this.payments.flagForReview(tx, payment, reason, event.amountPaise);
      return review(reason);
    }
    await this.confirm(tx, booking.id, payment, 0n, now);
    return applied;
  }

  private async applyFailure(
    tx: Tx,
    payment: PaymentRecord,
    event: PaymentFailedEvent,
  ): Promise<Applied> {
    // Only an untouched order fails; a later success on the same order must still win.
    if (payment.status !== 'CREATED') return alreadyApplied;
    await this.payments.markFailed(tx, payment, event);
    return applied;
  }

  private async confirm(
    tx: Tx,
    bookingId: string,
    payment: PaymentRecord,
    capturedPaise: bigint,
    now: Date,
  ): Promise<void> {
    await this.bookings.transition(tx, {
      bookingId,
      to: 'CONFIRMED',
      actor: { kind: 'SYSTEM', id: null },
      occurredAt: now,
      reason: payment.isAuthOnly ? 'Advance authorised (emergency booking)' : 'Advance captured',
      payload: {
        payment_id: payment.id,
        amount_captured_paise: fromPaiseBigint(capturedPaise),
        is_auth_only: payment.isAuthOnly,
      },
    });
  }
}
