import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BankAccountCipher, bankAccountKeyFrom, bankKeyringFrom } from '../bank-account-cipher';

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

  describe('keyring and rotation (audit M4)', () => {
    const totp = randomBytes(32).toString('base64');
    const bankV2 = randomBytes(32).toString('base64');
    const bankV3 = randomBytes(32).toString('base64');
    const env = (over: Record<string, unknown>) => ({
      NODE_ENV: 'production',
      STAFF_TOTP_KEY: totp,
      BANK_ACCOUNT_KEY_VERSION: 2,
      ...over,
    });

    it('seals under BANK_ACCOUNT_KEY with its version byte, never with STAFF_TOTP_KEY', () => {
      const cipher = new BankAccountCipher(bankKeyringFrom(env({ BANK_ACCOUNT_KEY: bankV2 })));
      const sealed = cipher.seal('001234567890', PRO);
      expect(BankAccountCipher.versionOf(sealed)).toBe(2);
      const legacy = new BankAccountCipher(bankAccountKeyFrom(totp));
      expect(() => legacy.open(sealed, PRO)).toThrow();
      // A version-1 (STAFF_TOTP_KEY-derived) value does not open when deployed.
      expect(() => cipher.open(legacy.seal('001234567890', PRO), PRO)).toThrow();
    });

    it('a rotated key still opens what the previous key sealed', () => {
      const before = new BankAccountCipher(bankKeyringFrom(env({ BANK_ACCOUNT_KEY: bankV2 })));
      const sealed = before.seal('001234567890', PRO);
      const after = new BankAccountCipher(
        bankKeyringFrom(
          env({
            BANK_ACCOUNT_KEY: bankV3,
            BANK_ACCOUNT_KEY_VERSION: 3,
            BANK_ACCOUNT_KEY_PREVIOUS: { version: 2, key: bankV2 },
          }),
        ),
      );
      expect(after.open(sealed, PRO)).toBe('001234567890');
      expect(BankAccountCipher.versionOf(after.seal('001234567890', PRO))).toBe(3);
      const dropped = new BankAccountCipher(
        bankKeyringFrom(env({ BANK_ACCOUNT_KEY: bankV3, BANK_ACCOUNT_KEY_VERSION: 3 })),
      );
      expect(() => dropped.open(sealed, PRO)).toThrow(/unknown key version/);
    });

    it('deployed without BANK_ACCOUNT_KEY refuses to build; development falls back to v1', () => {
      expect(() => bankKeyringFrom(env({}))).toThrow(/BANK_ACCOUNT_KEY/);
      const dev = new BankAccountCipher(bankKeyringFrom(env({ NODE_ENV: 'development' })));
      expect(dev.currentVersion).toBe(1);
      const legacy = new BankAccountCipher(bankAccountKeyFrom(totp));
      expect(dev.open(legacy.seal('001234567890', PRO), PRO)).toBe('001234567890');
    });
  });
});
