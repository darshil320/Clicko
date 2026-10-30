import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * `photographer_bank_accounts.account_number_enc` (Invariant 16: never plaintext at rest).
 * AES-256-GCM; the photographer id is the additional authenticated data, so a sealed number copied
 * onto another photographer's row does not open.
 * Bytes: version (1) | IV (12) | tag (16) | ciphertext.
 *
 * Key: derived (HKDF-SHA256, its own label) from STAFF_TOTP_KEY until env.ts grows a dedicated
 * BANK_ACCOUNT_KEY — the derivation keeps the two uses cryptographically separate, but rotating
 * STAFF_TOTP_KEY then means re-sealing bank numbers too (stream B report, owner follow-up).
 * Whoever writes bank accounts (onboarding) must seal with this class.
 */
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;
const HKDF_INFO = 'clickco/photographer-bank-account/v1';

export function bankAccountKeyFrom(base64Key: string): Buffer {
  const ikm = Buffer.from(base64Key, 'base64');
  if (ikm.length !== 32) throw new Error('the bank account key must decode to 32 bytes');
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), HKDF_INFO, 32));
}

export const BANK_ACCOUNT_CIPHER = Symbol('BANK_ACCOUNT_CIPHER');

export class BankAccountCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('BankAccountCipher needs a 32-byte key');
  }

  private aad(photographerId: string): Buffer {
    return Buffer.from(`photographer-bank-account:${photographerId}`);
  }

  seal(accountNumber: string, photographerId: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad(photographerId));
    const ct = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
  }

  /** Throws on a wrong key, wrong photographer, tampering or a malformed value. */
  open(sealed: Buffer, photographerId: string): string {
    if (sealed.length <= HEADER_BYTES || sealed[0] !== VERSION) {
      throw new Error('BankAccountCipher.open: malformed value');
    }
    const iv = sealed.subarray(1, 1 + IV_BYTES);
    const tag = sealed.subarray(1 + IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(this.aad(photographerId));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(sealed.subarray(HEADER_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}
