import { describe, expect, it, vi } from 'vitest';
import { RazorpayGateway } from '../razorpay.gateway';
import { parseRazorpayWebhook } from '../razorpay-webhook.parser';
import { SANDBOX_REFUND, SandboxGateway } from '../sandbox.gateway';

const SECRET = 'whsec_test_0123456789abcdef';
const REFUND_ID = '6f1c2b8e-3a4d-4c5e-9f60-7a8b9c0d1e2f';
const input = (amountPaise: bigint, receipt = REFUND_ID) => ({
  providerPaymentId: 'pay_1',
  amountPaise,
  receipt,
  notes: { refund_id: REFUND_ID, booking_id: 'b-1' },
});

describe('SandboxGateway refunds (deterministic for tests)', () => {
  const gw = () => new SandboxGateway(SECRET, () => new Date('2026-11-10T06:30:00Z'));

  it('processes a refund at once and reports the same refund again for the same receipt', async () => {
    const sandbox = gw();
    const first = await sandbox.refund(input(250_000n));
    expect(first).toMatchObject({ status: 'PROCESSED', providerRefundId: expect.any(String) });
    expect(await sandbox.refund(input(250_000n))).toEqual(first);
    expect(await sandbox.findRefund('pay_1', REFUND_ID)).toEqual(first);
    expect(await sandbox.findRefund('pay_1', 'never-sent')).toBeNull();
  });

  it(`fails a first attempt whose paise end in ${SANDBOX_REFUND.failPaise}, and lets a retry (new receipt) through`, async () => {
    const sandbox = gw();
    expect(await sandbox.refund(input(250_013n))).toMatchObject({
      status: 'FAILED',
      reason: expect.stringContaining('sandbox'),
    });
    expect(await sandbox.refund(input(250_013n, `${REFUND_ID}.2`))).toMatchObject({
      status: 'PROCESSED',
    });
  });

  it(`leaves paise ending in ${SANDBOX_REFUND.pendingPaise} pending until a refund webhook arrives`, async () => {
    const sandbox = gw();
    const pending = await sandbox.refund(input(250_014n));
    expect(pending).toMatchObject({ status: 'PENDING' });
    const hook = sandbox.buildRefundWebhook({
      providerRefundId: pending.status === 'PENDING' ? pending.providerRefundId : '',
      providerPaymentId: 'pay_1',
      amountPaise: 250_014n,
      receipt: REFUND_ID,
      event: 'refund.processed',
    });
    expect(sandbox.verifyWebhookSignature(hook.rawBody, hook.signature)).toBe(true);
    expect(sandbox.parseWebhook(hook.rawBody)).toEqual({
      kind: 'REFUND_PROCESSED',
      eventType: 'refund.processed',
      providerRefundId: pending.status === 'PENDING' ? pending.providerRefundId : '',
      providerPaymentId: 'pay_1',
      amountPaise: 250_014n,
      receipt: REFUND_ID,
    });
  });
});

describe('parseRazorpayWebhook — refund events', () => {
  const refundBody = (event: string, extra: Record<string, unknown> = {}) =>
    Buffer.from(
      JSON.stringify({
        entity: 'event',
        event,
        contains: ['refund', 'payment'],
        payload: {
          refund: {
            entity: {
              id: 'rfnd_1',
              entity: 'refund',
              amount: 250000,
              currency: 'INR',
              payment_id: 'pay_1',
              receipt: REFUND_ID,
              status: event === 'refund.failed' ? 'failed' : 'processed',
              ...extra,
            },
          },
        },
      }),
    );

  it('maps refund.processed and refund.failed; refund.created is ignored (the API answer covers it)', () => {
    expect(parseRazorpayWebhook(refundBody('refund.processed'))).toEqual({
      kind: 'REFUND_PROCESSED',
      eventType: 'refund.processed',
      providerRefundId: 'rfnd_1',
      providerPaymentId: 'pay_1',
      amountPaise: 250_000n,
      receipt: REFUND_ID,
    });
    expect(parseRazorpayWebhook(refundBody('refund.failed'))).toMatchObject({
      kind: 'REFUND_FAILED',
    });
    expect(parseRazorpayWebhook(refundBody('refund.created'))).toEqual({
      kind: 'IGNORED',
      eventType: 'refund.created',
    });
  });

  it('accepts a refund without a receipt (made outside Clickco) as receipt null', () => {
    expect(parseRazorpayWebhook(refundBody('refund.processed', { receipt: null }))).toMatchObject({
      receipt: null,
    });
  });
});

