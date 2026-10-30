import { toPaiseBigint } from '@clickco/utils';
import { z } from 'zod';
import type { GatewayEvent } from './payment-gateway.port';

/**
 * Razorpay webhook body (https://razorpay.com/docs/webhooks/payloads/payments/). The sandbox emits
 * the same shape, so both gateways share this parser and the production code path.
 */
const PaymentEntity = z.object({
  id: z.string().min(1),
  amount: z.int().nonnegative(),
  currency: z.literal('INR'),
  order_id: z.string().min(1),
  method: z.string().nullish(),
  vpa: z.string().nullish(),
  card: z.object({ last4: z.string().nullish() }).nullish(),
  fee: z.int().nonnegative().nullish(),
  error_code: z.string().nullish(),
  error_description: z.string().nullish(),
});

const Envelope = z.object({ event: z.string().min(1), payload: z.unknown() });
const PaymentPayload = z.object({ payment: z.object({ entity: PaymentEntity }) });

/** https://razorpay.com/docs/webhooks/payloads/refunds/ — refund.processed / refund.failed. */
const RefundEntity = z.object({
  id: z.string().min(1),
  amount: z.int().nonnegative(),
  currency: z.literal('INR'),
  payment_id: z.string().min(1),
  receipt: z.string().nullish(),
});
const RefundPayload = z.object({ refund: z.object({ entity: RefundEntity }) });
const REFUND_EVENTS = {
  'refund.processed': 'REFUND_PROCESSED',
  'refund.failed': 'REFUND_FAILED',
} as const;

function parseRefund(eventType: keyof typeof REFUND_EVENTS, payload: unknown): GatewayEvent {
  const r = RefundPayload.parse(payload).refund.entity;
  return {
    kind: REFUND_EVENTS[eventType],
    eventType,
    providerRefundId: r.id,
    providerPaymentId: r.payment_id,
    amountPaise: toPaiseBigint(r.amount),
    receipt: r.receipt ?? null,
  };
}

const SUCCEEDED = {
  'payment.captured': 'PAYMENT_CAPTURED',
  'payment.authorized': 'PAYMENT_AUTHORIZED',
} as const;

export function parseRazorpayWebhook(rawBody: Buffer): GatewayEvent {
  const envelope = Envelope.parse(JSON.parse(rawBody.toString('utf8')));
  const eventType = envelope.event;
  if (eventType === 'refund.processed' || eventType === 'refund.failed') {
    return parseRefund(eventType, envelope.payload);
  }
  const isSuccess = eventType === 'payment.captured' || eventType === 'payment.authorized';
  if (!isSuccess && eventType !== 'payment.failed') return { kind: 'IGNORED', eventType };

  const p = PaymentPayload.parse(envelope.payload).payment.entity;
  const base = { eventType, providerOrderId: p.order_id, providerPaymentId: p.id };
  if (!isSuccess) {
    return {
      ...base,
      kind: 'PAYMENT_FAILED',
      failureCode: p.error_code ?? null,
      failureReason: p.error_description ?? null,
    };
  }
  return {
    ...base,
    kind: SUCCEEDED[eventType],
    amountPaise: toPaiseBigint(p.amount),
    method: p.method ? p.method.toUpperCase() : null,
    vpaOrLast4: p.vpa ?? p.card?.last4 ?? null,
    feePaise: toPaiseBigint(p.fee ?? 0),
  };
}
