import { describe, expect, it } from 'vitest';
import { retryReference } from '../payout-batches.service';
import { PAYOUT_CONFIG } from '../payouts.config';
import { bankFileCsv, beneficiaryName } from '../rules/bank-file';
import { csvCell, csvDocument, rupees } from '../rules/csv';
import { maskPan } from '../rules/masking';
import { offCycleBatchRef, parseBatchRef, transferRef, weeklyBatchRef } from '../rules/references';
import { statementCsv } from '../rules/statement';
import { tdsReportCsv } from '../rules/tds-report';

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Mehta, Rahul')).toBe('"Mehta, Rahul"');
    expect(csvCell('5" print')).toBe('"5"" print"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('neutralises spreadsheet formulas (CSV injection)', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+91 98')).toBe("'+91 98");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('documents end every row with CRLF', () => {
    expect(csvDocument(['a', 'b'], [['1', null]])).toBe('a,b\r\n1,\r\n');
  });

  it('rupees are two-decimal, ungrouped and never floats', () => {
    expect(rupees(123_456_78n)).toBe('123456.78');
    expect(rupees(5n)).toBe('0.05');
    expect(rupees(0n)).toBe('0.00');
    expect(() => rupees(-1n)).toThrow(RangeError);
  });
});

describe('references', () => {
  it('a weekly batch is named for its Monday (IST); off-cycle batches are numbered', () => {
    const mondayIst = new Date('2026-11-01T19:00:00.000Z');
    expect(weeklyBatchRef(mondayIst)).toBe('PO20261102W');
    expect(offCycleBatchRef(mondayIst, 2)).toBe('PO20261102X2');
    expect(parseBatchRef('PO20261102W')).toEqual({ kind: 'WEEKLY', day: '2026-11-02' });
    expect(parseBatchRef('PO20261104X12')).toEqual({ kind: 'OFF_CYCLE', day: '2026-11-04' });
    expect(() => parseBatchRef('nope')).toThrow();
  });

  it('each transfer carries the batch reference and a three-digit line', () => {
    expect(transferRef('PO20261102W', 7)).toBe('PO20261102W007');
    expect(() => transferRef('PO20261102W', PAYOUT_CONFIG.maxTransfersPerBatch + 1)).toThrow();
  });
});

describe('the bulk-NEFT bank file', () => {
  it('one row per transfer, full account number, amount in rupees', () => {
    const csv = bankFileCsv('PO20261102W', [
      {
        reference: 'PO20261102W001',
        beneficiaryName: 'Asha Patel',
        accountNumber: '001234567890',
        ifsc: 'HDFC0001234',
        amountPaise: 1_234_550n,
      },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'Payment Type,Beneficiary Name,Beneficiary Account Number,IFSC,Amount (INR),Payment Reference,Narration',
      'NEFT,Asha Patel,001234567890,HDFC0001234,12345.50,PO20261102W001,Clickco payout PO20261102W',
      '',
    ]);
  });

  it('refuses a malformed account number or IFSC rather than send a bad row', () => {
    const row = {
      reference: 'PO20261102W001',
      beneficiaryName: 'Asha',
      accountNumber: '12-34',
      ifsc: 'HDFC0001234',
      amountPaise: 100n,
    };
    expect(() => bankFileCsv('PO20261102W', [row])).toThrow(/account number/);
    expect(() =>
      bankFileCsv('PO20261102W', [{ ...row, accountNumber: '123456789', ifsc: 'X' }]),
    ).toThrow(/IFSC/);
    expect(() =>
      bankFileCsv('PO20261102W', [{ ...row, accountNumber: '123456789', amountPaise: 0n }]),
    ).toThrow(/amount/);
  });

  it('beneficiary names keep only what banks accept, up to 35 characters', () => {
    expect(beneficiaryName('  =Ravi  "Kumar"\t ')).toBe('Ravi Kumar');
    expect(beneficiaryName('A'.repeat(50))).toHaveLength(35);
  });
});

describe('masking', () => {
  it('shows only the last four characters of a PAN', () => {
    expect(maskPan('ABCPE1234F')).toBe('XXXXXX234F');
    expect(maskPan(null)).toBeNull();
  });
});

describe('the self-billed statement and the TDS report', () => {
  it('statement: header, one line per booking, deductions and totals', () => {
    const csv = statementCsv({
      batchReference: 'PO20261102W',
      issuedOn: '2026-11-02',
      photographerName: 'Asha Patel',
      pan: 'ABCPE1234F',
      gstRegistered: false,
      transferReference: 'PO20261102W001',
      utr: null,
      lines: [
        {
          bookingReference: 'CLK-1001',
          eligibleOn: '2026-10-30',
          grossPaise: 250_000n,
          tdsSection: null,
          tdsRateBps: 0,
          tdsPaise: 0n,
          deductionsPaise: 50_000n,
          netPaise: 200_000n,
        },
      ],
      deductions: [
        {
          label: 'Late delivery',
          bookingReference: 'CLK-1001',
          rateBps: 2_000,
          basisPaise: 250_000n,
          amountPaise: 50_000n,
        },
      ],
      totals: {
        grossPaise: 250_000n,
        broughtForwardPaise: 0n,
        deductionsPaise: 50_000n,
        tdsPaise: 0n,
        netPaise: 200_000n,
        carriedForwardPaise: 0n,
      },
    });
    expect(csv).toContain('Self-billed payout statement');
    expect(csv).toContain('CLK-1001,2026-10-30,2500.00,,0%,0.00,500.00,2000.00');
    expect(csv).toContain('Late delivery,CLK-1001,20%,2500.00,500.00');
    expect(csv).toContain('Paid to your bank,2000.00');
    expect(csv).toContain('not registered for GST');
  });

  it('TDS report: PAN, section, amount, TDS and the date of credit', () => {
    const csv = tdsReportCsv([
      {
        name: 'Asha Patel',
        pan: 'ABCPE1234F',
        section: '194C',
        rateBps: 100,
        grossPaise: 3_500_000n,
        tdsPaise: 35_000n,
        creditedOn: '2026-11-02',
        payoutReference: 'PO20261102W001',
        bookingReference: 'CLK-1001',
        note: null,
      },
      {
        name: 'Ravi',
        pan: null,
        section: null,
        rateBps: 0,
        grossPaise: 200_000n,
        tdsPaise: 0n,
        creditedOn: '2026-11-02',
        payoutReference: 'PO20261102W002',
        bookingReference: 'CLK-1002',
        note: 'Below the threshold',
      },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'Deductee name,PAN,Section,Rate,Amount paid or credited (INR),TDS (INR),Date of credit,Payment reference,Booking,Note',
    );
    expect(lines[1]).toBe(
      'Asha Patel,ABCPE1234F,194C,1%,35000.00,350.00,2026-11-02,PO20261102W001,CLK-1001,',
    );
    expect(lines[2]).toBe(
      'Ravi,PANNOTAVBL,,0%,2000.00,0.00,2026-11-02,PO20261102W002,CLK-1002,Below the threshold',
    );
  });
});

describe('a resent transfer gets a new reference', () => {
  it('PO…001 → PO…001R1 → PO…001R2', () => {
    expect(retryReference('PO20261214W001')).toBe('PO20261214W001R1');
    expect(retryReference('PO20261214W001R1')).toBe('PO20261214W001R2');
    expect(retryReference('PO20261204X2003R9')).toBe('PO20261204X2003R10');
    expect(() => retryReference(null)).toThrow();
  });
});
