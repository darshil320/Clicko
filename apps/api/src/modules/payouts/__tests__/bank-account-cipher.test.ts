import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BankAccountCipher, bankAccountKeyFrom } from '../bank-account-cipher';

const key = randomBytes(32).toString('base64');
const PRO = '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f';
const OTHER = '8e0a4d2b-3c5f-4d9e-8a21-2b3c4d5e6f70';

describe('bank account numbers at rest (Invariant 16)', () => {
  it('seals to bytes and opens for the same photographer', () => {
    const cipher = new BankAccountCipher(bankAccountKeyFrom(key));
    const sealed = cipher.seal('001234567890', PRO);
    expect(Buffer.isBuffer(sealed)).toBe(true);
    expect(sealed.includes(Buffer.from('001234567890'))).toBe(false);
    expect(cipher.open(sealed, PRO)).toBe('001234567890');
  });

  it('a sealed number copied onto another photographer does not open', () => {
    const cipher = new BankAccountCipher(bankAccountKeyFrom(key));
    expect(() => cipher.open(cipher.seal('001234567890', PRO), OTHER)).toThrow();
  });

  it('a different key, a flipped bit or a truncated value does not open', () => {
    const cipher = new BankAccountCipher(bankAccountKeyFrom(key));
    const sealed = cipher.seal('001234567890', PRO);
    const other = new BankAccountCipher(bankAccountKeyFrom(randomBytes(32).toString('base64')));
    expect(() => other.open(sealed, PRO)).toThrow();
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
    expect(() => cipher.open(flipped, PRO)).toThrow();
    expect(() => cipher.open(sealed.subarray(0, 20), PRO)).toThrow();
  });

  it('the derived key differs from the key it comes from', () => {
    expect(bankAccountKeyFrom(key).equals(Buffer.from(key, 'base64'))).toBe(false);
    expect(bankAccountKeyFrom(key)).toHaveLength(32);
  });
});
