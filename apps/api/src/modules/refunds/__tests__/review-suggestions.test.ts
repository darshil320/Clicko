import { describe, expect, it } from 'vitest';
import { type ReviewFacts, reviewTitle, suggestOutcome } from '../review-suggestions';

const facts = (over: Partial<ReviewFacts>): ReviewFacts => ({
  type: 'booking.needs_review',
  reason: 'X',
  details: {},
  bookingTotalPaise: 1_690_822n,
  netPaidPaise: 845_411n,
  refundablePaise: 845_411n,
  balanceDuePaise: 845_411n,
  breach: null,
  ...over,
});

describe('suggestOutcome — what a review item most likely needs (ADR-0026 D2)', () => {
  it('unfilled booking: refund what was captured on the flagged payment', () => {
    expect(
      suggestOutcome(facts({ type: 'payment.needs_review', reason: 'REFUND_DUE_UNFILLED' })),
    ).toMatchObject({
      outcome: 'REFUND_REQUESTED',
      amountPaise: 845_411n,
      creditPaise: 0n,
      refundReason: 'UNFILLED',
    });
  });

  it('photographer no-show: full refund plus the ₹500 apology credit (T&C §3.6)', () => {
    expect(
      suggestOutcome(facts({ type: 'payment.needs_review', reason: 'REFUND_DUE_NO_SHOW' })),
    ).toMatchObject({
      outcome: 'REFUND_REQUESTED',
      amountPaise: 845_411n,
      creditPaise: 50_000n,
      refundReason: 'PRO_NO_SHOW',
    });
  });

  it('late replacement: a 25% service credit on the booking value', () => {
    expect(
      suggestOutcome(
        facts({ reason: 'LATE_REPLACEMENT_CREDIT_25', details: { credit_bps: 2500 } }),
      ),
    ).toMatchObject({
      outcome: 'CREDIT_ISSUED',
      amountPaise: 422_706n,
      creditReason: 'LATE_REPLACEMENT',
    });
  });

  it('access denied: 50% is chargeable — refund anything paid above it, charge any shortfall', () => {
    const charge = 845_411n; // roundHalfUp(1690822 × 50%)
    expect(suggestOutcome(facts({ reason: 'ACCESS_DENIED_CHARGE_50' }))).toMatchObject({
      outcome: 'NO_ACTION',
    });
    expect(
      suggestOutcome(
        facts({
          reason: 'ACCESS_DENIED_CHARGE_50',
          netPaidPaise: 1_690_822n,
          refundablePaise: 1_690_822n,
        }),
      ),
    ).toMatchObject({
      outcome: 'REFUND_REQUESTED',
      amountPaise: 1_690_822n - charge,
      refundReason: 'ACCESS_DENIED',
    });
    expect(
      suggestOutcome(
        facts({ reason: 'ACCESS_DENIED_CHARGE_50', netPaidPaise: 0n, refundablePaise: 0n }),
      ),
    ).toMatchObject({ outcome: 'CHARGE_RAISED', amountPaise: charge });
  });

  it('client did not attend: treated as completed, the balance is due (T&C §3.8)', () => {
    expect(suggestOutcome(facts({ reason: 'CLIENT_NON_ATTENDANCE' }))).toMatchObject({
      outcome: 'CHARGE_RAISED',
      amountPaise: 845_411n,
    });
    expect(
      suggestOutcome(facts({ reason: 'CLIENT_NON_ATTENDANCE', balanceDuePaise: 0n })),
    ).toMatchObject({ outcome: 'NO_ACTION' });
  });

  it('unsafe site: billed in full, no refund (T&C §8.3) unless staff choose goodwill', () => {
    expect(suggestOutcome(facts({ reason: 'UNSAFE_SITE_PARTIAL_CHARGE' }))).toMatchObject({
      outcome: 'NO_ACTION',
    });
  });

  it('late delivery: the breach table decides — credit or refund — and nothing when not owed', () => {
    expect(
      suggestOutcome(
        facts({
          reason: 'SLA_BREACH_REMEDY',
          breach: { remedyKind: 'CREDIT', remedyPaise: 169_082n, owed: true },
        }),
      ),
    ).toMatchObject({
      outcome: 'CREDIT_ISSUED',
      amountPaise: 169_082n,
      creditReason: 'SLA_BREACH',
    });
    expect(
      suggestOutcome(
        facts({
          reason: 'SLA_BREACH_REMEDY',
          breach: { remedyKind: 'PARTIAL_REFUND', remedyPaise: 422_706n, owed: true },
        }),
      ),
    ).toMatchObject({
      outcome: 'REFUND_REQUESTED',
      amountPaise: 422_706n,
      refundReason: 'SLA_BREACH',
    });
    expect(
      suggestOutcome(
        facts({
          reason: 'SLA_BREACH_REMEDY',
          breach: { remedyKind: 'CREDIT', remedyPaise: 169_082n, owed: false },
        }),
      ),
    ).toMatchObject({ outcome: 'NO_ACTION' });
  });

  it('money captured off the happy path goes back; a mismatch is reconciled, not refunded', () => {
    expect(
      suggestOutcome(
        facts({
          type: 'payment.needs_review',
          reason: 'CAPTURED_AFTER_RELEASE',
          details: { amount_paise: 300_000 },
          refundablePaise: 300_000n,
        }),
      ),
    ).toMatchObject({
      outcome: 'REFUND_REQUESTED',
      amountPaise: 300_000n,
      refundReason: 'PAYMENT_ANOMALY',
    });
    expect(
      suggestOutcome(
        facts({ type: 'payment.needs_review', reason: 'AMOUNT_MISMATCH: expected 1, got 2' }),
      ),
    ).toMatchObject({ outcome: 'NO_ACTION' });
  });

  it('suggests no action when everything was already refunded', () => {
    expect(
      suggestOutcome(
        facts({ type: 'payment.needs_review', reason: 'REFUND_DUE_UNFILLED', refundablePaise: 0n }),
      ),
    ).toMatchObject({ outcome: 'NO_ACTION', amountPaise: 0n });
  });

  it('always explains itself in plain words', () => {
    const s = suggestOutcome(facts({ reason: 'SOMETHING_NEW' }));
    expect(s.outcome).toBe('NO_ACTION');
    expect(s.why.length).toBeGreaterThan(10);
  });
});

describe('reviewTitle — no raw codes on screen', () => {
  it('names the known reasons in plain language and humanises unknown ones', () => {
    expect(reviewTitle('REFUND_DUE_NO_SHOW')).toBe('Photographer did not show up');
    expect(reviewTitle('SLA_BREACH_REMEDY')).toBe('Photos delivered late');
    expect(reviewTitle('SECOND_CAPTURE_ON_CAPTURED: pay_x')).toBe('Client charged twice');
    expect(reviewTitle('SOME_NEW_REASON')).toBe('Some new reason');
  });
});
