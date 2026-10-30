import { describe, expect, it } from 'vitest';
import { assertBalanced } from '../../payments/ledger/ledger-entries';
import {
  payoutAccruedEntries,
  payoutDeductionEntries,
  payoutPaidEntries,
  tdsWithheldEntries,
} from '../rules/ledger-postings';

describe('payout postings (doc 05 §9 chart of accounts)', () => {
  it('a vendor invoice raised: Dr COGS_VENDOR, Cr VENDOR_PAYABLE', () => {
    const lines = payoutAccruedEntries(250_000n);
    expect(lines).toEqual([
      { account: 'COGS_VENDOR', direction: 'DEBIT', amountPaise: 250_000n },
      { account: 'VENDOR_PAYABLE', direction: 'CREDIT', amountPaise: 250_000n },
    ]);
    assertBalanced(lines);
  });

  it('TDS withheld moves the payable to TDS_PAYABLE', () => {
    expect(tdsWithheldEntries(3_500n)).toEqual([
      { account: 'VENDOR_PAYABLE', direction: 'DEBIT', amountPaise: 3_500n },
      { account: 'TDS_PAYABLE', direction: 'CREDIT', amountPaise: 3_500n },
    ]);
  });

  it('deductions: recognised as recoverable, then recovered from the payable', () => {
    const lines = payoutDeductionEntries(80_000n, 50_000n);
    expect(lines).toEqual([
      { account: 'VENDOR_RECOVERABLE', direction: 'DEBIT', amountPaise: 80_000n },
      { account: 'VENDOR_DEDUCTIONS', direction: 'CREDIT', amountPaise: 80_000n },
      { account: 'VENDOR_PAYABLE', direction: 'DEBIT', amountPaise: 50_000n },
      { account: 'VENDOR_RECOVERABLE', direction: 'CREDIT', amountPaise: 50_000n },
    ]);
    assertBalanced(lines);
    expect(payoutDeductionEntries(0n, 30_000n)).toHaveLength(2);
    expect(payoutDeductionEntries(0n, 0n)).toEqual([]);
  });

  it('paid: the payable leaves cash', () => {
    expect(payoutPaidEntries(196_500n)).toEqual([
      { account: 'VENDOR_PAYABLE', direction: 'DEBIT', amountPaise: 196_500n },
      { account: 'CASH_GATEWAY', direction: 'CREDIT', amountPaise: 196_500n },
    ]);
  });

  it('refuses a negative amount', () => {
    expect(() => payoutAccruedEntries(-1n)).toThrow(RangeError);
    expect(() => payoutDeductionEntries(-1n, 0n)).toThrow(RangeError);
  });
});
