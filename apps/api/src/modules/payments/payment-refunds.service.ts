import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent, appendDomainEventOnce } from '../../infra/outbox/outbox';
import { splitCreditNote } from './credit-note-split';
import { creditNoteNumber, creditNoteSeriesFor, isCreditNoteLate } from './financial-year';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
  type RefundInput,
  type RefundResult,
  type RefundWebhookEvent,
} from './gateways/payment-gateway.port';
import type { InvoiceSplit } from './invoice-split';
import { LedgerService } from './ledger/ledger.service';
import { creditIssuedEntries, refundIssuedEntries } from './ledger/ledger-entries';
import type { Db, Tx } from './payments.types';
import type { CreditNoteRecord, RecordRefundInput, RefundTarget } from './refunds.types';
import { CreditNotesRepository } from './repositories/credit-notes.repository';
import { RefundTargetsRepository } from './repositories/refund-targets.repository';
import { WebhookEventsRepository } from './repositories/webhook-events.repository';

export class RefundExceedsCaptureError extends Error {
  constructor(paymentId: string) {
    super(`Refund would take payment ${paymentId} past what it captured`);
    this.name = 'RefundExceedsCaptureError';
  }
}

const minus = (a: InvoiceSplit, b: InvoiceSplit): InvoiceSplit => ({
  taxablePaise: a.taxablePaise - b.taxablePaise,
  cgstPaise: a.cgstPaise - b.cgstPaise,
  sgstPaise: a.sgstPaise - b.sgstPaise,
  igstPaise: a.igstPaise - b.igstPaise,
  totalPaise: a.totalPaise - b.totalPaise,
});

/**
 * The money side of refunds and credits (ADR-0026 D1/D2), inside payments because payments owns
 * the payments, invoices, credit notes and ledger tables. The refunds module owns the refund
 * workflow and calls this: gateway execution, and — when the gateway confirms — the payment's
 * refunded total, the GST credit note and the REFUND_ISSUED posting, all in the caller's tx.
 */