describe('RazorpayGateway refunds (POST /v1/payments/:id/refund, inert without keys)', () => {
  const creds = { keyId: 'rzp_test_x', keySecret: 'shh', webhookSecret: SECRET };
  type Reply = { readonly status: number; readonly json: unknown } | 'NETWORK';
  const replies = (...r: Reply[]) => {
    const queue = [...r];
    return vi.fn(async () => {
      const next = queue.shift() ?? { status: 500, json: {} };
      if (next === 'NETWORK') throw new TypeError('fetch failed');
      return new Response(JSON.stringify(next.json), { status: next.status });
    });
  };
  const call = (fn: ReturnType<typeof replies>, i: number) =>
    fn.mock.calls[i] as unknown as [string, RequestInit];
  const none = { status: 200, json: { entity: 'collection', count: 0, items: [] } };
  const refund = (status: string, receipt = REFUND_ID) => ({
    id: 'rfnd_9',
    entity: 'refund',
    amount: 250000,
    currency: 'INR',
    payment_id: 'pay_1',
    receipt,
    status,
  });
  const listOf = (...items: unknown[]) => ({
    status: 200,
    json: { entity: 'collection', count: items.length, items },
  });

  it('looks for an earlier refund with our receipt, then refunds integer paise with the receipt and notes', async () => {
    const fetchFn = replies(none, { status: 200, json: refund('processed') });
    const out = await new RazorpayGateway(creds, fetchFn).refund(input(250_000n));
    expect(out).toEqual({ status: 'PROCESSED', providerRefundId: 'rfnd_9' });
    expect(call(fetchFn, 0)[0]).toBe(
      'https://api.razorpay.com/v1/payments/pay_1/refunds?count=100',
    );
    const [url, init] = call(fetchFn, 1);
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_1/refund');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-refund-idempotency']).toBe(REFUND_ID);
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 250000,
      speed: 'normal',
      receipt: REFUND_ID,
      notes: { refund_id: REFUND_ID, booking_id: 'b-1' },
    });
  });

  it('never refunds twice: an earlier refund with the same receipt is reported instead', async () => {
    const fetchFn = replies(listOf(refund('pending')));
    expect(await new RazorpayGateway(creds, fetchFn).refund(input(250_000n))).toEqual({
      status: 'PENDING',
      providerRefundId: 'rfnd_9',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('after an error, asks again: found is reported, missing is UNKNOWN (retry later)', async () => {
    const found = replies(none, { status: 502, json: {} }, listOf(refund('processed')));
    expect(await new RazorpayGateway(creds, found).refund(input(250_000n))).toMatchObject({
      status: 'PROCESSED',
    });
    const lost = replies(none, 'NETWORK', none);
    expect(await new RazorpayGateway(creds, lost).refund(input(250_000n))).toEqual({
      status: 'UNKNOWN',
    });
    expect(await new RazorpayGateway(creds, replies('NETWORK')).refund(input(1n))).toEqual({
      status: 'UNKNOWN',
    });
  });

  it('a refund the gateway refuses outright (400) is FAILED with no gateway id', async () => {
    const fetchFn = replies(
      none,
      { status: 400, json: { error: { code: 'BAD_REQUEST_ERROR' } } },
      none,
    );
    expect(await new RazorpayGateway(creds, fetchFn).refund(input(250_000n))).toEqual({
      status: 'FAILED',
      providerRefundId: null,
      reason: 'The gateway refused the refund (HTTP 400)',
    });
  });

  it('findRefund reports a failed refund with its id, and null when there is none', async () => {
    expect(
      await new RazorpayGateway(creds, replies(listOf(refund('failed')))).findRefund(
        'pay_1',
        REFUND_ID,
      ),
    ).toEqual({
      status: 'FAILED',
      providerRefundId: 'rfnd_9',
      reason: 'The gateway failed the refund',
    });
    expect(
      await new RazorpayGateway(creds, replies(none)).findRefund('pay_1', REFUND_ID),
    ).toBeNull();
  });
});

describe('maskVpa — a VPA often holds the client phone (security review M5)', () => {
  it('keeps two characters and the handle', async () => {
    const { maskVpa, paidWithLabel } = await import('../../refunds.types.js');
    expect(maskVpa('9876543210@ybl')).toBe('98•••@ybl');
    expect(paidWithLabel('upi', 'ananya@okicici')).toBe('UPI · an•••@okicici');
    expect(paidWithLabel('card', '4242')).toBe('Card ending 4242');
  });
});
