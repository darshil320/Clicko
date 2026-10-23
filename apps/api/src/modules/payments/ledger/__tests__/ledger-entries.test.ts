import { describe, expect, it } from 'vitest';
import {
  advanceCapturedEntries,
  assertBalanced,
  gatewayFeeEntries,
  gstAccruedEntries,
  LedgerImbalanceError,
  type LedgerLine,
  travelShareOf,
} from '../ledger-entries';

const totals = (lines: readonly LedgerLine[]) => ({
  debit: lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.amountPaise, 0n),
  credit: lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.amountPaise, 0n),
});

describe('ledger postings (doc 05 §9)', () => {
  it('ADVANCE_CAPTURED moves cash in against the client receivable', () => {
    expect(advanceCapturedEntries(845_411n)).toEqual([
      { account: 'CASH_GATEWAY', direction: 'DEBIT', amountPaise: 845_411n },
      { account: 'CLIENT_RECEIVABLE', direction: 'CREDIT', amountPaise: 845_411n },
    ]);
  });

  it('GATEWAY_FEE is an expense paid out of gateway cash', () => {
    expect(gatewayFeeEntries(16_908n)).toEqual([
      { account: 'GATEWAY_FEES', direction: 'DEBIT', amountPaise: 16_908n },
      { account: 'CASH_GATEWAY', direction: 'CREDIT', amountPaise: 16_908n },
    ]);
  });

  it('GST_ACCRUED recognises service revenue, travel revenue and output GST at invoice issue', () => {
    const lines = gstAccruedEntries({
      invoiceTotalPaise: 845_411n,
      taxablePaise: 716_450n,
      travelSharePaise: 12_700n,
    });
    expect(lines).toEqual([
      { account: 'CLIENT_RECEIVABLE', direction: 'DEBIT', amountPaise: 845_411n },
      { account: 'REVENUE_SERVICE', direction: 'CREDIT', amountPaise: 703_750n },
      { account: 'REVENUE_TRAVEL', direction: 'CREDIT', amountPaise: 12_700n },
      { account: 'GST_OUTPUT_PAYABLE', direction: 'CREDIT', amountPaise: 128_961n },
    ]);
    const t = totals(lines);
    expect(t.debit).toBe(t.credit);
  });

  it('omits zero lines (the ledger refuses zero amounts) and still balances', () => {
    const lines = gstAccruedEntries({
      invoiceTotalPaise: 118_000n,
      taxablePaise: 100_000n,
      travelSharePaise: 0n,
    });
    expect(lines.map((l) => l.account)).toEqual([
      'CLIENT_RECEIVABLE',
      'REVENUE_SERVICE',
      'GST_OUTPUT_PAYABLE',
    ]);
    const t = totals(lines);
    expect(t.debit).toBe(t.credit);
  });

  it('takes the travel share of an invoice in proportion to the pre-discount subtotal', () => {
    // Travel is 25400 of a 1432900 subtotal; half the taxable value carries half the travel.
    expect(travelShareOf(716_450n, { travelPaise: 25_400n, subtotalPaise: 1_432_900n })).toBe(
      12_700n,
    );
    expect(travelShareOf(1_432_900n, { travelPaise: 25_400n, subtotalPaise: 1_432_900n })).toBe(
      25_400n,
    );
    expect(travelShareOf(500n, { travelPaise: 0n, subtotalPaise: 0n })).toBe(0n);
  });

  it('never lets the travel share exceed the taxable value', () => {
    expect(travelShareOf(100n, { travelPaise: 900n, subtotalPaise: 900n })).toBe(100n);
  });

  it('assertBalanced accepts a balanced txn and rejects anything else', () => {
    expect(() => assertBalanced(advanceCapturedEntries(1n))).not.toThrow();
    expect(() =>
      assertBalanced([
        { account: 'CASH_GATEWAY', direction: 'DEBIT', amountPaise: 100n },
        { account: 'CLIENT_RECEIVABLE', direction: 'CREDIT', amountPaise: 99n },
      ]),
    ).toThrow(LedgerImbalanceError);
    expect(() => assertBalanced([])).toThrow(LedgerImbalanceError);
    expect(() =>
      assertBalanced([
        { account: 'CASH_GATEWAY', direction: 'DEBIT', amountPaise: 0n },
        { account: 'CLIENT_RECEIVABLE', direction: 'CREDIT', amountPaise: 0n },
      ]),
    ).toThrow(LedgerImbalanceError);
  });
});
