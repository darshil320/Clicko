import type { EarningsJob, ProPaidTransfer } from '@clickco/contracts';
import { ProPayoutStatus } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { hasPaidTransfers, payoutLine, transferRow, visibleTransfers } from './payouts';

const job = (over: Partial<EarningsJob> = {}): EarningsJob => ({
  assignmentId: '5b0e7c1a-9d2f-4e3b-8a6c-000000000001',
  bookingId: '8e3f1a2b-4c5d-4e6f-9a0b-000000000001',
  bookingReference: 'CK-2026-00412',
  categoryCode: 'FOOD',
  scheduledStart: '2026-10-28T12:30:00+05:30',
  checkedOutAt: '2026-10-28T14:45:00+05:30',
  basePayoutPaise: 420_000,
  extrasPayoutPaise: 0,
  totalPayoutPaise: 420_000,
  ...over,
});

const transfer = (over: Partial<ProPaidTransfer> = {}): ProPaidTransfer => ({
  batchReference: 'PO20261214W',
  paidAt: '2026-12-14T11:00:00+05:30',
  payoutCount: 3,
  grossPaise: 1_260_000,
  deductionsPaise: 0,
  tdsPaise: 12_600,
  netPaise: 1_247_400,
  utrLast4: '4821',
  ...over,
});

describe('payoutLine', () => {
  it('says where every payout status stands, in words', () => {
    expect(payoutLine(job({ payoutStatus: 'DUE' }))).toBe('Payout: In the next weekly batch');
    expect(payoutLine(job({ payoutStatus: 'IN_PAYMENT' }))).toBe('Payout: On its way to your bank');
    expect(payoutLine(job({ payoutStatus: 'PAID' }))).toBe('Payout: Paid');
    expect(payoutLine(job({ payoutStatus: 'WITHHELD' }))).toMatch(/On hold/);
    for (const status of ProPayoutStatus.options) {
      expect(payoutLine(job({ payoutStatus: status }))).not.toMatch(/_|IN_PAYMENT|WITHHELD/);
    }
  });

  it('explains a job with no payout yet', () => {
    expect(payoutLine(job())).toBe('Payout: Payable once the photos are delivered');
  });
});

describe('transferRow', () => {
  it('shows the date, net, TDS and the UTR last 4', () => {
    expect(transferRow(transfer())).toEqual({
      key: 'PO20261214W',
      title: 'Paid 14 Dec',
      detail: '3 shoots · TDS ₹126\nUTR ending 4821',
      net: '₹12,474',
      accessibilityLabel: 'Paid 14 Dec 2026: ₹12,474 after 3 shoots, TDS ₹126. UTR ending 4821',
    });
  });

  it('adds deductions, and says when nothing reached the bank', () => {
    const row = transferRow(
      transfer({ payoutCount: 1, deductionsPaise: 50_000, netPaise: 0, utrLast4: null }),
    );
    expect(row.detail).toBe('1 shoot · TDS ₹126 · ₹500 deducted\nNothing sent to the bank');
    expect(row.net).toBe('₹0');
  });
});

describe('the Paid section', () => {
  it('appears only once something is paid (older payloads have no list)', () => {
    expect(hasPaidTransfers(undefined)).toBe(false);
    expect(hasPaidTransfers([])).toBe(false);
    expect(hasPaidTransfers([transfer()])).toBe(true);
  });

  it('shows the newest three until expanded', () => {
    const list = ['A', 'B', 'C', 'D'].map((ref) => transfer({ batchReference: ref }));
    expect(visibleTransfers(list, false).map((t) => t.batchReference)).toEqual(['A', 'B', 'C']);
    expect(visibleTransfers(list, true)).toHaveLength(4);
  });
});
