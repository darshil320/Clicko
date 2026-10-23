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

const SUCCEEDED = {
  'payment.captured': 'PAYMENT_CAPTURED',
  'payment.authorized': 'PAYMENT_AUTHORIZED',
} as const;

export function parseRazorpayWebhook(rawBody: Buffer): GatewayEvent {
  const envelope = Envelope.parse(JSON.parse(rawBody.toString('utf8')));
  const eventType = envelope.event;
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
