import { fromPaiseBigint } from '@clickco/utils';
import { z } from 'zod';
import { hmacSha256Hex, signatureMatches } from './hmac';
import type {
  CaptureResult,
  CreateOrderInput,
  GatewayEvent,
  GatewayName,
  PaymentGatewayPort,
  ReleaseResult,
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
const PaymentResponse = z.object({ status: z.string() });

class RazorpayHttpError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`Razorpay ${path} failed with HTTP ${status}`);
    this.name = 'RazorpayHttpError';
  }
}

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

  async capture(providerPaymentId: string, amountPaise: bigint): Promise<CaptureResult> {
    const id = encodeURIComponent(providerPaymentId);
    try {
      await this.request('POST', `/payments/${id}/capture`, {
        amount: fromPaiseBigint(amountPaise),
        currency: 'INR',
      });
      return 'CAPTURED';
    } catch {
      // Any error (a retried capture is a 400; a timeout may still have captured): ask.
      const state = await this.state(id);
      if (state === 'captured') return 'CAPTURED';
      if (state === 'refunded' || state === 'failed') return 'DECLINED';
      return 'UNKNOWN';
    }
  }

  /**
   * Razorpay has no separate void call: a full-amount refund on an authorised (uncaptured)
   * payment voids it before settlement. Confirms the payment is not captured first. Verify the
   * request shape against the test account once keys exist (PLAN gate S3; ADR-0012 note L14).
   */
  async releaseAuthorization(
    providerPaymentId: string,
    amountPaise: bigint,
  ): Promise<ReleaseResult> {
    const id = encodeURIComponent(providerPaymentId);
    const before = await this.state(id);
    if (before === 'captured') return 'CAPTURED';
    if (before === 'refunded' || before === 'failed') return 'RELEASED';
    if (before !== 'authorized') return 'UNKNOWN';
    try {
      await this.request('POST', `/payments/${id}/refund`, {
        amount: fromPaiseBigint(amountPaise),
      });
      return 'RELEASED';
    } catch {
      const after = await this.state(id);
      if (after === 'refunded' || after === 'failed') return 'RELEASED';
      if (after === 'captured') return 'CAPTURED';
      return 'UNKNOWN';
    }
  }

  /** The gateway's payment status, or null when it cannot be read. */
  private async state(id: string): Promise<string | null> {
    try {
      const parsed = PaymentResponse.safeParse(await this.request('GET', `/payments/${id}`));
      return parsed.success ? parsed.data.status : null;
    } catch {
      return null;
    }
  }

  private post(path: string, body: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  /** Errors carry the method, path and status only — never the credentials or the response body. */
  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const basic = Buffer.from(`${this.creds.keyId}:${this.creds.keySecret}`).toString('base64');
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      method,
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new RazorpayHttpError(`${method} ${path}`, res.status);
    return res.json();
  }
}
