import { HttpException, Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GatewayEvent } from '../../payments/gateways/payment-gateway.port';
import { booking, harness, NOW, payment, START, succeeded } from './payment-flow.harness';

describe('PaymentFlowService.handleWebhook', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('captures, invoices, adds to amount paid and confirms an ADVANCE_PENDING booking', async () => {
    const h = harness({ event: succeeded('PAYMENT_CAPTURED') });
    expect(await h.run()).toBe('APPLIED');
    expect(h.payments.recordCapture).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ invoiceBasis: { taxablePaise: 1n }, capturedAt: NOW }),
    );
    expect(h.bookings.addAmountPaid).toHaveBeenCalledWith({}, 'bk-1', 500_000n);
    expect(h.bookings.transition).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        to: 'CONFIRMED',
        payload: { payment_id: 'pay-1', amount_captured_paise: 500000, is_auth_only: false },
      }),
    );
    expect(h.payments.markWebhookProcessed).toHaveBeenCalledWith('wh-1', null);
  });

  it('is a no-op for a replay of the capture already recorded', async () => {
    const h = harness({
      event: succeeded('PAYMENT_CAPTURED'),
      payment: payment({ status: 'CAPTURED', providerPaymentId: 'pay_gw_1' }),
    });
    expect(await h.run()).toBe('ALREADY_APPLIED');
    expect(h.payments.recordCapture).not.toHaveBeenCalled();
    expect(h.bookings.transition).not.toHaveBeenCalled();
  });

  it('flags a second successful payment on an already-captured order as a double charge', async () => {
    const h = harness({
      event: succeeded('PAYMENT_CAPTURED'),
      payment: payment({ status: 'CAPTURED', providerPaymentId: 'pay_gw_0' }),
    });
    expect(await h.run()).toBe('NEEDS_REVIEW');
    expect(h.payments.recordCapture).not.toHaveBeenCalled();
    expect(h.payments.flagForReview).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: 'pay-1' }),
      expect.stringMatching(/^SECOND_CAPTURE_ON_CAPTURED/),
      500_000n,
    );
  });

  it('never re-captures a refunded payment on a replay', async () => {
    // AUTH_RELEASED is not a replay: a capture there means money moved (CAPTURED_AFTER_RELEASE, below).
    for (const status of ['REFUNDED', 'PARTIALLY_REFUNDED'] as const) {
      const h = harness({
        event: succeeded('PAYMENT_CAPTURED'),
        payment: payment({ status, providerPaymentId: 'pay_gw_1' }),
      });
      expect(await h.run()).toBe('ALREADY_APPLIED');
      expect(h.payments.recordCapture).not.toHaveBeenCalled();
      expect(h.bookings.addAmountPaid).not.toHaveBeenCalled();
    }
  });

  it('records but does not confirm a capture that lands after the payment window', async () => {
    const h = harness({
      event: succeeded('PAYMENT_CAPTURED'),
      booking: booking('ADVANCE_PENDING', {
        quoteExpiresAt: new Date(NOW.getTime() - 31 * 60_000),
      }),
    });
    expect(await h.run()).toBe('NEEDS_REVIEW');
    expect(h.payments.recordCapture).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ invoiceBasis: null }),
    );
    expect(h.bookings.transition).not.toHaveBeenCalled();
    expect(h.payments.flagForReview).toHaveBeenCalledWith(
      {},
      expect.anything(),
      'CAPTURED_AFTER_PAYMENT_WINDOW',
      500_000n,
    );
  });

  it('releases the hold at once when the shoot is under 90 minutes away', async () => {
    const soon = new Date(NOW.getTime() + 60 * 60_000);
    const h = harness({
      event: succeeded('PAYMENT_AUTHORIZED'),
      payment: payment({ isAuthOnly: true, purpose: 'FULL' }),
      booking: booking('ADVANCE_PENDING', { scheduledStart: soon, emergencyBand: 'HOURS_UNDER_3' }),
    });
    expect(await h.run()).toBe('APPLIED');
    expect(h.payments.markAuthorized).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ authorizedAt: NOW, authExpiresAt: NOW }),
    );
  });

  it('flags an order it does not know without touching anything', async () => {
    const h = harness({ event: succeeded('PAYMENT_CAPTURED'), payment: null });
    expect(await h.run()).toBe('UNKNOWN_ORDER');
    expect(h.payments.markWebhookProcessed).toHaveBeenCalledWith(
      'wh-1',
      expect.stringMatching(/order_1/),
    );
  });

  it('refuses to apply a captured amount that differs from the order', async () => {
    const h = harness({ event: succeeded('PAYMENT_CAPTURED', 499_999n) });
    expect(await h.run()).toBe('NEEDS_REVIEW');
    expect(h.payments.recordCapture).not.toHaveBeenCalled();
    expect(h.payments.flagForReview).toHaveBeenCalled();
    expect(h.payments.markWebhookProcessed).toHaveBeenCalledWith(
      'wh-1',
      expect.stringMatching(/^AMOUNT_MISMATCH/),
    );
  });

  it('records money that lands after a cancellation, without an invoice or a transition', async () => {
    const h = harness({
      event: succeeded('PAYMENT_CAPTURED'),
      booking: booking('CANCELLED_CLIENT'),
    });
    expect(await h.run()).toBe('NEEDS_REVIEW');
    expect(h.payments.recordCapture).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ invoiceBasis: null }),
    );
    expect(h.bookings.addAmountPaid).toHaveBeenCalled();
    expect(h.bookings.transition).not.toHaveBeenCalled();
    expect(h.payments.flagForReview).toHaveBeenCalledWith(
      {},
      expect.anything(),
      'CAPTURED_WHILE_CANCELLED_CLIENT',
      500_000n,
    );
  });

  it('treats a signed but malformed webhook as needing review', async () => {
    const h = harness({ event: { kind: 'IGNORED', eventType: 'x' } });
    h.payments.ingestWebhook.mockResolvedValueOnce({ kind: 'MALFORMED' } as never);
    expect(await h.run()).toBe('NEEDS_REVIEW');
    expect(h.payments.markWebhookProcessed).not.toHaveBeenCalled();
  });

  it('ignores an authorisation of a normal payment and waits for its capture', async () => {
    const h = harness({ event: succeeded('PAYMENT_AUTHORIZED') });
    expect(await h.run()).toBe('IGNORED');
    expect(h.payments.markAuthorized).not.toHaveBeenCalled();
  });

  it('confirms an authorise-only payment, holding it until 90 minutes before the shoot', async () => {
    const h = harness({
      event: succeeded('PAYMENT_AUTHORIZED'),
      payment: payment({ isAuthOnly: true, purpose: 'FULL' }),
    });
    expect(await h.run()).toBe('APPLIED');
    expect(h.payments.markAuthorized).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ authExpiresAt: new Date(START.getTime() - 90 * 60_000) }),
    );
    expect(h.bookings.transition).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        to: 'CONFIRMED',
        payload: expect.objectContaining({ is_auth_only: true }),
      }),
    );
    expect(h.bookings.addAmountPaid).not.toHaveBeenCalled();
  });

  it('marks only an untouched order as failed', async () => {
    const failed: GatewayEvent = {
      kind: 'PAYMENT_FAILED',
      eventType: 'payment.failed',
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_gw_1',
      failureCode: 'X',
      failureReason: 'declined',
    };
    expect(await harness({ event: failed }).run()).toBe('APPLIED');
    const late = harness({ event: failed, payment: payment({ status: 'CAPTURED' }) });
    expect(await late.run()).toBe('ALREADY_APPLIED');
    expect(late.payments.markFailed).not.toHaveBeenCalled();
  });

  it('leaves the webhook unprocessed and rethrows when applying fails, so the retry runs again', async () => {
    const h = harness({ event: succeeded('PAYMENT_CAPTURED') });
    h.payments.recordCapture.mockRejectedValueOnce(new Error('db down'));
    await expect(h.run()).rejects.toThrow('db down');
    expect(h.payments.markWebhookFailed).toHaveBeenCalledWith('wh-1', 'db down');
    expect(h.payments.markWebhookProcessed).not.toHaveBeenCalled();
  });
});

describe('PaymentFlowService.pay', () => {
  const statusOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof HttpException) return (e.getResponse() as { code: string }).code;
      throw e;
    }
    return 'OK';
  };

  it("answers 404 for someone else's booking", async () => {
    const h = harness({ event: { kind: 'IGNORED', eventType: 'x' } });
    expect(await statusOf(h.flow.pay('intruder', 'bk-1'))).toBe('BOOKING_NOT_FOUND');
  });

  it('stops handing out the open order once the payment window has closed', async () => {
    const h = harness({
      event: { kind: 'IGNORED', eventType: 'x' },
      booking: booking('ADVANCE_PENDING', {
        quoteExpiresAt: new Date(NOW.getTime() - 31 * 60_000),
      }),
    });
    expect(await statusOf(h.flow.pay('u-1', 'bk-1'))).toBe('QUOTE_EXPIRED');
  });

  it('refuses a booking that is past payment', async () => {
    const h = harness({
      event: { kind: 'IGNORED', eventType: 'x' },
      booking: booking('CONFIRMED'),
    });
    expect(await statusOf(h.flow.pay('u-1', 'bk-1'))).toBe('BOOKING_NOT_PAYABLE');
  });
});
