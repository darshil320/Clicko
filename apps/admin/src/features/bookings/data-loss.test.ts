import type { StaffRole } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  completeLossRefundPaise,
  dataLossAccess,
  dataLossBody,
  dataLossConsequence,
  dataLossOpen,
  parsePercentBps,
  partialLossBody,
  partialLossConsequence,
  partialLossSplit,
  secondPersonRule,
} from './data-loss';

const SURAT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PUNE = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const grant = (role: StaffRole, cityId: string | null = null) => ({ role, cityId });
const approval = { code: '123456', coEmail: 'QM-2@Clickco.test', coCode: '654321' };

describe('who sees "Files lost" (ADR-0030 D2)', () => {
  it('the Quality Manager anywhere they work, the city manager in their city, super admin', () => {
    expect(dataLossAccess([grant('QUALITY_MANAGER')], PUNE)).toBe(true);
    expect(dataLossAccess([grant('CITY_MANAGER', SURAT)], SURAT)).toBe(true);
    expect(dataLossAccess([grant('CITY_MANAGER', SURAT)], PUNE)).toBe(false);
    expect(dataLossAccess([grant('SUPER_ADMIN')], PUNE)).toBe(true);
  });

  it('never ops, support, finance or read-only', () => {
    for (const role of ['OPS_AGENT', 'SUPPORT', 'FINANCE', 'READ_ONLY'] as const) {
      expect(dataLossAccess([grant(role)], SURAT)).toBe(false);
    }
  });

  it('only while the files are uploading, processing or in QA', () => {
    expect(dataLossOpen('UPLOADING')).toBe(true);
    expect(dataLossOpen('PROCESSING')).toBe(true);
    expect(dataLossOpen('QA')).toBe(true);
    for (const s of ['CHECKED_OUT', 'BALANCE_PENDING', 'DELIVERED', 'DATA_LOSS'] as const) {
      expect(dataLossOpen(s)).toBe(false);
    }
  });
});

describe('the amounts', () => {
  it('a complete loss also gives back refunds still waiting for approval (they are replaced)', () => {
    expect(
      completeLossRefundPaise({
        refundablePaise: 395_000,
        refunds: [
          { status: 'REQUESTED', amountPaise: 20_000 },
          { status: 'FAILED', amountPaise: 10_013 },
          { status: 'PROCESSING', amountPaise: 10_000 },
          { status: 'COMPLETED', amountPaise: 5_000 },
        ],
      }),
    ).toBe(415_000);
  });

  it('a partial loss: the share of the booking total, rounded once, half up; now and later', () => {
    expect(partialLossSplit({ totalPaise: 850_000, refundablePaise: 425_000 }, 3_000)).toEqual({
      owedPaise: 255_000,
      nowPaise: 255_000,
      laterPaise: 0,
    });
    expect(partialLossSplit({ totalPaise: 1_153_450, refundablePaise: 576_725 }, 7_000)).toEqual({
      owedPaise: 807_415,
      nowPaise: 576_725,
      laterPaise: 230_690,
    });
  });

  it('reads a percentage as basis points, strictly between none and all', () => {
    expect(parsePercentBps('30')).toBe(3_000);
    expect(parsePercentBps(' 12.5 % ')).toBe(1_250);
    expect(parsePercentBps('0.01')).toBe(1);
    for (const bad of ['', '0', '100', '101', 'abc', '12.345', '-5']) {
      expect(parsePercentBps(bad)).toBeNull();
    }
  });
});

describe('who the second person may be (ADR-0030 D2)', () => {
  const money = {
    qmLimitPaise: 425_000,
    creditedPaise: 0,
    refunds: [{ status: 'COMPLETED' as const, amountPaise: 10_000 }],
  };

  it('within the Quality Manager’s limit, nothing extra to say', () => {
    expect(secondPersonRule(money, 415_000)).toBeNull();
    expect(secondPersonRule(money, 0)).toBeNull();
  });

  it('above it (refunds already done count), finance or a super admin', () => {
    expect(secondPersonRule(money, 415_001)).toBe(
      "This is above the Quality Manager's limit of ₹4,250 on this booking, so the second person must be finance or a super admin.",
    );
  });
});

describe('the requests', () => {
  it('a complete loss: the note and both codes, the co-approver’s email normalised', () => {
    const ok = dataLossBody({ note: '  Both cards corrupted; reader logs  ', ...approval });
    expect(ok.success && ok.data).toEqual({
      note: 'Both cards corrupted; reader logs',
      code: '123456',
      coApprover: { email: 'qm-2@clickco.test', code: '654321' },
    });
    expect(dataLossBody({ note: 'lost', ...approval }).success).toBe(false);
    expect(dataLossBody({ note: 'Both cards corrupted', ...approval, coCode: '' }).success).toBe(
      false,
    );
  });

  it('a partial loss adds the share', () => {
    const ok = partialLossBody({ percent: '30', note: 'Second card unreadable', ...approval });
    expect(ok.success && ok.data.affectedProportionBps).toBe(3_000);
    expect(partialLossBody({ percent: '100', note: 'All of it', ...approval }).success).toBe(false);
  });
});

describe('what the confirm dialog says', () => {
  it('a complete loss, with names and the amount', () => {
    expect(
      dataLossConsequence({
        reference: 'CLK-1004',
        clientName: 'Priya Sharma',
        photographerName: 'Asha Patel',
        refundPaise: 425_000,
      }),
    ).toBe(
      'CLK-1004 ends here and nothing is delivered. ₹4,250, everything Priya Sharma paid that has not already gone back, goes back to them now by the data-loss rule; refunds still waiting for approval are replaced. Asha Patel is paid in full; a third loss in a year holds the payout for finance.',
    );
    expect(
      dataLossConsequence({
        reference: 'CLK-1005',
        clientName: 'Priya Sharma',
        photographerName: null,
        refundPaise: 0,
      }),
    ).toBe(
      'CLK-1005 ends here and nothing is delivered. Nothing Priya Sharma paid is left to refund. The photographer is paid in full; a third loss in a year holds the payout for finance.',
    );
  });

  it('a partial loss: what goes back now and what waits for the balance', () => {
    expect(
      partialLossConsequence({
        reference: 'CLK-1004',
        clientName: 'Priya Sharma',
        bps: 7_000,
        split: { owedPaise: 807_415, nowPaise: 576_725, laterPaise: 230_690 },
      }),
    ).toBe(
      'CLK-1004 carries on and what survived is delivered. 70% of the booking is ₹8,074.15: ₹5,767.25 goes back to Priya Sharma now by the data-loss rule, and ₹2,306.90 waits on the "To settle" desk until the balance is paid.',
    );
    expect(
      partialLossConsequence({
        reference: 'CLK-1004',
        clientName: 'Priya Sharma',
        bps: 3_000,
        split: { owedPaise: 255_000, nowPaise: 255_000, laterPaise: 0 },
      }),
    ).toBe(
      'CLK-1004 carries on and what survived is delivered. 30% of the booking is ₹2,550: ₹2,550 goes back to Priya Sharma now by the data-loss rule.',
    );
  });
});
