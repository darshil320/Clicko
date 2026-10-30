import { randomBytes } from 'node:crypto';
import { fromPaiseBigint } from '@clickco/utils';
import type { Clock } from '../../../common/clock';
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

export type SandboxEvent = 'payment.captured' | 'payment.authorized' | 'payment.failed';
export type SandboxRefundEvent = 'refund.processed' | 'refund.failed';

/**
 * Deterministic refund outcomes by the paise of the amount (₹2,500.13 → 13): a first attempt
 * ending in 13 fails (a retry, receipt `<id>.<n>`, succeeds); 14 stays pending until a refund
 * webhook; anything else is processed at once.
 */
export const SANDBOX_REFUND = { failPaise: 13n, pendingPaise: 14n } as const;

export interface SignedWebhook {
  readonly rawBody: Buffer;
  readonly signature: string;
  readonly eventId: string;
}

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');

/**
 * Development/test only — config/env.ts refuses it in staging and production. Orders are fake;
 * "paying" builds a Razorpay-shaped webhook signed with SANDBOX_WEBHOOK_SECRET, which then goes
 * through the same verification and processing as a real one.
 */
export class SandboxGateway implements PaymentGatewayPort {
  readonly name: GatewayName = 'SANDBOX';
  readonly routeSlug = 'sandbox';
  readonly signatureHeader = 'x-sandbox-signature';
  readonly eventIdHeader = 'x-sandbox-event-id';
  readonly checkoutKeyId = null;
  /** Refunds made by this process, by `<payment>#<receipt>` (the sandbox's idempotency store). */
  private readonly refunds = new Map<string, RefundResult>();

  constructor(
    private readonly webhookSecret: string,
    private readonly clock: Clock,
  ) {}

  async createOrder(_input: CreateOrderInput): Promise<{ providerOrderId: string }> {
    return { providerOrderId: `order_sbx_${hex(7)}` };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return signatureMatches(signature, hmacSha256Hex(this.webhookSecret, rawBody));
  }

  parseWebhook(rawBody: Buffer): GatewayEvent {
    return parseRazorpayWebhook(rawBody);
  }

  async capture(_providerPaymentId: string, _amountPaise: bigint): Promise<CaptureResult> {
    return 'CAPTURED';
  }

  async releaseAuthorization(
    _providerPaymentId: string,
    _amountPaise: bigint,
  ): Promise<ReleaseResult> {
    return 'RELEASED';
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const key = `${input.providerPaymentId}#${input.receipt}`;
    const earlier = this.refunds.get(key);
    if (earlier) return earlier;
    const providerRefundId = `rfnd_sbx_${hex(7)}`;
    const paise = input.amountPaise % 100n;
    const firstAttempt = !input.receipt.includes('.');
    const result: RefundResult =
      paise === SANDBOX_REFUND.failPaise && firstAttempt
        ? {
            status: 'FAILED',
            providerRefundId,
            reason: 'Refund failed (sandbox: paise ending in 13)',
          }
        : paise === SANDBOX_REFUND.pendingPaise
          ? { status: 'PENDING', providerRefundId }
          : { status: 'PROCESSED', providerRefundId };
    this.refunds.set(key, result);
    return result;
  }

  async findRefund(providerPaymentId: string, receipt: string): Promise<RefundResult | null> {
    return this.refunds.get(`${providerPaymentId}#${receipt}`) ?? null;
  }

  /** A Razorpay-shaped refund webhook, signed; also settles the sandbox's own record of it. */
  buildRefundWebhook(input: {
    readonly providerRefundId: string;
    readonly providerPaymentId: string;
    readonly amountPaise: bigint;
    readonly receipt: string | null;
    readonly event: SandboxRefundEvent;
  }): SignedWebhook {
    const failed = input.event === 'refund.failed';
    if (input.receipt) {
      this.refunds.set(
        `${input.providerPaymentId}#${input.receipt}`,
        failed
          ? { status: 'FAILED', providerRefundId: input.providerRefundId, reason: 'Refund failed' }
          : { status: 'PROCESSED', providerRefundId: input.providerRefundId },
      );
    }
    const entity = {
      id: input.providerRefundId,
      entity: 'refund',
      amount: fromPaiseBigint(input.amountPaise),
      currency: 'INR',
      payment_id: input.providerPaymentId,
      receipt: input.receipt,
      status: failed ? 'failed' : 'processed',
    };
    return this.sign({ event: input.event, contains: ['refund'], payload: { refund: { entity } } });
  }

  buildWebhook(input: {
    readonly providerOrderId: string;
    readonly amountPaise: bigint;
    readonly event: SandboxEvent;
  }): SignedWebhook {
    const failed = input.event === 'payment.failed';
    const entity = {
      id: `pay_sbx_${hex(7)}`,
      entity: 'payment',
      amount: fromPaiseBigint(input.amountPaise),
      currency: 'INR',
      status: input.event.slice('payment.'.length),
      order_id: input.providerOrderId,
      method: 'upi',
      vpa: failed ? 'failure@sandbox' : 'success@sandbox',
      fee: 0,
      error_code: failed ? 'BAD_REQUEST_ERROR' : null,
      error_description: failed ? 'Payment failed (sandbox)' : null,
    };
    return this.sign({
      event: input.event,
      contains: ['payment'],
      payload: { payment: { entity } },
    });
  }

  private sign(body: {
    readonly event: string;
    readonly contains: readonly string[];
    readonly payload: unknown;
  }): SignedWebhook {
    const createdAt = Math.floor(this.clock().getTime() / 1000);
    const rawBody = Buffer.from(
      JSON.stringify({
        entity: 'event',
        account_id: 'acc_sandbox',
        ...body,
        created_at: createdAt,
      }),
    );
    return {
      rawBody,
      signature: hmacSha256Hex(this.webhookSecret, rawBody),
      eventId: `evt_sbx_${hex(8)}`,
    };
  }
}
