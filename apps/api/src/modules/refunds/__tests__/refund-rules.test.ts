import { describe, expect, it } from 'vitest';
import {
  allocateRefund,
  approvalCheck,
  creditCheck,
  creditExpiresAt,
  qmCeilingPaise,
} from '../refund-rules';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

describe('the Quality Manager ceiling (ADR-0005 OD-12): the lower of ₹5,000 or 50% of the booking', () => {
  it('is ₹5,000 on a big booking and half the total (rounded down) on a small one', () => {
    expect(qmCeilingPaise(2_000_000n)).toBe(500_000n);
    expect(qmCeilingPaise(845_411n)).toBe(422_705n);
    expect(qmCeilingPaise(1n)).toBe(0n);
  });
});

describe('approvalCheck — maker-checker for refunds (ADR-0026 D1)', () => {
  const base = {
    approverId: B,
    requesterId: A,
    amountPaise: 300_000n,
    bookingTotalPaise: 1_690_822n,
    committedPaise: 0n,
  };

  it('finance and super admins approve any amount', () => {
    expect(approvalCheck({ ...base, roles: ['FINANCE'], amountPaise: 1_690_822n })).toEqual({
      ok: true,
    });
    expect(approvalCheck({ ...base, roles: ['SUPER_ADMIN'], amountPaise: 9_999_999n }).ok).toBe(
      true,
    );
  });

  it('never lets the requester approve their own refund, whatever their role', () => {
    const own = approvalCheck({ ...base, approverId: A, roles: ['SUPER_ADMIN'] });
    expect(own).toMatchObject({ ok: false, code: 'FOUR_EYES' });
    if (!own.ok) expect(own.message).toMatch(/someone else/i);
  });

  it('lets the QM approve within the ceiling, counting what the booking already got back', () => {
    expect(approvalCheck({ ...base, roles: ['QUALITY_MANAGER'] }).ok).toBe(true);
    expect(approvalCheck({ ...base, roles: ['QUALITY_MANAGER'], amountPaise: 500_000n }).ok).toBe(
      true,
    );
    const over = approvalCheck({
      ...base,
      roles: ['QUALITY_MANAGER'],
      amountPaise: 300_000n,
      committedPaise: 250_000n,
    });
    expect(over).toMatchObject({ ok: false, code: 'ABOVE_LIMIT', limitPaise: 500_000n });
    if (!over.ok) expect(over.message).toContain('₹5,000');
  });

  it('refuses anyone who is not an approver (ops, support, city managers)', () => {
    expect(approvalCheck({ ...base, roles: ['OPS_AGENT', 'CITY_MANAGER'] })).toMatchObject({
      ok: false,
      code: 'NOT_AN_APPROVER',
    });
  });
});

describe('creditCheck — who may issue a service credit (ADR-0026 D2)', () => {
  const base = { amountPaise: 50_000n, bookingTotalPaise: 1_690_822n, committedPaise: 0n };
  it('QM within the ceiling, finance any amount, nobody else', () => {
    expect(creditCheck({ ...base, roles: ['QUALITY_MANAGER'] }).ok).toBe(true);
    expect(
      creditCheck({ ...base, roles: ['QUALITY_MANAGER'], amountPaise: 500_001n }),
    ).toMatchObject({ ok: false, code: 'ABOVE_LIMIT' });
    expect(creditCheck({ ...base, roles: ['FINANCE'], amountPaise: 900_000n }).ok).toBe(true);
    expect(creditCheck({ ...base, roles: ['SUPPORT'] })).toMatchObject({
      ok: false,
      code: 'NOT_AN_APPROVER',
    });
  });
});

describe('allocateRefund — one gateway refund per payment, newest payment first', () => {
  const payments = [
    { paymentId: A, refundablePaise: 845_411n, at: new Date('2026-11-01T00:00:00Z') },
    { paymentId: B, refundablePaise: 845_411n, at: new Date('2026-11-05T00:00:00Z') },
  ];

  it('takes a refund that fits from the newest payment', () => {
    expect(allocateRefund(100_000n, payments)).toEqual({
      ok: true,
      parts: [{ paymentId: B, amountPaise: 100_000n }],
    });
  });

  it('spreads a bigger refund over several payments', () => {
    expect(allocateRefund(1_000_000n, payments)).toEqual({
      ok: true,
      parts: [
        { paymentId: B, amountPaise: 845_411n },
        { paymentId: A, amountPaise: 154_589n },
      ],
    });
  });

  it('uses only the named payment when one is given', () => {
    expect(allocateRefund(100n, payments, A)).toEqual({
      ok: true,
      parts: [{ paymentId: A, amountPaise: 100n }],
    });
    expect(allocateRefund(900_000n, payments, A)).toEqual({ ok: false, maxPaise: 845_411n });
  });

  it('refuses more than everything refundable, and reports the most it could do', () => {
    expect(allocateRefund(1_690_823n, payments)).toEqual({ ok: false, maxPaise: 1_690_822n });
    expect(allocateRefund(1n, [])).toEqual({ ok: false, maxPaise: 0n });
  });
});

describe('creditExpiresAt — credits are valid 12 months (end of that day, IST)', () => {
  it('expires at 23:59:59.999 IST on the same date next year', () => {
    expect(creditExpiresAt(new Date('2026-11-10T06:30:00Z')).toISOString()).toBe(
      '2027-11-10T18:29:59.999Z',
    );
  });

  it('uses the IST date (late evening UTC is already tomorrow in India)', () => {
    expect(creditExpiresAt(new Date('2026-11-10T20:00:00Z')).toISOString()).toBe(
      '2027-11-11T18:29:59.999Z',
    );
  });

  it('moves 29 February to 28 February', () => {
    expect(creditExpiresAt(new Date('2028-02-29T06:30:00Z')).toISOString()).toBe(
      '2029-02-28T18:29:59.999Z',
    );
  });
});
