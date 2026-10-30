import { fromPaiseBigint } from '@clickco/utils';
import { z } from 'zod';
import { hmacSha256Hex, signatureMatches } from './hmac';
import type {
  CaptureResult,
  CreateOrderInput,
  GatewayEvent,
  GatewayName,
  PaymentGatewayPort,
  RefundInput,
  RefundResult,
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
/** https://razorpay.com/docs/api/refunds/ — status is pending | processed | failed. */
const RefundEntity = z.object({
  id: z.string().min(1),
  status: z.string(),
  receipt: z.string().nullish(),
});
const RefundList = z.object({ items: z.array(RefundEntity) });
/** Razorpay keeps refunds per payment; a payment never has anywhere near this many. */
const REFUND_LIST_COUNT = 100;
/** 4xx answers that are not a refusal (retry later instead). */
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 409, 425, 429]);

function toRefundResult(r: z.infer<typeof RefundEntity>): RefundResult {
  if (r.status === 'processed') return { status: 'PROCESSED', providerRefundId: r.id };
  if (r.status === 'failed') {
    return { status: 'FAILED', providerRefundId: r.id, reason: 'The gateway failed the refund' };
  }
  return { status: 'PENDING', providerRefundId: r.id };
}

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

  /**
   * ADR-0026 D1. Looks for an earlier refund with our receipt first (Razorpay does not dedupe
   * refunds), then refunds `amount` paise at normal speed with the receipt and notes. After any
   * error it asks again: found is reported; a definite 4xx refusal is FAILED; anything else is
   * UNKNOWN. Verify the request shape against the test account once keys exist (PLAN gate S3).
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    const id = encodeURIComponent(input.providerPaymentId);
    const earlier = await this.lookupRefund(id, input.receipt).catch(() => undefined);
    if (earlier === undefined) return { status: 'UNKNOWN' };
    if (earlier) return earlier;
    try {
      const json = await this.request(
        'POST',
        `/payments/${id}/refund`,
        {
          amount: fromPaiseBigint(input.amountPaise),
          speed: 'normal',
          receipt: input.receipt,
          notes: input.notes,
        },
        // Razorpay's refund idempotency header (verify on the test account at PLAN gate S3).
        { 'x-refund-idempotency': input.receipt },
      );
      return toRefundResult(RefundEntity.parse(json));
    } catch (error) {
      const after = await this.lookupRefund(id, input.receipt).catch(() => undefined);
      if (after) return after;
      const refused =
        after === null &&
        error instanceof RazorpayHttpError &&
        error.status >= 400 &&
        error.status < 500 &&
        !RETRYABLE_STATUS.has(error.status);
      if (!refused) return { status: 'UNKNOWN' };
      return {
        status: 'FAILED',
        providerRefundId: null,
        reason: `The gateway refused the refund (HTTP ${error.status})`,
      };
    }
  }

  async findRefund(providerPaymentId: string, receipt: string): Promise<RefundResult | null> {
    try {
      return await this.lookupRefund(encodeURIComponent(providerPaymentId), receipt);
    } catch {
      return { status: 'UNKNOWN' };
    }
  }

  /** The payment's refund carrying `receipt`, or null. Throws when the gateway cannot be read. */
  private async lookupRefund(id: string, receipt: string): Promise<RefundResult | null> {
    const json = await this.request('GET', `/payments/${id}/refunds?count=${REFUND_LIST_COUNT}`);
    const found = RefundList.parse(json).items.find((r) => r.receipt === receipt);
    return found ? toRefundResult(found) : null;
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
  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Promise<unknown> {
    const basic = Buffer.from(`${this.creds.keyId}:${this.creds.keySecret}`).toString('base64');
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/json',
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new RazorpayHttpError(`${method} ${path}`, res.status);
    return res.json();
  }
}
