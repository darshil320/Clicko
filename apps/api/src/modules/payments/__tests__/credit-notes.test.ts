import { describe, expect, it } from 'vitest';
import { splitCreditNote } from '../credit-note-split';
import {
  creditNoteDeadline,
  creditNoteNumber,
  creditNoteSeriesFor,
  isCreditNoteLate,
} from '../financial-year';
import type { InvoiceSplit } from '../invoice-split';

const parts = (s: InvoiceSplit) => [s.taxablePaise, s.cgstPaise, s.sgstPaise, s.igstPaise];
const sumOf = (s: InvoiceSplit) => parts(s).reduce((a, b) => a + b, 0n);
const minus = (a: InvoiceSplit, b: InvoiceSplit): InvoiceSplit => ({
  taxablePaise: a.taxablePaise - b.taxablePaise,
  cgstPaise: a.cgstPaise - b.cgstPaise,
  sgstPaise: a.sgstPaise - b.sgstPaise,
  igstPaise: a.igstPaise - b.igstPaise,
  totalPaise: a.totalPaise - b.totalPaise,
});

// The advance invoice of a Surat booking (CGST + SGST): ₹8,454.11, an odd number of paise.
const INTRA: InvoiceSplit = {
  taxablePaise: 716_450n,
  cgstPaise: 64_481n,
  sgstPaise: 64_480n,
  igstPaise: 0n,
  totalPaise: 845_411n,
};
// The same supply delivered in Maharashtra (IGST only).
const INTER: InvoiceSplit = {
  taxablePaise: 716_450n,
  cgstPaise: 0n,
  sgstPaise: 0n,
  igstPaise: 128_961n,
  totalPaise: 845_411n,
};

describe('splitCreditNote (CGST s.34, ADR-0026 D1) — largest remainder, to the paisa', () => {
  it('hand-checked: ₹0.59 off a ₹1.18 invoice — GST halves evenly, the odd paisa goes to taxable', () => {
    const remaining = {
      taxablePaise: 100n,
      cgstPaise: 9n,
      sgstPaise: 9n,
      igstPaise: 0n,
      totalPaise: 118n,
    };
    expect(splitCreditNote({ amountPaise: 59n, remaining })).toEqual({
      taxablePaise: 51n,
      cgstPaise: 4n,
      sgstPaise: 4n,
      igstPaise: 0n,
      totalPaise: 59n,
    });
  });

  it('always sums exactly to the refund, for odd amounts of paise', () => {
    for (const amount of [1n, 3n, 101n, 250_001n, 333_333n, 845_409n]) {
      const cn = splitCreditNote({ amountPaise: amount, remaining: INTRA });
      expect(sumOf(cn)).toBe(amount);
      expect(cn.totalPaise).toBe(amount);
    }
  });

  it("follows the invoice's proportion within one paisa per component", () => {
    const amount = 250_001n;
    const cn = splitCreditNote({ amountPaise: amount, remaining: INTRA });
    parts(cn).forEach((p, i) => {
      const exactTimesTotal = amount * (parts(INTRA)[i] as bigint);
      const diff = p * INTRA.totalPaise - exactTimesTotal;
      expect(diff < 0n ? -diff : diff).toBeLessThan(2n * INTRA.totalPaise);
    });
  });

  it('never takes more from a component than the invoice has left', () => {
    const cn = splitCreditNote({ amountPaise: 845_410n, remaining: INTRA });
    for (const [i, p] of parts(cn).entries()) expect(p <= (parts(INTRA)[i] as bigint)).toBe(true);
  });

  it('a partial credit note always has CGST equal to SGST', () => {
    for (const amount of [1n, 3n, 59n, 101n, 250_001n, 333_333n, 845_409n]) {
      const cn = splitCreditNote({ amountPaise: amount, remaining: INTRA });
      expect(cn.cgstPaise).toBe(cn.sgstPaise);
    }
  });

  it('crediting the whole remainder reproduces it exactly', () => {
    expect(splitCreditNote({ amountPaise: INTRA.totalPaise, remaining: INTRA })).toEqual(INTRA);
  });

  it('two partial credit notes add up to the invoice, component by component', () => {
    const first = splitCreditNote({ amountPaise: 300_007n, remaining: INTRA });
    const left = minus(INTRA, first);
    const second = splitCreditNote({ amountPaise: left.totalPaise, remaining: left });
    expect(minus(left, second)).toEqual({
      taxablePaise: 0n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: 0n,
      totalPaise: 0n,
    });
  });

  it('keeps an inter-state invoice IGST-only', () => {
    const cn = splitCreditNote({ amountPaise: 12_345n, remaining: INTER });
    expect(cn.cgstPaise).toBe(0n);
    expect(cn.sgstPaise).toBe(0n);
    expect(cn.taxablePaise + cn.igstPaise).toBe(12_345n);
  });

  it('refuses nothing, a negative amount, more than is left, or an inconsistent remainder', () => {
    expect(() => splitCreditNote({ amountPaise: 0n, remaining: INTRA })).toThrow(RangeError);
    expect(() => splitCreditNote({ amountPaise: -5n, remaining: INTRA })).toThrow(RangeError);
    expect(() => splitCreditNote({ amountPaise: 845_412n, remaining: INTRA })).toThrow(RangeError);
    expect(() =>
      splitCreditNote({ amountPaise: 10n, remaining: { ...INTRA, totalPaise: 1n } }),
    ).toThrow(RangeError);
  });
});

describe('credit note series and the s.34(2) window', () => {
  it('numbers credit notes CN/<FY>/<6-digit seq> per Indian financial year (IST)', () => {
    expect(creditNoteSeriesFor(new Date('2026-11-10T06:30:00Z'))).toEqual({
      code: 'CLK-CN',
      financialYear: '2026-27',
      prefix: 'CN/2026-27/',
    });
    // 2027-03-31T18:30Z is 1 April 2027 in IST: the next year's series.
    expect(creditNoteSeriesFor(new Date('2027-03-31T18:30:00Z')).prefix).toBe('CN/2027-28/');
    expect(creditNoteNumber('CN/2026-27/', 41)).toBe('CN/2026-27/000041');
  });

  it('allows a credit note until the end of 30 November after the invoice’s financial year (IST)', () => {
    const invoicedJan2027 = new Date('2027-01-15T06:30:00Z'); // FY 2026-27
    expect(creditNoteDeadline(invoicedJan2027).toISOString()).toBe('2027-11-30T18:29:59.999Z');
    expect(isCreditNoteLate(invoicedJan2027, new Date('2027-11-30T18:29:59.000Z'))).toBe(false);
    expect(isCreditNoteLate(invoicedJan2027, new Date('2027-11-30T18:30:00.000Z'))).toBe(true);
    // An April 2027 invoice is FY 2027-28: its window runs to 30 Nov 2028.
    expect(creditNoteDeadline(new Date('2027-04-02T00:00:00Z')).toISOString()).toBe(
      '2028-11-30T18:29:59.999Z',
    );
  });
});
