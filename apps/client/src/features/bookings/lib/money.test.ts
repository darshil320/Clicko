import type {
  ClientBookingCredit,
  ClientBookingMoney,
  ClientBookingRefund,
} from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { creditRow, hasMoneyToShow, moneyRows, refundRow } from './money';

const BOOKING = '8e3f1a2b-4c5d-4e6f-9a0b-000000000001';

const refund = (over: Partial<ClientBookingRefund> = {}): ClientBookingRefund => ({
  id: '5b0e7c1a-9d2f-4e3b-8a6c-000000000001',
  amountPaise: 250_000,
  status: 'PROCESSING',
  initiatedAt: '2026-11-02T10:00:00+05:30',
  completedAt: null,
  ...over,
});

const credit = (over: Partial<ClientBookingCredit> = {}): ClientBookingCredit => ({
  id: '5b0e7c1a-9d2f-4e3b-8a6c-000000000002',
  amountPaise: 100_000,
  remainingPaise: 100_000,
  reason: 'SLA_BREACH',
  issuedAt: '2026-11-02T10:00:00+05:30',
  expiresAt: '2027-11-02T23:59:59+05:30',
  expired: false,
  ...over,
});

const money = (over: Partial<ClientBookingMoney> = {}): ClientBookingMoney => ({
  bookingId: BOOKING,
  refunds: [],
  credits: [],
  ...over,
});

describe('refunds', () => {
  it('says a processing refund is on its way, with the T&C timeline', () => {
    expect(refundRow(refund())).toEqual({
      key: 'refund-5b0e7c1a-9d2f-4e3b-8a6c-000000000001',
      title: 'Refund on its way',
      detail: 'Sent 2 Nov. It reaches your original payment method within 7–10 business days.',
      amount: '₹2,500',
      state: 'moving',
    });
  });

  it('says a confirmed refund is back, on the day the gateway confirmed it', () => {
    const row = refundRow(
      refund({
        status: 'REFUNDED',
        completedAt: '2026-11-05T09:00:00+05:30',
        amountPaise: 250_050,
      }),
    );
    expect(row).toMatchObject({
      title: 'Refunded',
      detail: 'Back on your original payment method · 5 Nov',
      amount: '₹2,500.50',
      state: 'settled',
    });
  });
});

describe('credits', () => {
  it('names the reason and the expiry of an unused credit', () => {
    expect(creditRow(credit())).toMatchObject({
      title: 'Clickco credit, for the late delivery',
      detail: 'Use it on your next booking · valid until 2\u00a0Nov\u00a02027',
      amount: '₹1,000',
      state: 'moving',
    });
  });

  it('shows what is left of a partly used credit', () => {
    expect(creditRow(credit({ remainingPaise: 40_000 })).detail).toBe(
      '₹400 left to use · valid until 2\u00a0Nov\u00a02027',
    );
  });

  it('keeps the expiry date on one line', () => {
    expect(creditRow(credit()).detail).not.toMatch(/\d Nov|Nov \d/);
  });

  it('settles a used-up or expired credit', () => {
    expect(creditRow(credit({ remainingPaise: 0 }))).toMatchObject({
      detail: 'Used on a later booking',
      state: 'settled',
    });
    expect(creditRow(credit({ expired: true, reason: 'GOODWILL' }))).toMatchObject({
      title: 'Clickco credit, a thank-you from us',
      detail: 'Expired 2\u00a0Nov\u00a02027',
      state: 'settled',
    });
  });
});

describe('the section', () => {
  it('shows only when there is a refund or a credit', () => {
    expect(hasMoneyToShow(money())).toBe(false);
    expect(hasMoneyToShow(money({ refunds: [refund()] }))).toBe(true);
    expect(hasMoneyToShow(money({ credits: [credit()] }))).toBe(true);
  });

  it('lists refunds before credits, never codes or raw enums', () => {
    const rows = moneyRows(money({ credits: [credit()], refunds: [refund()] }));
    expect(rows.map((r) => r.title)).toEqual([
      'Refund on its way',
      'Clickco credit, for the late delivery',
    ]);
    for (const row of rows)
      expect(`${row.title} ${row.detail}`).not.toMatch(/[A-Z]{3,}_|PROCESSING/);
  });
});
