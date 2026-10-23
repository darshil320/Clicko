import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { booking, harness, NOW, payment, succeeded } from './payment-flow.harness';

/** Held (<3h) payments, lock order and late fees on the webhook path (ADR-0011/0012). */
describe('PaymentFlowService.handleWebhook — holds and late gateway facts', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('books the capture-on-acceptance of a held payment (ADR-0011): invoice, amount paid, no transition', async () => {
    const held = payment({
      purpose: 'FULL',
      status: 'AUTHORIZED',
      isAuthOnly: true,
      providerPaymentId: 'pay_gw_1',
    });
    const h = harness({
      payment: held,
      booking: booking('ASSIGNED', { emergencyBand: 'HOURS_UNDER_3' }),
      event: succeeded('PAYMENT_CAPTURED'),
    });
    expect(await h.run()).toBe('APPLIED');
    expect(h.payments.recordCapture).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ invoiceBasis: { taxablePaise: 1n } }),
    );
    expect(h.bookings.addAmountPaid).toHaveBeenCalledWith({}, 'bk-1', 500_000n);
    expect(h.bookings.transition).not.toHaveBeenCalled();
    expect(h.payments.flagForReview).not.toHaveBeenCalled();
  });

  it('flags a capture of a held payment while the booking still awaits a photographer', async () => {
    const held = payment({ purpose: 'FULL', status: 'AUTHORIZED', isAuthOnly: true });
    const h = harness({
      payment: held,
      booking: booking('DISPATCHING', { emergencyBand: 'HOURS_UNDER_3' }),
      event: succeeded('PAYMENT_CAPTURED'),
    });
    expect(await h.run()).toBe('NEEDS_REVIEW');
    expect(h.payments.recordCapture).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ invoiceBasis: null }),
    );
    expect(h.payments.flagForReview).toHaveBeenCalled();
  });

  it('locks the booking before the payment (ADR-0012 D4 lock order)', async () => {
    const h = harness({ event: succeeded('PAYMENT_CAPTURED') });
    await h.run();
    const bookingLock = h.bookings.lock.mock.invocationCallOrder[0] ?? 0;
    const paymentLock = h.payments.lockByOrder.mock.invocationCallOrder[0] ?? 0;
    expect(bookingLock).toBeGreaterThan(0);
    expect(bookingLock).toBeLessThan(paymentLock);
  });

  it('books a capture that lands after the hold was released, and flags it for refund', async () => {
    const released = payment({
      purpose: 'FULL',
      status: 'AUTH_RELEASED',
      isAuthOnly: true,
      providerPaymentId: 'pay_gw_1',
    });
    const h = harness({
      payment: released,
      booking: booking('CANCELLED_PRO', { emergencyBand: 'HOURS_UNDER_3' }),
      event: succeeded('PAYMENT_CAPTURED'),
    });
    expect(await h.run()).toBe('NEEDS_REVIEW');
    expect(h.payments.recordCapture).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ invoiceBasis: null }),
    );
    expect(h.bookings.addAmountPaid).toHaveBeenCalledWith({}, 'bk-1', 500_000n);
    expect(h.payments.flagForReview).toHaveBeenCalledWith(
      {},
      released,
      'CAPTURED_AFTER_RELEASE',
      500_000n,
    );
  });

  it('posts the gateway fee a webhook brings after dispatch already booked the capture', async () => {
    const captured = payment({ status: 'CAPTURED', providerPaymentId: 'pay_gw_1' });
    const event = { ...succeeded('PAYMENT_CAPTURED'), feePaise: 1_180n };
    const h = harness({ payment: captured, event });
    expect(await h.run()).toBe('ALREADY_APPLIED');
    expect(h.payments.recordLateFee).toHaveBeenCalledWith({}, captured, 1_180n, NOW);
  });
});
