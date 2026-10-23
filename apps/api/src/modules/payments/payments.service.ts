import { createHash, randomUUID } from 'node:crypto';
import { fromPaiseBigint } from '@clickco/utils';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import {
  type GatewayName,
  PAYMENT_GATEWAY,
  type PaymentFailedEvent,
  type PaymentGatewayPort,
} from './gateways/payment-gateway.port';
import { InvoicesService } from './invoices.service';
import { LedgerService } from './ledger/ledger.service';
import { advanceCapturedEntries, gatewayFeeEntries } from './ledger/ledger-entries';
import type {
  AuthorizationInput,
  CaptureInput,
  Db,
  IncomingWebhook,
  IngestResult,
  InvoiceRecord,
  NewPayment,
  PaymentPurpose,
  PaymentRecord,
  Tx,
} from './payments.types';
import { InvoicesRepository } from './repositories/invoices.repository';
import { PaymentsRepository } from './repositories/payments.repository';
import { WebhookEventsRepository } from './repositories/webhook-events.repository';

const MAX_EVENT_ID_LENGTH = 200;

/** Extensions and edit services get their own postings when those flows land (S6+). */
function captureTxnKind(purpose: PaymentPurpose): 'ADVANCE_CAPTURED' | 'BALANCE_CAPTURED' {
  if (purpose === 'ADVANCE' || purpose === 'FULL') return 'ADVANCE_CAPTURED';
  if (purpose === 'BALANCE') return 'BALANCE_CAPTURED';
  throw new Error(`No ledger posting is defined yet for a captured ${purpose} payment`);
}
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function parsePayload(rawBody: Buffer): { payload: postgres.JSONValue; eventType: string } {
  try {
    const payload = JSON.parse(rawBody.toString('utf8')) as postgres.JSONValue;
    const event = (payload as { event?: unknown } | null)?.event;
    return { payload, eventType: typeof event === 'string' ? event.slice(0, 100) : 'unknown' };
  } catch {
    return { payload: { unparseable: true }, eventType: 'unparseable' };
  }
}

