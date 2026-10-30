import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  creditIssuedEntries,
  type LedgerLine,
  refundIssuedEntries,
} from '../ledger-entries';

const amountOn = (lines: readonly LedgerLine[], account: string) =>
  lines.find((l) => l.account === account)?.amountPaise ?? 0n;

describe('REFUND_ISSUED and CREDIT_ISSUED postings (doc 05 §9, ADR-0026 D1/D2)', () => {
  it('a refund with a credit note reverses revenue (contra-income) and output GST, paid from gateway cash', () => {
    const lines = refundIssuedEntries({
      totalPaise: 250_001n,
      creditedTaxablePaise: 211_865n,
      creditedGstPaise: 38_136n,
      lateGst: false,
    });
    assertBalanced(lines);
    expect(lines).toEqual([
      { account: 'REFUNDS_ISSUED', direction: 'DEBIT', amountPaise: 211_865n },
      { account: 'GST_OUTPUT_PAYABLE', direction: 'DEBIT', amountPaise: 38_136n },
      { account: 'CASH_GATEWAY', direction: 'CREDIT', amountPaise: 250_001n },
    ]);
  });

  it('a late credit note (after the s.34(2) window) cannot reduce output GST: the whole refund is contra-income', () => {
    const lines = refundIssuedEntries({
      totalPaise: 250_001n,
      creditedTaxablePaise: 211_865n,
      creditedGstPaise: 38_136n,
      lateGst: true,
    });
    assertBalanced(lines);
    expect(amountOn(lines, 'REFUNDS_ISSUED')).toBe(250_001n);
    expect(amountOn(lines, 'GST_OUTPUT_PAYABLE')).toBe(0n);
  });

  it('money never invoiced (captured off the happy path) goes back out of the client receivable', () => {
    const lines = refundIssuedEntries({
      totalPaise: 50_000n,
      creditedTaxablePaise: 0n,
      creditedGstPaise: 0n,
      lateGst: false,
    });
    expect(lines).toEqual([
      { account: 'CLIENT_RECEIVABLE', direction: 'DEBIT', amountPaise: 50_000n },
      { account: 'CASH_GATEWAY', direction: 'CREDIT', amountPaise: 50_000n },
    ]);
  });

  it('splits a refund larger than its credit note between the credit note and the receivable', () => {
    const lines = refundIssuedEntries({
      totalPaise: 100_000n,
      creditedTaxablePaise: 50_000n,
      creditedGstPaise: 9_000n,
      lateGst: false,
    });
    assertBalanced(lines);
    expect(amountOn(lines, 'CLIENT_RECEIVABLE')).toBe(41_000n);
  });

  it('refuses a credit note bigger than the refund, or no refund at all', () => {
    expect(() =>
      refundIssuedEntries({
        totalPaise: 100n,
        creditedTaxablePaise: 90n,
        creditedGstPaise: 20n,
        lateGst: false,
      }),
    ).toThrow(RangeError);
    expect(() =>
      refundIssuedEntries({
        totalPaise: 0n,
        creditedTaxablePaise: 0n,
        creditedGstPaise: 0n,
        lateGst: false,
      }),
    ).toThrow(RangeError);
  });

  it('a service credit is an expense owed to the client as a liability', () => {
    expect(creditIssuedEntries(50_000n)).toEqual([
      { account: 'SLA_REMEDY_EXPENSE', direction: 'DEBIT', amountPaise: 50_000n },
      { account: 'CLIENT_CREDITS_LIABILITY', direction: 'CREDIT', amountPaise: 50_000n },
    ]);
  });
});
