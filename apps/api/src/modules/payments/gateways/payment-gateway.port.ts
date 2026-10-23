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

export type GatewayEvent =
  | PaymentSucceededEvent
  | PaymentFailedEvent
  | { readonly kind: 'IGNORED'; readonly eventType: string };

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
  /** Captures an authorised payment (S5: on photographer acceptance). */
  capture(providerPaymentId: string, amountPaise: bigint): Promise<void>;
}
