import { describe, expect, it } from 'vitest';
import {
  ClientBookingMoney,
  ClientQualityIssueBody,
  ClientTicketBody,
  ProEarnings,
  ProPaidTransfer,
} from './index.js';

const UUID = '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f';
const AT = '2026-12-07T10:00:00+05:30';

describe('client care and money contracts (ADR-0027 D5)', () => {
  it('a ticket needs a category and 10–2,000 characters of message, trimmed', () => {
    expect(ClientTicketBody.parse({ category: 'BILLING', message: '  Charged twice!!  ' })).toEqual(
      { category: 'BILLING', message: 'Charged twice!!' },
    );
    expect(
      ClientTicketBody.safeParse({ category: 'BILLING', message: '   short   ' }).success,
    ).toBe(false);
    expect(
      ClientTicketBody.safeParse({ category: 'BILLING', message: 'x'.repeat(2_001) }).success,
    ).toBe(false);
    expect(
      ClientTicketBody.safeParse({ category: 'REFUND', message: 'Charged twice!!' }).success,
    ).toBe(false);
    expect(
      ClientTicketBody.safeParse({ bookingId: '../x', category: 'OTHER', message: 'Hello there!' })
        .success,
    ).toBe(false);
  });

  it('a quality complaint is 10–2,000 characters', () => {
    expect(ClientQualityIssueBody.safeParse({ complaint: 'Blurry photos' }).success).toBe(true);
    expect(ClientQualityIssueBody.safeParse({ complaint: 'bad' }).success).toBe(false);
  });

  it('refunds are only PROCESSING or REFUNDED to the client; money is whole paise', () => {
    const money = {
      bookingId: UUID,
      refunds: [
        { id: UUID, amountPaise: 100_000, status: 'REFUNDED', initiatedAt: AT, completedAt: AT },
      ],
      credits: [],
    };
    expect(ClientBookingMoney.safeParse(money).success).toBe(true);
    const requested = { ...money, refunds: [{ ...money.refunds[0], status: 'REQUESTED' }] };
    expect(ClientBookingMoney.safeParse(requested).success).toBe(false);
    const fractional = { ...money, refunds: [{ ...money.refunds[0], amountPaise: 10.5 }] };
    expect(ClientBookingMoney.safeParse(fractional).success).toBe(false);
  });

  it('a paid transfer carries only the last 4 characters of the UTR', () => {
    const transfer = {
      batchReference: 'PO20261214W',
      paidAt: AT,
      payoutCount: 1,
      grossPaise: 520_000,
      deductionsPaise: 0,
      tdsPaise: 0,
      netPaise: 520_000,
      utrLast4: '0077',
    };
    expect(ProPaidTransfer.safeParse(transfer).success).toBe(true);
    expect(ProPaidTransfer.safeParse({ ...transfer, utrLast4: null }).success).toBe(true);
    expect(ProPaidTransfer.safeParse({ ...transfer, utrLast4: 'HDFCN26121400077' }).success).toBe(
      false,
    );
    const earnings = {
      basis: 'EXPECTED',
      asOf: AT,
      todayPaise: 0,
      weekPaise: 0,
      monthPaise: 0,
      pendingPayoutPaise: 0,
      jobs: [],
    };
    expect(ProEarnings.safeParse(earnings).success).toBe(true);
    expect(ProEarnings.safeParse({ ...earnings, paidTransfers: [transfer] }).success).toBe(true);
  });
});
