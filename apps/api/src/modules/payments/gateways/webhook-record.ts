import { fromPaiseBigint } from '@clickco/utils';
import type postgres from 'postgres';
import type { GatewayEvent } from './payment-gateway.port';

/**
 * Audit L1: what a verified webhook leaves in payment_webhook_events — the fields Clickco acted
 * on, never the gateway's payload. The payer's email, contact, VPA / card digits and free-text
 * descriptions are dropped; the body's sha256 (its own column) proves what arrived.
 */
export function webhookRecord(event: GatewayEvent | null, eventType: string): postgres.JSONValue {
  if (event === null) return { kind: 'MALFORMED', event: eventType };
  switch (event.kind) {
    case 'IGNORED':
      return { kind: event.kind, event: event.eventType };
    case 'PAYMENT_CAPTURED':
    case 'PAYMENT_AUTHORIZED':
      return {
        kind: event.kind,
        event: event.eventType,
        provider_order_id: event.providerOrderId,
        provider_payment_id: event.providerPaymentId,
        amount_paise: fromPaiseBigint(event.amountPaise),
      };
    case 'PAYMENT_FAILED':
      return {
        kind: event.kind,
        event: event.eventType,
        provider_order_id: event.providerOrderId,
        provider_payment_id: event.providerPaymentId,
        failure_code: event.failureCode,
      };
    case 'REFUND_PROCESSED':
    case 'REFUND_FAILED':
      return {
        kind: event.kind,
        event: event.eventType,
        provider_refund_id: event.providerRefundId,
        provider_payment_id: event.providerPaymentId,
        amount_paise: fromPaiseBigint(event.amountPaise),
        receipt: event.receipt,
      };
  }
}

/** The UTC hour an attempt is counted in (payment_webhook_rejections.bucket_start). */
export function rejectionBucket(at: Date): Date {
  const hourMs = 3_600_000;
  return new Date(Math.floor(at.getTime() / hourMs) * hourMs);
}
