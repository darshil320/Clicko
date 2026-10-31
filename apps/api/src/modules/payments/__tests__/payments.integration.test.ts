import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedLaunchCities } from '../../../infra/db/seed';
import { seedLaunchRuleset } from '../../../infra/db/seeds/launch-ruleset.seed';
import {
  bookingsService,
  createQuotedBooking,
  insertUser,
} from '../../../test-support/booking-fixtures';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import type { PaymentSucceededEvent } from '../gateways/payment-gateway.port';
import { SandboxGateway } from '../gateways/sandbox.gateway';
import { InvoicesService } from '../invoices.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentsService } from '../payments.service';
import type { PaymentRecord } from '../payments.types';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentsRepository } from '../repositories/payments.repository';
import { WebhookEventsRepository } from '../repositories/webhook-events.repository';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const SECRET = 'integration-sandbox-secret-0123';

describe.runIf(TEST_DATABASE_URL)('PaymentsService in Postgres', () => {
  let db: ScratchDb;
  let gateway: SandboxGateway;
  let payments: PaymentsService;
  let userId: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    await seedLaunchRuleset(db.sql);
    userId = await insertUser(db.sql, '+919876543210');
    gateway = new SandboxGateway(SECRET, () => NOW);
    const ledger = new LedgerService();
    payments = new PaymentsService(
      gateway,
      new PaymentsRepository(),
      new WebhookEventsRepository(),
      new InvoicesRepository(),
      new InvoicesService(new InvoicesRepository(), ledger),
      ledger,
      db.sql,
      () => NOW,
    );
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  async function openPayment(): Promise<{ payment: PaymentRecord; bookingId: string }> {
    const { view } = await createQuotedBooking(db.sql, userId, NOW);
    const payment = await db.sql.begin((tx) =>
      payments.createOrder(tx, {
        bookingId: view.id,
        userId,
        purpose: 'ADVANCE',
        amountPaise: view.advancePaise,
        authorizeOnly: false,
      }),
    );
    return { payment, bookingId: view.id };
  }

  const captured = (p: PaymentRecord): PaymentSucceededEvent => ({
    kind: 'PAYMENT_CAPTURED',
    eventType: 'payment.captured',
    providerOrderId: p.providerOrderId ?? '',
    providerPaymentId: `pay_${randomUUID().slice(0, 8)}`,
    amountPaise: p.amountPaise,
    method: 'UPI',
    vpaOrLast4: 'success@sandbox',
    feePaise: 1_000n,
  });

  const ledgerByTxn = (bookingId: string) =>
    db.sql<{ txn_kind: string; debit: string; credit: string }[]>`
      SELECT txn_kind,
             sum(amount_paise) FILTER (WHERE direction = 'DEBIT') AS debit,
             sum(amount_paise) FILTER (WHERE direction = 'CREDIT') AS credit
      FROM ledger_entries WHERE booking_id = ${bookingId} GROUP BY txn_id, txn_kind ORDER BY txn_kind`;

  it('records a CREATED payment against a fresh sandbox order', async () => {
    const { payment } = await openPayment();
    expect(payment).toMatchObject({ status: 'CREATED', provider: 'SANDBOX', isAuthOnly: false });
    expect(payment.providerOrderId).toMatch(/^order_sbx_/);
  });

  it('captures: invoice from the snapshot, balanced ledger txns, payment marked', async () => {
    const { payment, bookingId } = await openPayment();
    const event = captured(payment);
    const { invoiceId } = await db.sql.begin(async (tx) => {
      const basis = await bookingsService(db.sql).quoteSnapshotTotals(tx, bookingId);
      return payments.recordCapture(tx, { payment, event, capturedAt: NOW, invoiceBasis: basis });
    });
    expect(invoiceId).not.toBeNull();

    const [invoice] = await payments.invoicesForBooking(bookingId);
    expect(invoice?.invoiceNumber).toMatch(/^CLK\/26-27\/\d{5}$/);
    expect(invoice?.totalPaise).toBe(payment.amountPaise);
    expect(
      (invoice?.taxablePaise ?? 0n) +
        (invoice?.cgstPaise ?? 0n) +
        (invoice?.sgstPaise ?? 0n) +
        (invoice?.igstPaise ?? 0n),
    ).toBe(payment.amountPaise);

    const txns = await ledgerByTxn(bookingId);
    expect(txns.map((t) => t.txn_kind)).toEqual(['ADVANCE_CAPTURED', 'GATEWAY_FEE', 'GST_ACCRUED']);
    for (const t of txns) expect(t.debit).toBe(t.credit);

    const after = await payments.findById(payment.id);
    expect(after).toMatchObject({
      status: 'CAPTURED',
      capturedPaise: payment.amountPaise,
      invoiceId,
    });
  });

  it('numbers invoices gaplessly within the FY series, creating the series on demand', async () => {
    const numbers: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { payment, bookingId } = await openPayment();
      await db.sql.begin(async (tx) => {
        const basis = await bookingsService(db.sql).quoteSnapshotTotals(tx, bookingId);
        await payments.recordCapture(tx, {
          payment,
          event: captured(payment),
          capturedAt: NOW,
          invoiceBasis: basis,
        });
      });
      const [inv] = await payments.invoicesForBooking(bookingId);
      numbers.push(inv?.invoiceNumber ?? '');
    }
    const seq = numbers.map((n) => Number.parseInt(n.slice(-5), 10));
    expect(seq[1]).toBe((seq[0] ?? 0) + 1);
    const series = await db.sql`SELECT * FROM invoice_series WHERE code = 'CLK-INV'`;
    expect(series).toHaveLength(1);
  });

  it('the deferred trigger rejects an unbalanced ledger txn at commit', async () => {
    const txnId = randomUUID();
    const attempt = db.sql.begin(async (tx) => {
      await tx`INSERT INTO ledger_entries (txn_id, txn_kind, account, direction, amount_paise)
               VALUES (${txnId}, 'ADVANCE_CAPTURED', 'CASH_GATEWAY', 'DEBIT', 1000)`;
      await tx`INSERT INTO ledger_entries (txn_id, txn_kind, account, direction, amount_paise)
               VALUES (${txnId}, 'ADVANCE_CAPTURED', 'CLIENT_RECEIVABLE', 'CREDIT', 999)`;
    });
    await expect(attempt).rejects.toThrow(/unbalanced/);
    expect(await db.sql`SELECT 1 FROM ledger_entries WHERE txn_id = ${txnId}`).toHaveLength(0);
  });

  // Audit M3: a bad signature is counted per provider per hour (with a sample), never one row each.
  it('counts badly signed webhooks in an hourly bucket, then refuses them with 400', async () => {
    const { payment } = await openPayment();
    const hook = gateway.buildWebhook({
      providerOrderId: payment.providerOrderId ?? '',
      amountPaise: payment.amountPaise,
      event: 'payment.captured',
    });
    const forged = () =>
      payments.ingestWebhook({
        provider: 'sandbox',
        rawBody: hook.rawBody,
        signature: 'f'.repeat(64),
        eventId: hook.eventId,
      });
    const eventsBefore = await db.sql`SELECT 1 FROM payment_webhook_events`;
    await expect(forged()).rejects.toBeInstanceOf(BadRequestException);
    await expect(forged()).rejects.toBeInstanceOf(BadRequestException);
    const buckets = await db.sql<
      { provider: string; bucket_start: Date; rejected_count: number; last_body_sha256: string }[]
    >`SELECT provider, bucket_start, rejected_count, last_body_sha256
        FROM payment_webhook_rejections`;
    expect(buckets).toEqual([
      {
        provider: 'SANDBOX',
        bucket_start: new Date('2026-11-10T06:00:00.000Z'),
        rejected_count: 2,
        last_body_sha256: createHash('sha256').update(hook.rawBody).digest('hex'),
      },
    ]);
    // Nothing per attempt, so the forged request never claimed the genuine event id either.
    expect(await db.sql`SELECT 1 FROM payment_webhook_events`).toHaveLength(eventsBefore.length);
  });

  // Audit L1: the payer's email, contact and VPA are never kept; parsed fields + body hash are.
  it('stores the parsed fields and the body hash of a webhook, not the raw payload', async () => {
    const { payment } = await openPayment();
    const hook = gateway.buildWebhook({
      providerOrderId: payment.providerOrderId ?? '',
      amountPaise: payment.amountPaise,
      event: 'payment.captured',
    });
    const first = await payments.ingestWebhook({
      provider: 'sandbox',
      rawBody: hook.rawBody,
      signature: hook.signature,
      eventId: hook.eventId,
    });
    expect(first.kind).toBe('NEW');
    const [row] = await db.sql<{ payload: Record<string, unknown>; body_sha256: string }[]>`
      SELECT payload, body_sha256 FROM payment_webhook_events
       WHERE provider_event_id LIKE ${`${hook.eventId}#%`}`;
    expect(row?.body_sha256).toBe(createHash('sha256').update(hook.rawBody).digest('hex'));
    expect(row?.payload).toEqual({
      kind: 'PAYMENT_CAPTURED',
      event: 'payment.captured',
      provider_order_id: payment.providerOrderId,
      provider_payment_id: expect.stringMatching(/^pay_sbx_/),
      amount_paise: Number(payment.amountPaise),
    });
    expect(JSON.stringify(row?.payload)).not.toMatch(/sandbox|vpa|email|contact/);
  });

  it('dedupes on the event id once processed, but hands back an unprocessed one for retry', async () => {
    const { payment } = await openPayment();
    const hook = gateway.buildWebhook({
      providerOrderId: payment.providerOrderId ?? '',
      amountPaise: payment.amountPaise,
      event: 'payment.captured',
    });
    const incoming = {
      provider: 'sandbox',
      rawBody: hook.rawBody,
      signature: hook.signature,
      eventId: hook.eventId,
    };
    const first = await payments.ingestWebhook(incoming);
    expect(first).toMatchObject({ kind: 'NEW', event: { kind: 'PAYMENT_CAPTURED' } });
    const retry = await payments.ingestWebhook(incoming);
    expect(retry.kind === 'NEW' && first.kind === 'NEW' && retry.webhookEventId).toBe(
      first.kind === 'NEW' ? first.webhookEventId : '',
    );
    if (first.kind === 'NEW') await payments.markWebhookProcessed(first.webhookEventId, null);
    expect(await payments.ingestWebhook(incoming)).toEqual({ kind: 'DUPLICATE' });
  });

  it('answers 404 for a provider that is not the active gateway', async () => {
    await expect(
      payments.ingestWebhook({
        provider: 'razorpay',
        rawBody: Buffer.from('{}'),
        signature: undefined,
        eventId: undefined,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
