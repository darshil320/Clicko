import type { RefundStatus, StaffRole } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  committedPaise,
  creditAmountProblem,
  creditBlocked,
  creditBody,
  creditConsequence,
  creditNeedsFourEyes,
  creditRoom,
  type MoneyFacts,
  moneyAccess,
  refundAmountProblem,
  refundablePayments,
  refundBlocked,
  refundBody,
  refundConsequence,
  refundNeedsFinance,
  refundRoom,
} from './money-actions';

const SURAT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PUNE = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const PAY_ADVANCE = '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9';
const PAY_BALANCE = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';

const grant = (role: StaffRole, cityId: string | null = null) => ({ role, cityId });
const refund = (status: RefundStatus, amountPaise: number) => ({ status, amountPaise });

/** ₹20,000 booking, all paid (₹10,000 + ₹10,000); the QM ceiling is ₹5,000. */
const money = (over: Partial<MoneyFacts> = {}): MoneyFacts => ({
  clientName: 'Priya Sharma',
  totalPaise: 2_000_000,
  refundablePaise: 2_000_000,
  creditedPaise: 0,
  qmLimitPaise: 500_000,
  refunds: [],
  payments: [
    { id: PAY_ADVANCE, refundablePaise: 1_000_000, paidWith: 'UPI · priya@okicici' },
    { id: PAY_BALANCE, refundablePaise: 1_000_000, paidWith: 'Card ending 4242' },
  ],
  ...over,
});

describe('moneyAccess — who sees Refund and Issue credit (ADR-0026 D1/D2)', () => {
  it('hides both from roles that can never act', () => {
    expect(moneyAccess([grant('READ_ONLY')], SURAT)).toEqual({
      refund: false,
      credit: false,
      unlimited: false,
    });
  });

  it('lets the ops floor ask for a refund in their city only, never issue a credit', () => {
    for (const role of ['OPS_AGENT', 'SUPPORT', 'CITY_MANAGER'] as const) {
      expect(moneyAccess([grant(role, SURAT)], SURAT)).toEqual({
        refund: true,
        credit: false,
        unlimited: false,
      });
      expect(moneyAccess([grant(role, SURAT)], PUNE).refund).toBe(false);
    }
  });

  it('lets the Quality Manager issue credits within the ceiling, finance without it', () => {
    expect(moneyAccess([grant('QUALITY_MANAGER')], PUNE)).toEqual({
      refund: true,
      credit: true,
      unlimited: false,
    });
    expect(moneyAccess([grant('FINANCE', SURAT)], SURAT)).toEqual({
      refund: true,
      credit: true,
      unlimited: true,
    });
  });

  it('counts only the grants that cover the booking’s city', () => {
    const mixed = [grant('QUALITY_MANAGER'), grant('FINANCE', SURAT)];
    expect(moneyAccess(mixed, SURAT).unlimited).toBe(true);
    expect(moneyAccess(mixed, PUNE)).toEqual({ refund: true, credit: true, unlimited: false });
  });

  it('lets SUPER_ADMIN do both anywhere', () => {
    expect(moneyAccess([grant('SUPER_ADMIN')], PUNE)).toEqual({
      refund: true,
      credit: true,
      unlimited: true,
    });
  });
});

describe('refunds', () => {
  it('counts approved, processing and done refunds plus credits against the ceilings', () => {
    const m = money({
      creditedPaise: 50_000,
      refunds: [
        refund('REQUESTED', 1_000),
        refund('APPROVED', 10_000),
        refund('PROCESSING', 20_000),
        refund('COMPLETED', 30_000),
        refund('FAILED', 40_000),
        refund('REJECTED', 80_000),
      ],
    });
    expect(committedPaise(m)).toBe(110_000);
  });

  it('never asks for more than can still go back: the booking, or the one payment named', () => {
    const m = money({
      refundablePaise: 1_500_000,
      payments: [
        { id: PAY_ADVANCE, refundablePaise: 0, paidWith: 'UPI · priya@okicici' },
        { id: PAY_BALANCE, refundablePaise: 1_500_000, paidWith: 'Card ending 4242' },
      ],
    });
    expect(refundRoom(m)).toBe(1_500_000);
    expect(refundRoom(m, PAY_ADVANCE)).toBe(0);
    expect(refundablePayments(m).map((p) => p.id)).toEqual([PAY_BALANCE]);
    expect(refundAmountProblem(m, 1_500_000)).toBeNull();
    expect(refundAmountProblem(m, 1_500_001)).toBe('The most that can go back now is ₹15,000');
    expect(refundAmountProblem(m, 100, PAY_ADVANCE)).toBe(
      'Nothing on this payment can be refunded now',
    );
    expect(refundAmountProblem(m, 0)).toBe('Enter an amount above ₹0');
    expect(refundAmountProblem(m, null)).toBe('Enter an amount above ₹0');
  });

  it('turns the button off, with the reason, when nothing is refundable', () => {
    expect(refundBlocked(money())).toBeNull();
    expect(refundBlocked(money({ refundablePaise: 0 }))).toMatch(/^Nothing can go back now/);
  });

  it('says finance approves (with a fresh code) once the booking goes above the QM ceiling', () => {
    const m = money({ creditedPaise: 100_000, refunds: [refund('COMPLETED', 100_000)] });
    expect(refundNeedsFinance(m, 300_000)).toBe(false); // exactly the ₹5,000 ceiling
    expect(refundNeedsFinance(m, 300_001)).toBe(true);
  });

  it('builds the request body from the contract, with or without a payment', () => {
    const auto = refundBody({ amount: '2,500', reason: 'GOODWILL', note: 'Late', paymentId: null });
    expect(auto.success && auto.data).toEqual({
      amountPaise: 250_000,
      reason: 'GOODWILL',
      note: 'Late',
    });
    const one = refundBody({
      amount: '10',
      reason: 'QUALITY',
      note: 'Blurry',
      paymentId: PAY_BALANCE,
    });
    expect(one.success && one.data.paymentId).toBe(PAY_BALANCE);
    expect(refundBody({ amount: '', reason: 'GOODWILL', note: 'x', paymentId: null }).success).toBe(
      false,
    );
  });

  it('spells out the refund in the confirm dialog', () => {
    const m = money();
    expect(refundConsequence(m, 250_000, { paidWith: 'Card ending 4242' })).toBe(
      "₹2,500 goes back to Priya Sharma (Card ending 4242) once someone else approves it on the Refunds desk. You can't approve your own request.",
    );
    expect(refundConsequence(m, 600_000, null)).toBe(
      "₹6,000 goes back to Priya Sharma, newest payment first, once someone else approves it on the Refunds desk. You can't approve your own request. It is above the Quality Manager's limit of ₹5,000 on this booking, so finance approves it with a fresh authenticator code.",
    );
  });
});

