/** Shared fakes for the PaymentFlowService unit tests. */
import type { BookingStatus } from '@clickco/contracts';
import type postgres from 'postgres';
import { vi } from 'vitest';
import type { BookingsService } from '../../bookings/bookings.service';
import type { BookingRow } from '../../bookings/bookings.types';
import type { GatewayEvent } from '../../payments/gateways/payment-gateway.port';
import type { PaymentsService } from '../../payments/payments.service';
import type { PaymentRecord } from '../../payments/payments.types';
import { PaymentFlowService } from '../payment-flow.service';

export const NOW = new Date('2026-11-10T06:30:00.000Z');
export const START = new Date('2026-11-15T06:30:00.000Z');

export const payment = (over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'pay-1',
  bookingId: 'bk-1',
  userId: 'u-1',
  purpose: 'ADVANCE',
  status: 'CREATED',
  amountPaise: 500_000n,
  capturedPaise: 0n,
  gatewayFeePaise: 0n,
  provider: 'SANDBOX',
  providerOrderId: 'order_1',
  providerPaymentId: null,
  isAuthOnly: false,
  invoiceId: null,
  createdAt: NOW,
  ...over,
});

export const booking = (status: BookingStatus, over: Partial<BookingRow> = {}): BookingRow => ({
  id: 'bk-1',
  reference: 'CLK-1000',
  status,
  userId: 'u-1',
  emergencyBand: 'NONE',
  scheduledStart: START,
  totalPaise: 1_000_000n,
  advancePaise: 500_000n,
  balancePaise: 500_000n,
  amountPaidPaise: 0n,
  quoteExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
  ...over,
});

export const succeeded = (kind: 'PAYMENT_CAPTURED' | 'PAYMENT_AUTHORIZED', amount = 500_000n) =>
  ({
    kind,
    eventType: kind === 'PAYMENT_CAPTURED' ? 'payment.captured' : 'payment.authorized',
    providerOrderId: 'order_1',
    providerPaymentId: 'pay_gw_1',
    amountPaise: amount,
    method: 'UPI',
    vpaOrLast4: 'x@upi',
    feePaise: 0n,
  }) as const;

export function harness(opts: {
  payment?: PaymentRecord | null;
  booking?: BookingRow;
  event: GatewayEvent;
}) {
  const bookings = {
    lock: vi.fn(async () => opts.booking ?? booking('ADVANCE_PENDING')),
    transition: vi.fn(async () => {}),
    addAmountPaid: vi.fn(async () => {}),
    quoteSnapshotTotals: vi.fn(async () => ({ taxablePaise: 1n })),
  };
  const payments = {
    ingestWebhook: vi.fn(async () => ({ kind: 'NEW', webhookEventId: 'wh-1', event: opts.event })),
    findByOrder: vi.fn(async () => (opts.payment === undefined ? payment() : opts.payment)),
    lockByOrder: vi.fn(async () => (opts.payment === undefined ? payment() : opts.payment)),
    recordLateFee: vi.fn(async () => {}),
    recordCapture: vi.fn(async () => ({ invoiceId: 'inv-1' })),
    markAuthorized: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    markWebhookProcessed: vi.fn(async () => {}),
    markWebhookFailed: vi.fn(async () => {}),
    flagForReview: vi.fn(async () => {}),
  };
  const sql = { begin: async (fn: (tx: unknown) => unknown) => fn({}) } as unknown as postgres.Sql;
  const flow = new PaymentFlowService(
    bookings as unknown as BookingsService,
    payments as unknown as PaymentsService,
    sql,
    () => NOW,
  );
  const run = () =>
    flow.handleWebhook({
      provider: 'sandbox',
      rawBody: Buffer.from('{}'),
      signature: 'sig',
      eventId: 'evt',
    });
  return { flow, bookings, payments, run };
}
