import { ApiError } from '@clickco/api-client';
import type { CancellationOutcome, CancellationQuote } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { cancelEntry, cancelFailure, outcomeCopy, quoteCopy } from './cancellation';

const BOOKING = '7d1f2a9c-3b4e-4c5d-8e6f-0a1b2c3d4e5f';

function quote(overrides: Partial<CancellationQuote> = {}): CancellationQuote {
  return {
    bookingId: BOOKING,
    cancellable: true,
    blockedBy: null,
    band: 'MORE_THAN_7_DAYS',
    clause: '3.1',
    reason:
      'You are cancelling more than 7 days before the shoot, so your full advance comes back.',
    peakSeason: false,
    paidPaise: 576_700,
    refundPaise: 576_700,
    keptPaise: 0,
    heldPaise: 0,
    refundBps: 10_000,
    changesAt: null,
    quotedAt: '2026-11-05T06:30:00.000Z',
    ...overrides,
  };
}

const http = (status: number, code: string, message = 'x') =>
  new ApiError({ kind: 'HTTP', status, code, message });

describe('cancelEntry: the quote decides, never a local copy of the ladder', () => {
  it('offers Cancel only when the quote says the booking is cancellable', () => {
    expect(cancelEntry(quote())).toEqual({ kind: 'offer' });
    expect(cancelEntry(undefined)).toEqual({ kind: 'hidden' });
  });

  it('explains a settling payment and a passed start time, and hides the rest', () => {
    const settling = quote({
      cancellable: false,
      blockedBy: 'PAYMENT_SETTLING',
      band: null,
      reason:
        'A photographer has just accepted and your payment is being confirmed. Try again in a minute.',
    });
    expect(cancelEntry(settling)).toEqual({ kind: 'note', text: settling.reason });
    const passed = quote({
      cancellable: false,
      blockedBy: 'SHOOT_TIME_PASSED',
      band: null,
      reason: 'late',
    });
    expect(cancelEntry(passed)).toEqual({ kind: 'note', text: 'late' });
    for (const blockedBy of ['ALREADY_CANCELLED', 'SHOOT_STARTED', 'NOT_CANCELLABLE'] as const) {
      expect(cancelEntry(quote({ cancellable: false, blockedBy, band: null }))).toEqual({
        kind: 'hidden',
      });
    }
  });
});

describe('quoteCopy: the quote in plain words', () => {
  it('a full refund: the amount in Indian grouping, where it goes and when', () => {
    const copy = quoteCopy(quote());
    expect(copy.summary).toBe(
      "You'll get ₹5,767 back to the card or UPI account you paid with, within 7–10 working days.",
    );
    expect(copy.reason).toBe(quote().reason);
    expect(copy.rows).toEqual([
      { key: 'paid', label: 'You paid', value: '₹5,767' },
      { key: 'back', label: 'Comes back to you', value: '₹5,767' },
    ]);
    expect(copy.deadline).toBeNull();
  });

  it('a partial refund shows what is kept and when the figure stops applying', () => {
    const copy = quoteCopy(
      quote({
        band: 'HOURS_24_TO_72',
        reason:
          'You are cancelling 24 to 72 hours before the shoot, so half of your advance comes back.',
        paidPaise: 1_20_000_00,
        refundPaise: 60_000_00,
        keptPaise: 60_000_00,
        refundBps: 5_000,
        // 9 Nov, 6:00 pm IST
        changesAt: '2026-11-09T12:30:00.000Z',
      }),
    );
    expect(copy.summary).toContain("You'll get ₹60,000 back");
    expect(copy.rows.map((row) => [row.label, row.value])).toEqual([
      ['You paid', '₹1,20,000'],
      ['Comes back to you', '₹60,000'],
      ['Not refunded', '₹60,000'],
    ]);
    expect(copy.deadline).toBe(
      'This amount applies if you cancel before 9 Nov, 6:00 pm. After that, less comes back.',
    );
  });

  it('under 24 hours: the advance is not refundable, said once', () => {
    const copy = quoteCopy(
      quote({ band: 'UNDER_24_HOURS', refundPaise: 0, keptPaise: 576_700, refundBps: 0 }),
    );
    expect(copy.summary).toBe(
      "This booking is less than 24 hours away, so the advance isn't refundable.",
    );
    expect(copy.reason).toBeNull();
    expect(copy.rows.find((row) => row.key === 'back')?.value).toBe('₹0');
    expect(copy.deadline).toBeNull();
  });

  it('a same-day booking after acceptance has its own reason', () => {
    const copy = quoteCopy(
      quote({ band: 'EMERGENCY_AFTER_ACCEPTANCE', refundPaise: 0, keptPaise: 576_700 }),
    );
    expect(copy.summary).toContain('already accepted this same-day booking');
  });

  it('any other band with nothing back names the amount and keeps the API reason', () => {
    const copy = quoteCopy(
      quote({
        band: 'PEAK_SEASON_UNDER_7_DAYS',
        refundPaise: 0,
        keptPaise: 50_000,
        reason: 'peak',
      }),
    );
    expect(copy.summary).toBe("If you cancel now, the ₹5,767 you paid isn't refundable.");
    expect(copy.reason).toBe('peak');
  });

  it('before payment: free to cancel, and no money rows', () => {
    const copy = quoteCopy(
      quote({ band: 'BEFORE_PAYMENT', clause: null, paidPaise: 0, refundPaise: 0 }),
    );
    expect(copy.summary).toBe('Nothing has been charged yet, so you can cancel free of charge.');
    expect(copy.reason).toBeNull();
    expect(copy.rows).toEqual([]);
  });

  it('an uncharged hold is released in full, with paise shown when there are any', () => {
    const copy = quoteCopy(
      quote({
        band: 'EMERGENCY_BEFORE_ACCEPTANCE',
        paidPaise: 0,
        refundPaise: 0,
        heldPaise: 488_750,
      }),
    );
    expect(copy.summary).toBe(
      "The ₹4,887.50 held for this booking is released, so you won't be charged it.",
    );
    expect(copy.rows).toEqual([{ key: 'held', label: 'Hold released', value: '₹4,887.50' }]);
  });
});

