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
  ReleaseResult,
} from './payment-gateway.port';
import { parseRazorpayWebhook } from './razorpay-webhook.parser';

export type SandboxEvent = 'payment.captured' | 'payment.authorized' | 'payment.failed';

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
    const createdAt = Math.floor(this.clock().getTime() / 1000);
    const rawBody = Buffer.from(
      JSON.stringify({
        entity: 'event',
        account_id: 'acc_sandbox',
        event: input.event,
        contains: ['payment'],
        payload: { payment: { entity } },
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
