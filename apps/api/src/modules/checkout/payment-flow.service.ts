import type { PayBookingResponse } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { type BookingRow, SYSTEM_ACTOR, type Tx } from '../bookings/bookings.types';
import { ACCEPTED_STATUSES } from '../bookings/state-machine';
import {
  isRefundEvent,
  type PaymentFailedEvent,
  type PaymentSucceededEvent,
} from '../payments/gateways/payment-gateway.port';
import { PaymentRefundsService } from '../payments/payment-refunds.service';
import { PaymentsService } from '../payments/payments.service';
import type {
  IncomingWebhook,
  NewPayment,
  PaymentRecord,
  PaymentStatus,
} from '../payments/payments.types';
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
/** Audit L3: the cancellation reason of an unpaid booking whose payment window closed. */
export const PAYMENT_WINDOW_EXPIRED = 'PAYMENT_WINDOW_EXPIRED';
/** Audit L3: stale ADVANCE_PENDING bookings cancelled per sweep run. */
export const STALE_SWEEP_BATCH = 200;

/** Statuses a capture may move a payment out of. Anything else is a replay or a second charge. */
const CAPTURABLE: readonly PaymentStatus[] = ['CREATED', 'FAILED', 'AUTHORIZED'];

/**
 * A held (<3h) payment is captured when a photographer accepts (ADR-0010/0011). Dispatch records
 * that capture itself; when the gateway's webhook wins the race, it is booked here instead.
 */
const HELD_CAPTURE_EXPECTED = ACCEPTED_STATUSES;

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

/** What paying needs (audit L6: decided under the lock, the gateway called outside it). */
interface NewOrderPlan {
  readonly kind: 'NEW';
  readonly order: NewPayment;
  /** QUOTED → ADVANCE_PENDING once the order is recorded. */
  readonly transition: boolean;
}
type OrderPlan = { readonly kind: 'EXISTING'; readonly payment: PaymentRecord } | NewOrderPlan;

const samePlan = (a: NewOrderPlan, b: NewOrderPlan): boolean =>
  a.transition === b.transition &&
  a.order.purpose === b.order.purpose &&
  a.order.amountPaise === b.order.amountPaise &&
  a.order.authorizeOnly === b.order.authorizeOnly;

