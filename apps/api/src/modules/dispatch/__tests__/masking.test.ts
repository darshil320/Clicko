import { describe, expect, it } from 'vitest';
import { HIDDEN_NUMBER, maskPhoneNumbers, roundToHalfKm } from '../masking';

describe('maskPhoneNumbers (Invariant 11)', () => {
  it.each([
    'Call 9876543210 at the gate',
    'Call +91 98765 43210 at the gate',
    'Call +91-98765-43210 at the gate',
    'Call (0261) 234-5678 at the gate',
    'Call 98765.43210 at the gate',
  ])('hides the number in %s', (text) => {
    expect(maskPhoneNumbers(text)).toBe(`Call ${HIDDEN_NUMBER} at the gate`);
  });

  it('leaves pincodes, flat numbers and short numbers alone', () => {
    const text = 'Flat 402, Tower 11, Vesu, Surat 395007 — gate 3';
    expect(maskPhoneNumbers(text)).toBe(text);
  });

  it('hides every number in the text', () => {
    expect(maskPhoneNumbers('9876543210 or 9811122233')).toBe(
      `${HIDDEN_NUMBER} or ${HIDDEN_NUMBER}`,
    );
  });
});

describe('roundToHalfKm', () => {
  it('rounds to the nearest half kilometre', () => {
    expect([3.26, 3.24, 0.2, 7.75].map(roundToHalfKm)).toEqual([3.5, 3, 0, 8]);
    expect(roundToHalfKm(null)).toBeNull();
  });
});