/**
 * Owns payments, payment_webhook_events, invoices, invoice_series and ledger_entries. Never
 * reads or writes booking status — checkout tells it what the booking needs (ADR-0009).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(WebhookEventsRepository) private readonly webhooks: WebhookEventsRepository,
    @Inject(InvoicesRepository) private readonly invoiceReads: InvoicesRepository,
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  get gatewayName(): GatewayName {
    return this.gateway.name;
  }

  get checkoutKeyId(): string | null {
    return this.gateway.checkoutKeyId;
  }

  /** Opens a gateway order and records it as a CREATED payment, in the caller's tx. */
  async createOrder(tx: Tx, p: NewPayment): Promise<PaymentRecord> {
    const id = randomUUID();
    const { providerOrderId } = await this.gateway.createOrder({
      amountPaise: p.amountPaise,
      receipt: id,
      authorizeOnly: p.authorizeOnly,
    });
    return this.payments.insert(tx, {
      ...p,
      id,
      provider: this.gateway.name,
      providerOrderId,
      createdAt: this.clock(),
    });
  }

  findOpenForBooking(db: Db, bookingId: string): Promise<PaymentRecord | null> {
    return this.payments.latestOpenForBooking(db, bookingId);
  }

  findById(paymentId: string): Promise<PaymentRecord | null> {
    return this.payments.findById(this.sql, paymentId);
  }

  lockByOrder(tx: Tx, providerOrderId: string): Promise<PaymentRecord | null> {
    return this.payments.lockByOrder(tx, this.gateway.name, providerOrderId);
  }

  invoicesForBooking(bookingId: string): Promise<InvoiceRecord[]> {
    return this.invoiceReads.forBooking(this.sql, bookingId);
  }

  /**
   * Verify first (an invalid signature is stored with signature_valid=false, then 400), then
   * dedupe, then parse. Processing is the caller's job. The dedupe key is the gateway event id
   * bound to a hash of the signed body: the event-id header is not covered by the signature, so
   * a replayed body under a fresh id is a new row (made harmless by payment-level idempotency)
   * and a forged id can never pre-claim the genuine event.
   */
  async ingestWebhook(w: IncomingWebhook): Promise<IngestResult> {
    if (w.provider !== this.gateway.routeSlug) {
      throw new NotFoundException({ code: 'UNKNOWN_PROVIDER', message: 'Not found' });
    }
    const receivedAt = this.clock();
    const bodyHash = sha256(w.rawBody);
    const { payload, eventType } = parsePayload(w.rawBody);
    if (!this.gateway.verifyWebhookSignature(w.rawBody, w.signature)) {
      // Unauthenticated input: keep evidence, not the attacker's payload.
      const evidence = { sha256: bodyHash, bytes: w.rawBody.length };
      await this.webhooks.recordInvalid(this.sql, {
        provider: this.gateway.name,
        eventType,
        payload: evidence,
        receivedAt,
      });
      this.logger.warn(`Rejected a ${this.gateway.name} webhook with an invalid signature`);
      throw new BadRequestException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Invalid webhook signature',
      });
    }
    const eventId = w.eventId?.trim();
    const providerEventId =
      eventId && eventId.length <= MAX_EVENT_ID_LENGTH ? `${eventId}#${bodyHash}` : bodyHash;
    const row = { provider: this.gateway.name, eventType, payload, receivedAt, providerEventId };
    const claim = await this.webhooks.claim(this.sql, row);
    if (claim.alreadyProcessed) return { kind: 'DUPLICATE' };
    try {
      return { kind: 'NEW', webhookEventId: claim.id, event: this.gateway.parseWebhook(w.rawBody) };
    } catch {
      await this.markWebhookProcessed(claim.id, 'MALFORMED: payload did not match the schema');
      this.logger.warn(`Webhook ${claim.id} is signed but malformed — needs review`);
      return { kind: 'MALFORMED' };
    }
  }

  /**
   * Money that moved outside the happy path (late capture, capture on a cancelled booking,
   * amount mismatch, double charge). Outbox event for the refund/reconciliation flow (S8).
   */
  async flagForReview(
    tx: Tx,
    payment: PaymentRecord,
    reason: string,
    amountPaise: bigint,
  ): Promise<void> {
    await appendDomainEvent(tx, {
      eventType: 'payment.needs_review',
      aggregateKind: 'payment',
      aggregateId: payment.id,
      occurredAt: this.clock(),
      payload: {
        payment_id: payment.id,
        booking_id: payment.bookingId,
        reason,
        amount_paise: fromPaiseBigint(amountPaise),
      },
    });
  }

  async markWebhookProcessed(webhookEventId: string, note: string | null): Promise<void> {
    await this.webhooks.markProcessed(this.sql, webhookEventId, note, this.clock());
  }

  async markWebhookFailed(webhookEventId: string, error: string): Promise<void> {
    await this.webhooks.markFailed(this.sql, webhookEventId, error.slice(0, 500));
  }

  /**
   * Money in: ADVANCE_CAPTURED (+ GATEWAY_FEE when reported); with an invoice basis, the advance
   * invoice and its GST_ACCRUED posting. One transaction, the caller's.
   */
  async recordCapture(tx: Tx, c: CaptureInput): Promise<{ invoiceId: string | null }> {
    const { payment, event, capturedAt } = c;
    const refs = { bookingId: payment.bookingId, paymentId: payment.id, userId: payment.userId };
    await this.ledger.post(tx, {
      txnKind: captureTxnKind(payment.purpose),
      entries: advanceCapturedEntries(event.amountPaise),
      refs,
      memo: `${payment.purpose} captured ${event.providerPaymentId}`,
      occurredAt: capturedAt,
    });
    if (event.feePaise > 0n) {
      await this.ledger.post(tx, {
        txnKind: 'GATEWAY_FEE',
        entries: gatewayFeeEntries(event.feePaise),
        refs,
        memo: `Gateway fee on ${event.providerPaymentId}`,
        occurredAt: capturedAt,
      });
    }
    const invoice = c.invoiceBasis
      ? await this.invoices.issue(tx, {
          bookingId: payment.bookingId,
          userId: payment.userId,
          paymentId: payment.id,
          purpose: payment.purpose,
          amountPaise: event.amountPaise,
          basis: c.invoiceBasis,
          issuedAt: capturedAt,
        })
      : null;
    await this.payments.markCaptured(tx, payment.id, {
      providerPaymentId: event.providerPaymentId,
      method: event.method,
      vpaOrLast4: event.vpaOrLast4,
      capturedPaise: event.amountPaise,
      feePaise: event.feePaise,
      capturedAt,
      invoiceId: invoice?.id ?? null,
    });
    return { invoiceId: invoice?.id ?? null };
  }

  /** Authorise-only (<3h): no money captured, no invoice, no ledger until capture. */
  async markAuthorized(tx: Tx, a: AuthorizationInput): Promise<void> {
    await this.payments.markAuthorized(tx, a.payment.id, {
      providerPaymentId: a.event.providerPaymentId,
      method: a.event.method,
      vpaOrLast4: a.event.vpaOrLast4,
      authorizedAt: a.authorizedAt,
      authExpiresAt: a.authExpiresAt,
    });
  }

  async markFailed(tx: Tx, payment: PaymentRecord, event: PaymentFailedEvent): Promise<void> {
    await this.payments.markFailed(tx, payment.id, {
      failedAt: this.clock(),
      failureCode: event.failureCode,
      failureReason: event.failureReason,
    });
  }
}