describe('outcomeCopy: the success state', () => {
  const outcome = (o: Partial<CancellationOutcome>): CancellationOutcome => ({
    band: 'MORE_THAN_7_DAYS',
    clause: '3.1',
    refundPaise: 576_700,
    keptPaise: 0,
    heldPaise: 0,
    refundBps: 10_000,
    peakSeason: false,
    refundIds: [],
    cancelledAt: '2026-11-05T06:31:00.000Z',
    ...o,
  });

  it('says the refund is on its way and when it lands', () => {
    expect(outcomeCopy(outcome({}))).toBe(
      '₹5,767 is on its way back to the card or UPI account you paid with. It reaches you within 7–10 working days.',
    );
  });

  it('says when nothing comes back, and why', () => {
    expect(outcomeCopy(outcome({ refundPaise: 0, keptPaise: 576_700 }))).toBe(
      'No refund was due under the cancellation terms.',
    );
    expect(outcomeCopy(outcome({ refundPaise: 0 }))).toBe(
      'Nothing was charged, so there is nothing to refund.',
    );
    expect(outcomeCopy(outcome({ refundPaise: 0, heldPaise: 100_000 }))).toContain(
      'hold is released',
    );
  });
});

describe('cancelFailure: every refusal in plain words, with what to do next', () => {
  it('a changed amount means quote again, never a silent retry', () => {
    const failure = cancelFailure(
      http(409, 'CANCELLATION_TERMS_CHANGED', 'Cancelling now returns ₹2,883.50.'),
    );
    expect(failure.next).toBe('requote');
    expect(failure.message).toContain('The refund changed');
    expect(cancelFailure(http(422, 'CANCELLATION_CONFIRMATION_REQUIRED')).next).toBe('requote');
  });

  it.each([
    ['ALREADY_CANCELLED', 'refresh', 'already cancelled'],
    ['CANCEL_NOT_AVAILABLE', 'refresh', 'no-show is refunded in full'],
    ['CANCEL_PAYMENT_SETTLING', 'retry', 'Try again in a minute'],
    ['IDEMPOTENCY_REQUEST_IN_PROGRESS', 'retry', 'still working'],
  ])('409 %s → %s', (code, next, words) => {
    const failure = cancelFailure(http(409, code, 'CancelException'));
    expect(failure.next).toBe(next);
    expect(failure.message).toContain(words);
    expect(failure.message).not.toContain(code);
  });

  it('a missing booking is final; offline, server trouble and rate limits are worth a retry', () => {
    expect(cancelFailure(http(404, 'BOOKING_NOT_FOUND'))).toEqual({
      message: "We can't find this booking on your account.",
      next: 'final',
    });
    expect(
      cancelFailure(new ApiError({ kind: 'NETWORK', status: 0, code: 'NETWORK', message: 'x' })),
    ).toEqual({
      message: 'You seem to be offline. Check your connection and try again.',
      next: 'retry',
    });
    expect(cancelFailure(http(500, 'ERROR')).next).toBe('retry');
    expect(cancelFailure(http(429, 'RATE_LIMITED', 'Too Many Requests')).next).toBe('retry');
    expect(cancelFailure(http(403, 'FORBIDDEN', 'Forbidden resource'))).toEqual({
      message: "You don't have access to this.",
      next: 'final',
    });
  });
});
