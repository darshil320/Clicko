import { describe, expect, it } from 'vitest';
import {
  CancelBookingBody,
  CancelBookingResponse,
  CancellationQuote,
  PayoutBasis,
} from './index.js';

const BOOKING = '7a1c2f0e-4b8d-4c3e-9f21-0d5e6a7b8c9d';

const quote = {
  bookingId: BOOKING,
  cancellable: true,
  blockedBy: null,
  band: 'HOURS_24_TO_72',
  clause: '3.1',
  reason: 'You are cancelling 24 to 72 hours before the shoot, so half of your advance comes back.',
  peakSeason: false,
  paidPaise: 501_500,
  refundPaise: 250_750,
  keptPaise: 250_750,
  heldPaise: 0,
  refundBps: 5_000,
  changesAt: '2027-03-09T04:30:00.000Z',
  quotedAt: '2027-03-07T04:30:00.000Z',
};

describe('cancellation contracts', () => {
  it('a quote carries integer paise only', () => {
    expect(CancellationQuote.parse(quote).refundPaise).toBe(250_750);
    expect(CancellationQuote.safeParse({ ...quote, refundPaise: 2507.5 }).success).toBe(false);
    expect(CancellationQuote.safeParse({ ...quote, refundBps: 10_001 }).success).toBe(false);
    expect(CancellationQuote.safeParse({ ...quote, band: 'FREE' }).success).toBe(false);
  });

  it('the cancel body takes the confirmed refund, or nothing before payment', () => {
    expect(CancelBookingBody.parse({})).toEqual({});
    expect(CancelBookingBody.parse({ expectedRefundPaise: 0 })).toEqual({ expectedRefundPaise: 0 });
    expect(CancelBookingBody.safeParse({ expectedRefundPaise: -1 }).success).toBe(false);
    expect(CancelBookingBody.safeParse({ expectedRefundPaise: '100' }).success).toBe(false);
  });

  it('the response is the booking summary plus what the cancellation did', () => {
    const parsed = CancelBookingResponse.parse({
      id: BOOKING,
      reference: 'CLK-1042',
      status: 'CANCELLED_CLIENT',
      tier: 'PROFESSIONAL',
      categoryCode: 'FOOD',
      cityName: 'Surat',
      scheduledStart: '2027-03-10T04:30:00.000Z',
      scheduledHours: 2,
      emergencyBand: 'NONE',
      venueAddress: '4 Athwalines, Surat',
      totalPaise: 1_003_000,
      advancePaise: 501_500,
      balancePaise: 501_500,
      amountPaidPaise: 501_500,
      quoteExpiresAt: null,
      createdAt: '2027-02-24T04:30:00.000Z',
      cancellation: {
        band: 'HOURS_24_TO_72',
        clause: '3.1',
        refundPaise: 250_750,
        keptPaise: 250_750,
        heldPaise: 0,
        refundBps: 5_000,
        peakSeason: false,
        refundIds: [BOOKING],
        cancelledAt: '2027-03-08T04:30:00.000Z',
      },
    });
    expect(parsed.status).toBe('CANCELLED_CLIENT');
    expect(parsed.cancellation.refundIds).toHaveLength(1);
  });

  it('a client cancellation is a payout basis (addendum 0019)', () => {
    expect(PayoutBasis.options).toContain('CLIENT_CANCELLED');
  });
});
