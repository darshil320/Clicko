import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../config/env';
import type { PaymentGatewayPort } from '../../payments/gateways/payment-gateway.port';
import { SandboxGateway } from '../../payments/gateways/sandbox.gateway';
import type { PaymentsService } from '../../payments/payments.service';
import type { PaymentRecord } from '../../payments/payments.types';
import { DevPaymentsController } from '../dev-payments.controller';
import type { PaymentFlowService } from '../payment-flow.service';

const PAYMENT_ID = '3f6c1b2a-9d4e-4c8b-a1f0-2e5d7c9b8a61';
const SECRET = 'dev-controller-test-secret';

const payment = (over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: PAYMENT_ID,
  bookingId: 'b1',
  userId: 'u1',
  purpose: 'ADVANCE',
  status: 'CREATED',
  amountPaise: 845_411n,
  capturedPaise: 0n,
  provider: 'SANDBOX',
  providerOrderId: 'order_sbx_00000000000000',
  providerPaymentId: null,
  isAuthOnly: false,
  invoiceId: null,
  createdAt: new Date('2026-11-10T06:30:00Z'),
  ...over,
});

function controller(
  NODE_ENV: Env['NODE_ENV'],
  opts: {
    gateway?: PaymentGatewayPort;
    PAYMENT_GATEWAY?: Env['PAYMENT_GATEWAY'];
    record?: PaymentRecord;
  } = {},
) {
  const sandbox = new SandboxGateway(SECRET, () => new Date('2026-11-10T06:30:00Z'));
  const gateway = opts.gateway ?? sandbox;
  const handleWebhook = vi.fn(async () => 'APPLIED' as const);
  const findById = vi.fn(async () => opts.record ?? payment());
  const env = { NODE_ENV, PAYMENT_GATEWAY: opts.PAYMENT_GATEWAY ?? 'sandbox' } as Env;
  const c = new DevPaymentsController(
    env,
    gateway,
    { findById } as unknown as PaymentsService,
    { handleWebhook } as unknown as PaymentFlowService,
  );
  return { c, gateway, handleWebhook, findById };
}

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
  return 200;
}

describe('DevPaymentsController', () => {
  it('signs a sandbox capture and sends it through the real webhook path in development', async () => {
    const { c, gateway, handleWebhook } = controller('development');
    const res = await c.simulate(PAYMENT_ID, { outcome: 'CAPTURED' });
    expect(res.data).toMatchObject({
      paymentId: PAYMENT_ID,
      event: 'payment.captured',
      outcome: 'APPLIED',
    });
    const [incoming] = handleWebhook.mock.calls[0] as unknown as [
      { provider: string; rawBody: Buffer; signature: string; eventId: string },
    ];
    expect(incoming.provider).toBe('sandbox');
    expect(gateway.verifyWebhookSignature(incoming.rawBody, incoming.signature)).toBe(true);
    expect(JSON.parse(incoming.rawBody.toString()).payload.payment.entity).toMatchObject({
      order_id: 'order_sbx_00000000000000',
      amount: 845411,
    });
  });

  it('emits payment.authorized for an authorise-only payment, and payment.failed on FAILED', async () => {
    const auth = controller('development', { record: payment({ isAuthOnly: true }) });
    expect((await auth.c.simulate(PAYMENT_ID, { outcome: 'CAPTURED' })).data?.event).toBe(
      'payment.authorized',
    );
    const failed = controller('development');
    expect((await failed.c.simulate(PAYMENT_ID, { outcome: 'FAILED' })).data?.event).toBe(
      'payment.failed',
    );
  });

  it('is a 404 in test, staging and production', async () => {
    for (const e of ['test', 'staging', 'production'] as const) {
      const { c, handleWebhook, findById } = controller(e);
      expect(await statusOf(c.simulate(PAYMENT_ID, { outcome: 'CAPTURED' }))).toBe(404);
      expect(findById).not.toHaveBeenCalled();
      expect(handleWebhook).not.toHaveBeenCalled();
    }
  });

  it('is a 404 when the real gateway is configured, even in development', async () => {
    const razorpayLike = { name: 'RAZORPAY' } as unknown as PaymentGatewayPort;
    const viaEnv = controller('development', { PAYMENT_GATEWAY: 'razorpay' });
    expect(await statusOf(viaEnv.c.simulate(PAYMENT_ID, { outcome: 'CAPTURED' }))).toBe(404);
    const viaAdapter = controller('development', { gateway: razorpayLike });
    expect(await statusOf(viaAdapter.c.simulate(PAYMENT_ID, { outcome: 'CAPTURED' }))).toBe(404);
  });

  it('is a 404 for an unknown payment', async () => {
    const missing = new DevPaymentsController(
      { NODE_ENV: 'development', PAYMENT_GATEWAY: 'sandbox' } as Env,
      new SandboxGateway(SECRET, () => new Date()),
      { findById: async () => null } as unknown as PaymentsService,
      { handleWebhook: vi.fn() } as unknown as PaymentFlowService,
    );
    expect(await statusOf(missing.simulate(PAYMENT_ID, { outcome: 'CAPTURED' }))).toBe(404);
  });
});
