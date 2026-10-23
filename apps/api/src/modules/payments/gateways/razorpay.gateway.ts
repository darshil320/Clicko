import { fromPaiseBigint } from '@clickco/utils';
import { z } from 'zod';
import { hmacSha256Hex, signatureMatches } from './hmac';
import type {
  CreateOrderInput,
  GatewayEvent,
  GatewayName,
  PaymentGatewayPort,
} from './payment-gateway.port';
import { parseRazorpayWebhook } from './razorpay-webhook.parser';

const API_BASE = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 10_000;

export interface RazorpayCredentials {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const OrderResponse = z.object({ id: z.string().min(1) });

/**
 * Razorpay. Webhook verification is real (X-Razorpay-Signature = HMAC-SHA256 hex of the raw body
 * with the webhook secret). The order/capture calls are implemented but inert until test keys
 * exist (PLAN gate S3) — check the request shape against the Razorpay docs when they do.
 */
export class RazorpayGateway implements PaymentGatewayPort {
  readonly name: GatewayName = 'RAZORPAY';
  readonly routeSlug = 'razorpay';
  readonly signatureHeader = 'x-razorpay-signature';
  readonly eventIdHeader = 'x-razorpay-event-id';

  constructor(
    private readonly creds: RazorpayCredentials,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  get checkoutKeyId(): string {
    return this.creds.keyId;
  }

  async createOrder(input: CreateOrderInput): Promise<{ providerOrderId: string }> {
    const json = await this.post('/orders', {
      amount: fromPaiseBigint(input.amountPaise),
      currency: 'INR',
      receipt: input.receipt,
      // Automatic capture follows the account setting; authorise-only must be captured by us.
      ...(input.authorizeOnly ? { payment: { capture: 'manual' } } : {}),
    });
    return { providerOrderId: OrderResponse.parse(json).id };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return signatureMatches(signature, hmacSha256Hex(this.creds.webhookSecret, rawBody));
  }

  parseWebhook(rawBody: Buffer): GatewayEvent {
    return parseRazorpayWebhook(rawBody);
  }

  async capture(providerPaymentId: string, amountPaise: bigint): Promise<void> {
    await this.post(`/payments/${encodeURIComponent(providerPaymentId)}/capture`, {
      amount: fromPaiseBigint(amountPaise),
      currency: 'INR',
    });
  }

  /** Errors carry the path and status only — never the credentials or the response body. */
  private async post(path: string, body: unknown): Promise<unknown> {
    const basic = Buffer.from(`${this.creds.keyId}:${this.creds.keySecret}`).toString('base64');
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Razorpay POST ${path} failed with HTTP ${res.status}`);
    return res.json();
  }
}