@Injectable()
export class PaymentRefundsService {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(RefundTargetsRepository) private readonly targets: RefundTargetsRepository,
    @Inject(CreditNotesRepository) private readonly notes: CreditNotesRepository,
    @Inject(WebhookEventsRepository) private readonly webhooks: WebhookEventsRepository,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(SQL) private readonly sql: postgres.Sql,
  ) {}

  /** Payments of a booking that captured money (refund candidates), oldest first. */
  targetsForBooking(bookingId: string, db: Db = this.sql): Promise<RefundTarget[]> {
    return this.targets.forBooking(db, bookingId);
  }

  targetsByIds(paymentIds: readonly string[]): Promise<RefundTarget[]> {
    return this.targets.byIds(this.sql, paymentIds);
  }

  /** Lock order: booking → payment → refund (ADR-0012 D4). */
  lockTarget(tx: Tx, paymentId: string): Promise<RefundTarget | null> {
    return this.targets.lock(tx, paymentId);
  }

  /** Gateway refund. Call outside any transaction, under the refund's lease. Never throws. */
  execute(input: RefundInput): Promise<RefundResult> {
    return this.gateway.refund(input);
  }

  /** Ask the gateway what became of an earlier attempt (receipt = our refund id). */
  find(providerPaymentId: string, receipt: string): Promise<RefundResult | null> {
    return this.gateway.findRefund(providerPaymentId, receipt);
  }

  /**
   * Would a credit note issued now against this invoice miss the CGST s.34(2) window? The desk
   * warns before approving (ADR-0026 D1).
   */
  async creditNoteLate(invoiceId: string | null, at: Date): Promise<boolean> {
    if (!invoiceId) return false;
    const [row] = await this.sql<{ issued_at: Date }[]>`
      SELECT issued_at FROM invoices WHERE id = ${invoiceId}`;
    return row ? isCreditNoteLate(row.issued_at, at) : false;
  }

  /**
   * The gateway confirmed a refund: payment refunded += amount (REFUNDED or PARTIALLY_REFUNDED),
   * a credit note against the payment's invoice for as much as it still has, and REFUND_ISSUED.
   * In the caller's tx, which already holds the booking lock.
   */
  async recordRefund(tx: Tx, r: RecordRefundInput): Promise<CreditNoteRecord[]> {
    const payment = await this.targets.lock(tx, r.paymentId);
    if (!payment) throw new Error(`Payment ${r.paymentId} not found`);
    if (!(await this.targets.addRefunded(tx, payment.id, r.amountPaise))) {
      throw new RefundExceedsCaptureError(payment.id);
    }
    const notes = payment.invoiceId ? await this.issueCreditNote(tx, payment.invoiceId, r) : [];
    const credited = notes.reduce(
      (s, n) => ({
        taxable: s.taxable + n.taxablePaise,
        gst: s.gst + n.totalPaise - n.taxablePaise,
      }),
      { taxable: 0n, gst: 0n },
    );
    await this.ledger.post(tx, {
      txnKind: 'REFUND_ISSUED',
      entries: refundIssuedEntries({
        totalPaise: r.amountPaise,
        creditedTaxablePaise: credited.taxable,
        creditedGstPaise: credited.gst,
        lateGst: notes.some((n) => n.lateForGst),
      }),
      refs: {
        bookingId: payment.bookingId,
        paymentId: payment.id,
        userId: payment.userId,
        refundId: r.refundId,
      },
      memo: `Refund ${r.refundId}${notes[0] ? ` (${notes[0].number})` : ''}`,
      occurredAt: r.at,
    });
    return notes;
  }

  /** CREDIT_ISSUED: a client credit is an expense and a liability until used (ADR-0026 D2). */
  async postCreditIssued(
    tx: Tx,
    c: {
      readonly bookingId: string | null;
      readonly userId: string;
      readonly amountPaise: bigint;
      readonly memo: string;
      readonly at: Date;
    },
  ): Promise<void> {
    await this.ledger.post(tx, {
      txnKind: 'CREDIT_ISSUED',
      entries: creditIssuedEntries(c.amountPaise),
      refs: { ...(c.bookingId ? { bookingId: c.bookingId } : {}), userId: c.userId },
      memo: c.memo,
      occurredAt: c.at,
    });
  }

  creditNotesForRefunds(refundIds: readonly string[]): Promise<CreditNoteRecord[]> {
    return this.notes.forRefunds(this.sql, refundIds);
  }

  /**
   * A verified refund webhook (refund.processed / refund.failed): recorded as the outbox event
   * `payment.refund_settled`, which the refunds module applies to its refund row.
   */
  async relayWebhook(webhookEventId: string, event: RefundWebhookEvent, at: Date): Promise<void> {
    const paymentId = await this.targets.idByProviderPayment(
      this.sql,
      this.gateway.name,
      event.providerPaymentId,
    );
    await this.sql.begin(async (tx) => {
      await appendDomainEvent(tx, {
        eventType: 'payment.refund_settled',
        aggregateKind: paymentId ? 'payment' : 'payment_webhook',
        aggregateId: paymentId ?? webhookEventId,
        occurredAt: at,
        payload: {
          payment_id: paymentId,
          status: event.kind === 'REFUND_PROCESSED' ? 'PROCESSED' : 'FAILED',
          provider_refund_id: event.providerRefundId,
          provider_payment_id: event.providerPaymentId,
          amount_paise: fromPaiseBigint(event.amountPaise),
          receipt: event.receipt,
        },
      });
      await this.webhooks.markProcessed(tx, webhookEventId, null, at);
    });
  }

  /**
   * A refund webhook Clickco cannot book (amount mismatch, unknown or stale refund): never
   * booked, flagged as `payment.needs_review` (ops is alerted on it), once per gateway refund.
   */
  async flagRefundReview(m: {
    readonly reason: 'REFUND_AMOUNT_MISMATCH' | 'REFUND_WEBHOOK_UNMATCHED' | string;
    readonly paymentId: string;
    readonly bookingId: string | null;
    readonly refundId: string | null;
    readonly providerRefundId: string;
    readonly expectedPaise: bigint | null;
    readonly gatewayPaise: bigint;
    readonly at: Date;
  }): Promise<void> {
    const [target] = await this.targets.byIds(this.sql, [m.paymentId]);
    await this.sql.begin((tx) =>
      appendDomainEventOnce(tx, {
        eventType: 'payment.needs_review',
        aggregateKind: 'payment',
        aggregateId: m.paymentId,
        occurredAt: m.at,
        dedupeKey: `${m.reason}:${m.providerRefundId}`,
        payload: {
          payment_id: m.paymentId,
          booking_id: m.bookingId ?? target?.bookingId ?? null,
          refund_id: m.refundId,
          provider_refund_id: m.providerRefundId,
          reason: m.reason,
          amount_paise: fromPaiseBigint(m.gatewayPaise),
          expected_paise: m.expectedPaise === null ? null : fromPaiseBigint(m.expectedPaise),
        },
      }),
    );
  }

  private async issueCreditNote(
    tx: Tx,
    invoiceId: string,
    r: RecordRefundInput,
  ): Promise<CreditNoteRecord[]> {
    const invoice = await this.notes.lockInvoice(tx, invoiceId);
    if (!invoice || invoice.cancelled) return [];
    const remaining = minus(invoice, await this.notes.creditedSoFar(tx, invoiceId));
    if (remaining.totalPaise <= 0n) return [];
    const amount = r.amountPaise < remaining.totalPaise ? r.amountPaise : remaining.totalPaise;
    const split = splitCreditNote({ amountPaise: amount, remaining });
    const series = creditNoteSeriesFor(r.at);
    const number = creditNoteNumber(series.prefix, await this.notes.allocateNumber(tx, series));
    const lateForGst = isCreditNoteLate(invoice.issuedAt, r.at);
    const id = await this.notes.insert(tx, {
      ...split,
      number,
      financialYear: series.financialYear,
      invoice,
      refundId: r.refundId,
      reasonCode: r.reasonCode,
      issuedAt: r.at,
      lateForGst,
    });
    return [
      {
        ...split,
        id,
        number,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        refundId: r.refundId,
        issuedAt: r.at,
        lateForGst,
      },
    ];
  }
}
