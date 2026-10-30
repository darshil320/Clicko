/** ADR-0009 PaymentGatewayPort. Adapters never touch the database; PaymentsService does. */

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type GatewayName = 'SANDBOX' | 'RAZORPAY';

export interface CreateOrderInput {
  readonly amountPaise: bigint;
  /** Our payments.id — the gateway echoes it back on the order. */
  readonly receipt: string;
  /** HOURS_UNDER_3: authorise now, capture on photographer acceptance (doc 05 §8). */
  readonly authorizeOnly: boolean;
}

interface PaymentEventBase {
  /** The raw gateway event name, e.g. 'payment.captured'. */
  readonly eventType: string;
  readonly providerOrderId: string;
  readonly providerPaymentId: string;
}

export interface PaymentSucceededEvent extends PaymentEventBase {
  readonly kind: 'PAYMENT_CAPTURED' | 'PAYMENT_AUTHORIZED';
  readonly amountPaise: bigint;
  /** UPI | CARD | NETBANKING | WALLET … */
  readonly method: string | null;
  readonly vpaOrLast4: string | null;
  /** Gateway fee incl. GST, when the gateway reports it; 0n otherwise. */
  readonly feePaise: bigint;
}

export interface PaymentFailedEvent extends PaymentEventBase {
  readonly kind: 'PAYMENT_FAILED';
  readonly failureCode: string | null;
  readonly failureReason: string | null;
}

/** ADR-0026 D1: the gateway settled (or gave up on) a refund it had accepted as pending. */
export interface RefundWebhookEvent {
  readonly kind: 'REFUND_PROCESSED' | 'REFUND_FAILED';
  readonly eventType: string;
  readonly providerRefundId: string;
  readonly providerPaymentId: string;
  readonly amountPaise: bigint;
  /** Our refunds.id (+ `.n` for a retry), when Clickco made the refund. */
  readonly receipt: string | null;
}

export type GatewayEvent =
  | PaymentSucceededEvent
  | PaymentFailedEvent
  | RefundWebhookEvent
  | { readonly kind: 'IGNORED'; readonly eventType: string };

export const isRefundEvent = (e: GatewayEvent): e is RefundWebhookEvent =>
  e.kind === 'REFUND_PROCESSED' || e.kind === 'REFUND_FAILED';

export interface RefundInput {
  readonly providerPaymentId: string;
  readonly amountPaise: bigint;
  /**
   * Our refunds.id (`<id>.<attempt>` on a retry). Sent as the gateway receipt, so a repeated call
   * finds the earlier refund instead of refunding twice.
   */
  readonly receipt: string;
  readonly notes: Readonly<Record<string, string>>;
}

/**
 * PROCESSED: the money is on its way back (the ledger posts now). PENDING: accepted, settles later
 * (refund webhook). FAILED: definitive, nothing moved. UNKNOWN: no answer — ask again, never guess.
 */
export type RefundResult =
  | { readonly status: 'PROCESSED' | 'PENDING'; readonly providerRefundId: string }
  | { readonly status: 'FAILED'; readonly providerRefundId: string | null; readonly reason: string }
  | { readonly status: 'UNKNOWN' };

/**
 * ADR-0012 D4. CAPTURED: the money is ours. DECLINED: definitive — the authorisation no longer
 * exists at the gateway (lapsed, voided, failed), so it can never be captured. UNKNOWN: anything
 * else (timeout, 5xx, still authorised after an error) — retry later, never act on it.
 */
export type CaptureResult = 'CAPTURED' | 'DECLINED' | 'UNKNOWN';

/** RELEASED: nothing is held any more. CAPTURED: the gateway captured it — do not release. */
export type ReleaseResult = 'RELEASED' | 'CAPTURED' | 'UNKNOWN';

export interface PaymentGatewayPort {
  readonly name: GatewayName;
  /** The :provider segment of POST /payments/webhooks/:provider. */
  readonly routeSlug: string;
  /** Request header carrying the HMAC signature of the raw body. */
  readonly signatureHeader: string;
  /** Request header carrying the gateway's unique event id (the dedupe key). */
  readonly eventIdHeader: string;
  /** Public key the client checkout SDK needs; null for the sandbox. */
  readonly checkoutKeyId: string | null;
  createOrder(input: CreateOrderInput): Promise<{ readonly providerOrderId: string }>;
  /** Over the exact bytes received. Never throws: a bad signature is simply false. */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  /** Only called after the signature verified. Throws on a malformed payload. */
  parseWebhook(rawBody: Buffer): GatewayEvent;
  /**
   * Captures an authorised payment (on photographer acceptance, ADR-0010). Never throws: after
   * any error the gateway is asked what happened. Idempotent: an already captured payment is
   * CAPTURED. Callers serialise capture/release per payment (AuthHoldsService lock).
   */
  capture(providerPaymentId: string, amountPaise: bigint): Promise<CaptureResult>;
  /**
   * Releases an authorised payment in full — but only after confirming at the gateway that it is
   * not captured. Never throws. Idempotent: already released/refunded is RELEASED.
   */
  releaseAuthorization(providerPaymentId: string, amountPaise: bigint): Promise<ReleaseResult>;
  /**
   * Refunds part or all of a captured payment (ADR-0026 D1). Never throws. Idempotent per
   * receipt: an earlier refund carrying the same receipt is reported, never repeated. Callers
   * serialise refunds of one refund row (RefundsService lease).
   */
  refund(input: RefundInput): Promise<RefundResult>;
  /** The refund carrying this receipt on the payment; null when the gateway has none. */
  findRefund(providerPaymentId: string, receipt: string): Promise<RefundResult | null>;
}