const nothingToPay = () =>
  new UnprocessableEntityException({
    code: 'NOTHING_TO_PAY',
    message: 'This booking has no amount due',
  });

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
    @Inject(PaymentRefundsService) private readonly refunds?: PaymentRefundsService,
  ) {}

  /**
   * Opens the advance (or full / authorise-only) payment. Re-asking returns the same open order.
   * Audit L6: the gateway call never runs inside the booking-lock transaction (a slow gateway
   * would hold the row lock). Plan under the lock → create the gateway order with no transaction
   * open → record it under the lock again, re-planning first: a concurrent pay that won meanwhile
   * hands back its own open order (ours is never recorded and simply expires unpaid), and a
   * booking whose amount changed is refused.
   */
  async pay(userId: string, bookingId: string): Promise<PayBookingResponse> {
    const plan = await this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, bookingId);
      if (booking.userId !== userId) throw bookingNotFound();
      return this.planOrder(tx, booking, this.clock());
    });
    const payment = plan.kind === 'EXISTING' ? plan.payment : await this.openNew(bookingId, plan);
    return toPayBookingResponse(payment, this.payments.gatewayName, this.payments.checkoutKeyId);
  }

  private async openNew(bookingId: string, plan: NewOrderPlan): Promise<PaymentRecord> {
    const reserved = await this.payments.reserveOrder(plan.order);
    return this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, bookingId);
      const now = this.clock();
      const again = await this.planOrder(tx, booking, now);
      if (again.kind === 'EXISTING') return again.payment;
      if (!samePlan(again, plan)) {
        throw conflict('BOOKING_CHANGED', 'This booking changed meanwhile. Please try again.');
      }
      const payment = await this.payments.insertOrder(tx, plan.order, reserved);
      if (plan.transition) await this.markAdvancePending(tx, booking, payment, now);
      return payment;
    });
  }

  /** What paying needs now: the open order, or a new one (validated, nothing written). */
  private async planOrder(tx: Tx, booking: BookingRow, now: Date): Promise<OrderPlan> {
    if (booking.status === 'ADVANCE_PENDING') {
      if (!paymentWindowOpen(booking, now)) {
        throw conflict('QUOTE_EXPIRED', 'This quote has expired — please start a new booking');
      }
      const open = await this.payments.findOpenForBooking(tx, booking.id);
      if (open) return { kind: 'EXISTING', payment: open };
      throw conflict('PAYMENT_NOT_OPEN', 'This booking has no payment awaiting completion');
    }
    if (booking.status === 'BALANCE_PENDING') return this.planBalance(tx, booking);
    if (booking.status !== 'QUOTED') {
      throw conflict('BOOKING_NOT_PAYABLE', `A ${booking.status} booking has nothing to pay`);
    }
    if (!booking.quoteExpiresAt || booking.quoteExpiresAt.getTime() <= now.getTime()) {
      throw conflict('QUOTE_EXPIRED', 'This quote has expired — please start a new booking');
    }
    if (booking.advancePaise <= 0n) throw nothingToPay();
    return {
      kind: 'NEW',
      transition: true,
      order: {
        bookingId: booking.id,
        userId: booking.userId,
        // NONE/NEXT_DAY leave a balance; every other band is paid in full up front (doc 05 §8).
        purpose: booking.balancePaise > 0n ? 'ADVANCE' : 'FULL',
        amountPaise: booking.advancePaise,
        authorizeOnly: booking.emergencyBand === 'HOURS_UNDER_3',
      },
    };
  }

  private async markAdvancePending(
    tx: Tx,
    booking: BookingRow,
    payment: PaymentRecord,
    now: Date,
  ): Promise<void> {
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
  }

  /**
   * ADR-0016 D4: the balance — everything charged and not yet paid (extensions and waiting
   * included). The open balance order is reused while it is for the amount still due.
   */
  private async planBalance(tx: Tx, booking: BookingRow): Promise<OrderPlan> {
    const due = booking.totalPaise - booking.amountPaidPaise;
    if (due <= 0n) throw nothingToPay();
    const open = await this.payments.findOpenForBooking(tx, booking.id);
    if (open?.purpose === 'BALANCE' && open.amountPaise === due) {
      return { kind: 'EXISTING', payment: open };
    }
    return {
      kind: 'NEW',
      transition: false,
      order: {
        bookingId: booking.id,
        userId: booking.userId,
        purpose: 'BALANCE',
        amountPaise: due,
        authorizeOnly: false,
      },
    };
  }

  /**
   * Audit L3: an ADVANCE_PENDING booking whose payment window closed (quote expiry + grace, or
   * the start passed) is cancelled — its promo redemption counts again and it leaves the client's
   * list. Each in its own transaction under the booking lock, re-checked there; the transition
   * writes the status event and the outbox event in that transaction. A capture arriving later
   * takes the existing "captured on a cancelled booking" review path. Returns how many.
   */
  async cancelStaleAdvances(now: Date = this.clock()): Promise<number> {
    const ids = await this.bookings.staleAdvancePending(
      new Date(now.getTime() - PAYMENT_GRACE_MS),
      now,
      STALE_SWEEP_BATCH,
    );
    let cancelled = 0;
    for (const id of ids) {
      const done = await this.sql.begin(async (tx) => {
        const booking = await this.bookings.lock(tx, id);
        if (booking.status !== 'ADVANCE_PENDING' || paymentWindowOpen(booking, now)) return false;
        await this.bookings.transition(tx, {
          bookingId: id,
          to: 'CANCELLED_CLIENT',
          actor: SYSTEM_ACTOR,
          occurredAt: now,
          reason: 'The advance was not paid before the quote expired',
          cancellationReason: PAYMENT_WINDOW_EXPIRED,
          payload: { reason: PAYMENT_WINDOW_EXPIRED },
        });
        return true;
      });
      if (done) cancelled += 1;
    }
    if (cancelled > 0) this.logger.log(`Cancelled ${cancelled} unpaid ADVANCE_PENDING booking(s)`);
    return cancelled;
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
      // ADR-0026 D1: a refund settled at the gateway — the refunds module applies it (outbox).
      // Audit L9: inside the same try, so a failed relay is marked failed like any other.
      if (isRefundEvent(event)) {
        if (!this.refunds) throw new Error('Refund webhooks need PaymentRefundsService');
        await this.refunds.relayWebhook(webhookEventId, event, this.clock());
        return 'APPLIED';
      }
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

  /** Lock order everywhere is booking → payment (ADR-0012 D4): find, lock booking, lock payment. */
  private async apply(tx: Tx, event: PaymentSucceededEvent | PaymentFailedEvent): Promise<Applied> {
    const ref = await this.payments.findByOrder(tx, event.providerOrderId);
    const unknown: Applied = {
      outcome: 'UNKNOWN_ORDER',
      note: `No payment for order ${event.providerOrderId}`,
    };
    if (!ref) return unknown;
    const booking = await this.bookings.lock(tx, ref.bookingId);
    const payment = await this.payments.lockByOrder(tx, event.providerOrderId);
    if (!payment) return unknown;
    if (event.kind === 'PAYMENT_FAILED') return this.applyFailure(tx, payment, event);
    if (event.amountPaise !== payment.amountPaise) {
      const reason = `AMOUNT_MISMATCH: expected ${payment.amountPaise}, got ${event.amountPaise}`;
      await this.payments.flagForReview(tx, payment, reason, event.amountPaise);
      return review(reason);
    }
    return event.kind === 'PAYMENT_CAPTURED'
      ? this.applyCapture(tx, payment, event, booking)
      : this.applyAuthorization(tx, payment, event, booking);
  }

  private async applyCapture(
    tx: Tx,
    payment: PaymentRecord,
    event: PaymentSucceededEvent,
    booking: BookingRow,
  ): Promise<Applied> {
    const now = this.clock();
    if (payment.status === 'AUTH_RELEASED')
      return this.capturedAfterRelease(tx, payment, event, now);
    if (!CAPTURABLE.includes(payment.status)) {
      if (payment.providerPaymentId === event.providerPaymentId) {
        // Dispatch booked this capture itself; the webhook may still bring the gateway fee.
        await this.payments.recordLateFee(tx, payment, event.feePaise, now);
        return alreadyApplied;
      }
      // A second successful payment on the same order: the client was charged twice.
      const reason = `SECOND_CAPTURE_ON_${payment.status}: ${event.providerPaymentId}`;
      await this.payments.flagForReview(tx, payment, reason, event.amountPaise);
      return review(reason);
    }
    if (payment.isAuthOnly && payment.status === 'AUTHORIZED') {
      return this.applyHeldCapture(tx, payment, event, booking, now);
    }
    if (payment.purpose === 'BALANCE')
      return this.applyBalanceCapture(tx, payment, event, booking, now);
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

  /**
   * The balance (ADR-0016 D3/D4): with the booking waiting for exactly this amount, the capture,
   * the remainder invoice and `payment.balance_captured` (which releases the delivery). Anything
   * else is booked without an invoice and flagged.
   */
  private async applyBalanceCapture(
    tx: Tx,
    payment: PaymentRecord,
    event: PaymentSucceededEvent,
    booking: BookingRow,
    now: Date,
  ): Promise<Applied> {
    const due = booking.totalPaise - booking.amountPaidPaise;
    if (booking.status === 'BALANCE_PENDING' && event.amountPaise === due) {
      await this.payments.recordBalanceCapture(tx, {
        payment,
        event,
        capturedAt: now,
        allSnapshots: await this.bookings.allSnapshotTotals(tx, booking.id),
      });
      await this.bookings.addAmountPaid(tx, booking.id, event.amountPaise);
      return applied;
    }
    await this.payments.recordCapture(tx, { payment, event, capturedAt: now, invoiceBasis: null });
    await this.bookings.addAmountPaid(tx, booking.id, event.amountPaise);
    const reason = `BALANCE_CAPTURED_WHILE_${booking.status}`;
    await this.payments.flagForReview(tx, payment, reason, event.amountPaise);
    return review(`${reason}: refund or reconcile`);
  }

  /** We released this hold, yet the gateway captured it: book the money, flag it for refund. */
  private async capturedAfterRelease(
    tx: Tx,
    payment: PaymentRecord,
    event: PaymentSucceededEvent,
    now: Date,
  ): Promise<Applied> {
    if (payment.providerPaymentId !== event.providerPaymentId) {
      const reason = `SECOND_CAPTURE_ON_AUTH_RELEASED: ${event.providerPaymentId}`;
      await this.payments.flagForReview(tx, payment, reason, event.amountPaise);
      return review(reason);
    }
    await this.payments.recordCapture(tx, { payment, event, capturedAt: now, invoiceBasis: null });
    await this.bookings.addAmountPaid(tx, payment.bookingId, event.amountPaise);
    await this.payments.flagForReview(tx, payment, 'CAPTURED_AFTER_RELEASE', event.amountPaise);
    return review('CAPTURED_AFTER_RELEASE: refund or reconcile');
  }

  /** The capture of a held payment: expected once a photographer has accepted, flagged otherwise. */
  private async applyHeldCapture(
    tx: Tx,
    payment: PaymentRecord,
    event: PaymentSucceededEvent,
    booking: BookingRow,
    now: Date,
  ): Promise<Applied> {
    const expected = HELD_CAPTURE_EXPECTED.includes(booking.status);
    await this.payments.recordCapture(tx, {
      payment,
      event,
      capturedAt: now,
      invoiceBasis: expected ? await this.bookings.quoteSnapshotTotals(tx, booking.id) : null,
    });
    await this.bookings.addAmountPaid(tx, booking.id, event.amountPaise);
    if (expected) return applied;
    const reason = `HELD_PAYMENT_CAPTURED_WHILE_${booking.status}`;
    await this.payments.flagForReview(tx, payment, reason, event.amountPaise);
    return review(`${reason}: refund or reconcile`);
  }

  /** Authorise-only (<3h) confirms on authorisation; capture follows photographer acceptance (S5). */
  private async applyAuthorization(
    tx: Tx,
    payment: PaymentRecord,
    event: PaymentSucceededEvent,
    booking: BookingRow,
  ): Promise<Applied> {
    // A normal payment is authorised then captured; only the capture counts.
    if (!payment.isAuthOnly) return { outcome: 'IGNORED', note: null };
    if (payment.status !== 'CREATED' && payment.status !== 'FAILED') return alreadyApplied;
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
