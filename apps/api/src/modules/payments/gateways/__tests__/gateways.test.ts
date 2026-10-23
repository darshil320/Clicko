import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { hmacSha256Hex, signatureMatches } from '../hmac';
import { RazorpayGateway } from '../razorpay.gateway';
import { parseRazorpayWebhook } from '../razorpay-webhook.parser';
import { SandboxGateway } from '../sandbox.gateway';

const SECRET = 'whsec_test_0123456789abcdef';
const body = Buffer.from(
  JSON.stringify({
    entity: 'event',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: 'pay_1',
          entity: 'payment',
          amount: 845411,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_1',
          method: 'upi',
          vpa: 'ananya@okicici',
          fee: 16908,
        },
      },
    },
    created_at: 1_763_000_000,
  }),
);

describe('webhook signatures (HMAC-SHA256 hex over the raw body)', () => {
  it('matches what Razorpay computes', () => {
    const expected = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(hmacSha256Hex(SECRET, body)).toBe(expected);
    expect(signatureMatches(expected, hmacSha256Hex(SECRET, body))).toBe(true);
  });

  it('rejects a wrong, truncated, non-hex or missing signature without throwing', () => {
    const good = hmacSha256Hex(SECRET, body);
    expect(signatureMatches(good.replace(/.$/, good.endsWith('0') ? '1' : '0'), good)).toBe(false);
    expect(signatureMatches(good.slice(0, 10), good)).toBe(false);
    expect(signatureMatches('z'.repeat(64), good)).toBe(false);
    expect(signatureMatches(undefined, good)).toBe(false);
  });

  it('RazorpayGateway verifies over the exact bytes received', () => {
    const gw = new RazorpayGateway(
      { keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: SECRET },
      vi.fn(),
    );
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(gw.verifyWebhookSignature(body, sig)).toBe(true);
    const reformatted = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2));
    expect(gw.verifyWebhookSignature(reformatted, sig)).toBe(false);
  });
});

describe('parseRazorpayWebhook', () => {
  it('maps payment.captured with amount, method, vpa and fee', () => {
    expect(parseRazorpayWebhook(body)).toEqual({
      kind: 'PAYMENT_CAPTURED',
      eventType: 'payment.captured',
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      amountPaise: 845_411n,
      method: 'UPI',
      vpaOrLast4: 'ananya@okicici',
      feePaise: 16_908n,
    });
  });

  it('maps payment.failed with the error code and reason', () => {
    const failed = JSON.parse(body.toString());
    failed.event = 'payment.failed';
    failed.payload.payment.entity.error_code = 'BAD_REQUEST_ERROR';
    failed.payload.payment.entity.error_description = 'Payment was cancelled';
    expect(parseRazorpayWebhook(Buffer.from(JSON.stringify(failed)))).toEqual({
      kind: 'PAYMENT_FAILED',
      eventType: 'payment.failed',
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      failureCode: 'BAD_REQUEST_ERROR',
      failureReason: 'Payment was cancelled',
    });
  });

  it('ignores events it does not act on, such as order.paid', () => {
    const other = Buffer.from(JSON.stringify({ event: 'order.paid', payload: {} }));
    expect(parseRazorpayWebhook(other)).toEqual({ kind: 'IGNORED', eventType: 'order.paid' });
  });

  it('throws on a payload that is not a webhook', () => {
    expect(() => parseRazorpayWebhook(Buffer.from('not json'))).toThrow();
    expect(() =>
      parseRazorpayWebhook(
        Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: {} } })),
      ),
    ).toThrow();
  });
});

describe('RazorpayGateway HTTP calls', () => {
  const ok = (json: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }));

  it('creates an order with basic auth, integer paise and manual capture for authorise-only', async () => {
    const fetchFn = ok({ id: 'order_abc' });
    const gw = new RazorpayGateway(
      { keyId: 'rzp_test_x', keySecret: 'shh', webhookSecret: SECRET },
      fetchFn,
    );
    const out = await gw.createOrder({
      amountPaise: 845_411n,
      receipt: 'pay-uuid',
      authorizeOnly: true,
    });
    expect(out).toEqual({ providerOrderId: 'order_abc' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('rzp_test_x:shh').toString('base64')}`,
    );
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 845411,
      currency: 'INR',
      receipt: 'pay-uuid',
      payment: { capture: 'manual' },
    });
    expect(gw.checkoutKeyId).toBe('rzp_test_x');
  });

  it('surfaces a gateway error without echoing credentials', async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":{}}', { status: 401 }));
    const gw = new RazorpayGateway(
      { keyId: 'rzp_test_x', keySecret: 'TOPSECRET', webhookSecret: SECRET },
      fetchFn,
    );
    await expect(
      gw.createOrder({ amountPaise: 100n, receipt: 'r', authorizeOnly: false }),
    ).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('TOPSECRET') }),
    );
  });
});

describe('SandboxGateway', () => {
  it('creates fake orders and signs the webhooks it builds like Razorpay does', async () => {
    const gw = new SandboxGateway(SECRET, () => new Date('2026-11-10T06:30:00Z'));
    const { providerOrderId } = await gw.createOrder({
      amountPaise: 845_411n,
      receipt: 'r',
      authorizeOnly: false,
    });
    expect(providerOrderId).toMatch(/^order_sbx_[0-9a-f]{14}$/);
    const hook = gw.buildWebhook({
      providerOrderId,
      amountPaise: 845_411n,
      event: 'payment.captured',
    });
    expect(gw.verifyWebhookSignature(hook.rawBody, hook.signature)).toBe(true);
    expect(
      gw.verifyWebhookSignature(hook.rawBody, hmacSha256Hex('wrong-secret', hook.rawBody)),
    ).toBe(false);
    expect(hook.eventId).toMatch(/^evt_sbx_/);
    expect(gw.parseWebhook(hook.rawBody)).toMatchObject({
      kind: 'PAYMENT_CAPTURED',
      providerOrderId,
      amountPaise: 845_411n,
      method: 'UPI',
    });
  });
});
