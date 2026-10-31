import { BadRequestException, HttpException, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PaymentGatewayPort } from '../../payments/gateways/payment-gateway.port';
import type { PaymentFlowService } from '../payment-flow.service';
import { PaymentWebhooksController } from '../payment-webhooks.controller';
import {
  WEBHOOK_SIGNATURE_LIMIT,
  type WebhookSignatureLimiter,
} from '../webhook-signature-limiter';

const invalid = () =>
  new BadRequestException({ code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid' });

function setup(opts: { over: boolean; valid: boolean; flowError?: Error }) {
  const flow = {
    handleWebhook: vi.fn(async () => {
      if (opts.flowError) throw opts.flowError;
      return 'APPLIED';
    }),
  };
  const gateway = {
    signatureHeader: 'x-sig',
    eventIdHeader: 'x-id',
    verifyWebhookSignature: vi.fn(() => opts.valid),
  };
  const limiter = {
    overLimit: vi.fn(async () => opts.over),
    recordInvalid: vi.fn(async () => {}),
  };
  const controller = new PaymentWebhooksController(
    flow as unknown as PaymentFlowService,
    gateway as unknown as PaymentGatewayPort,
    limiter as unknown as WebhookSignatureLimiter,
  );
  const req = { rawBody: Buffer.from('{}'), headers: { 'x-sig': 's' }, ip: '203.0.113.9' };
  const receive = () =>
    controller.receive('sandbox', req as unknown as Request & { rawBody: Buffer });
  return { flow, gateway, limiter, receive };
}

describe('PaymentWebhooksController (audit M3)', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('is exempt from the global per-IP throttle (the gateway retries in bursts)', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', PaymentWebhooksController)).toBe(true);
  });

  it('counts a bad signature against the caller IP and answers 400', async () => {
    const h = setup({ over: false, valid: false, flowError: invalid() });
    await expect(h.receive()).rejects.toBeInstanceOf(BadRequestException);
    expect(h.limiter.recordInvalid).toHaveBeenCalledWith('203.0.113.9');
  });

  it('over the limit: a bad signature is 429 and never reaches the database', async () => {
    const h = setup({ over: true, valid: false });
    const error = await h.receive().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(h.flow.handleWebhook).not.toHaveBeenCalled();
  });

  it('over the limit: a valid signature is still processed (valid webhooks are unlimited)', async () => {
    const h = setup({ over: true, valid: true });
    await expect(h.receive()).resolves.toMatchObject({ data: { received: true } });
    expect(h.flow.handleWebhook).toHaveBeenCalledOnce();
    expect(h.limiter.recordInvalid).not.toHaveBeenCalled();
  });

  it('does not count failures other than a bad signature', async () => {
    const h = setup({ over: false, valid: true, flowError: new Error('db down') });
    await expect(h.receive()).rejects.toThrow('db down');
    expect(h.limiter.recordInvalid).not.toHaveBeenCalled();
  });

  it('limits strictly', () => {
    expect(WEBHOOK_SIGNATURE_LIMIT.maxInvalidPerIp).toBeLessThanOrEqual(20);
  });
});
