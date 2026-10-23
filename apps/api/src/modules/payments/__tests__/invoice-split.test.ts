import { describe, expect, it } from 'vitest';
import { splitInvoice } from '../invoice-split';

// A Surat booking (place of supply Gujarat, same state as Clickco): taxable 1432900, GST 257922.
const SNAPSHOT = { taxablePaise: 1_432_900n, totalPaise: 1_690_822n };
const GUJARAT = '24';
const MAHARASHTRA = '27';

const sumOf = (s: ReturnType<typeof splitInvoice>) =>
  s.taxablePaise + s.cgstPaise + s.sgstPaise + s.igstPaise;

describe('splitInvoice (ADR-0009 advance invoice)', () => {
  it('splits the advance in proportion to the snapshot, GST taking the remainder', () => {
    const s = splitInvoice({ amountPaise: 845_411n, snapshot: SNAPSHOT, placeOfSupply: GUJARAT });
    // The advance is exactly half the total here, so taxable is exactly half: 716450.
    expect(s.taxablePaise).toBe(716_450n);
    expect(s.cgstPaise + s.sgstPaise).toBe(845_411n - 716_450n);
    expect(s.totalPaise).toBe(845_411n);
    expect(sumOf(s)).toBe(s.totalPaise);
  });

  it('gives CGST the odd paise and SGST the remainder within Gujarat', () => {
    const s = splitInvoice({ amountPaise: 845_411n, snapshot: SNAPSHOT, placeOfSupply: GUJARAT });
    const gst = 845_411n - s.taxablePaise; // 128961
    expect(s.cgstPaise).toBe((gst + 1n) / 2n);
    expect(s.sgstPaise).toBe(gst - s.cgstPaise);
    expect(s.igstPaise).toBe(0n);
  });

  it('charges IGST only, outside Gujarat', () => {
    const s = splitInvoice({
      amountPaise: 845_411n,
      snapshot: SNAPSHOT,
      placeOfSupply: MAHARASHTRA,
    });
    expect(s.cgstPaise).toBe(0n);
    expect(s.sgstPaise).toBe(0n);
    expect(s.igstPaise).toBe(845_411n - s.taxablePaise);
    expect(sumOf(s)).toBe(845_411n);
  });

  it('reproduces the snapshot exactly when the whole total is paid up front', () => {
    const s = splitInvoice({ amountPaise: 1_690_822n, snapshot: SNAPSHOT, placeOfSupply: GUJARAT });
    expect(s.taxablePaise).toBe(1_432_900n);
    expect(s.cgstPaise).toBe(128_961n);
    expect(s.sgstPaise).toBe(128_961n);
    expect(s.totalPaise).toBe(1_690_822n);
  });

  it('leaves the balance invoice an exact remainder so the two always sum to the snapshot', () => {
    const odd = { taxablePaise: 100_001n, totalPaise: 118_001n };
    const advance = splitInvoice({ amountPaise: 59_001n, snapshot: odd, placeOfSupply: GUJARAT });
    const balanceTaxable = odd.taxablePaise - advance.taxablePaise;
    const balanceGst =
      odd.totalPaise - odd.taxablePaise - (advance.totalPaise - advance.taxablePaise);
    expect(advance.taxablePaise + balanceTaxable).toBe(odd.taxablePaise);
    expect(balanceGst).toBeGreaterThanOrEqual(0n);
    expect(sumOf(advance)).toBe(59_001n);
  });

  it('handles a 1-paise payment and odd paise everywhere without losing a paisa', () => {
    for (const amount of [1n, 2n, 3n, 99_999n, 845_413n]) {
      const s = splitInvoice({ amountPaise: amount, snapshot: SNAPSHOT, placeOfSupply: GUJARAT });
      expect(sumOf(s)).toBe(amount);
      expect(s.taxablePaise).toBeGreaterThanOrEqual(0n);
      expect(s.sgstPaise).toBeGreaterThanOrEqual(0n);
    }
  });

  it('refuses amounts that make no sense against the snapshot', () => {
    expect(() =>
      splitInvoice({ amountPaise: 0n, snapshot: SNAPSHOT, placeOfSupply: GUJARAT }),
    ).toThrow(RangeError);
    expect(() =>
      splitInvoice({ amountPaise: 1_690_823n, snapshot: SNAPSHOT, placeOfSupply: GUJARAT }),
    ).toThrow(RangeError);
    expect(() =>
      splitInvoice({
        amountPaise: 1n,
        snapshot: { taxablePaise: 0n, totalPaise: 0n },
        placeOfSupply: GUJARAT,
      }),
    ).toThrow(RangeError);
  });
});