describe('credits', () => {
  it('finance may credit up to what is left of the booking total', () => {
    const m = money({ creditedPaise: 200_000, refunds: [refund('COMPLETED', 1_000_000)] });
    expect(creditRoom(m, true)).toEqual({ maxPaise: 800_000, limitedBy: 'TOTAL' });
    expect(creditAmountProblem(m, true, 800_000)).toBeNull();
    expect(creditAmountProblem(m, true, 800_001)).toBe(
      "Refunds and credits can't come to more than the booking total: at most ₹8,000 more.",
    );
  });

  it('the Quality Manager stays within the ceiling, counting refunds and credits', () => {
    const m = money({ creditedPaise: 100_000, refunds: [refund('APPROVED', 100_000)] });
    expect(creditRoom(m, false)).toEqual({ maxPaise: 300_000, limitedBy: 'QM_LIMIT' });
    expect(creditAmountProblem(m, false, 300_001)).toBe(
      'Above your limit on this booking: at most ₹3,000. Finance can issue more.',
    );
    // A small booking: half its total is below ₹5,000, and the total is what caps it.
    const small = money({ totalPaise: 300_000, qmLimitPaise: 150_000 });
    expect(creditRoom(small, false)).toEqual({ maxPaise: 150_000, limitedBy: 'QM_LIMIT' });
  });

  it('turns the button off, with the reason, when nothing is left to credit', () => {
    const full = money({ refunds: [refund('COMPLETED', 2_000_000)] });
    expect(creditBlocked(full, true)).toBe(
      'Refunds and credits already add up to the booking total.',
    );
    const used = money({ creditedPaise: 500_000 });
    expect(creditBlocked(used, false)).toBe(
      'Your limit of ₹5,000 on this booking is used up. Finance can issue more.',
    );
    expect(creditBlocked(used, true)).toBeNull();
  });

  it('is four-eyes above ₹5,000 only', () => {
    expect(creditNeedsFourEyes(500_000)).toBe(false);
    expect(creditNeedsFourEyes(500_001)).toBe(true);
  });

  it('sends both codes and the co-approver above the four-eyes line, none below it', () => {
    const approval = { code: '123456', coEmail: 'Finance-2@Clickco.test', coCode: '654321' };
    const small = creditBody({ amount: '500', reason: 'GOODWILL', note: 'Sorry', approval });
    expect(small.success && small.data).toEqual({
      amountPaise: 50_000,
      reason: 'GOODWILL',
      note: 'Sorry',
    });
    const large = creditBody({ amount: '6000', reason: 'QUALITY', note: 'Reshoot', approval });
    expect(large.success && large.data).toEqual({
      amountPaise: 600_000,
      reason: 'QUALITY',
      note: 'Reshoot',
      code: '123456',
      coApprover: { email: 'finance-2@clickco.test', code: '654321' },
    });
    const missing = creditBody({
      amount: '6000',
      reason: 'QUALITY',
      note: 'Reshoot',
      approval: { code: '', coEmail: '', coCode: '' },
    });
    expect(missing.success).toBe(false);
  });

  it('spells out the credit in the confirm dialog', () => {
    expect(creditConsequence(money(), 50_000)).toBe(
      "Priya Sharma gets a ₹500 credit now, valid for 12 months on a future booking. An issued credit can't be withdrawn.",
    );
    expect(creditConsequence(money(), 600_000)).toContain(
      "above ₹5,000, so your code and a second finance person's code confirm it together.",
    );
  });
});
