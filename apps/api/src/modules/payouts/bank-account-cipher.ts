import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * `photographer_bank_accounts.account_number_enc` (Invariant 16: never plaintext at rest).
 * AES-256-GCM; the photographer id is the additional authenticated data, so a sealed number copied
 * onto another photographer's row does not open.
 * Bytes: key version (1) | IV (12) | tag (16) | ciphertext.
 *
 * Keys (audit M4): a keyring keyed by the version byte, so a key can be rotated — new numbers are
 * sealed with the current key, older ones still open with the key their byte names, and a
 * re-seal job can move them over before the old key is dropped.
 * - BANK_ACCOUNT_KEY (env, its own 32-byte key, never STAFF_TOTP_KEY) under
 *   BANK_ACCOUNT_KEY_VERSION (2–255); BANK_ACCOUNT_KEY_PREVIOUS (`<version>:<base64>`) opens only.
 * - Version 1 is the legacy key derived (HKDF) from STAFF_TOTP_KEY. Development and test only:
 *   it seals while no BANK_ACCOUNT_KEY is set, so local data keeps opening. Staging/production
 *   require BANK_ACCOUNT_KEY and never load version 1.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;
const HKDF_INFO = 'clickco/photographer-bank-account/v1';

/** The version byte of the legacy STAFF_TOTP_KEY-derived key (development and test only). */
export const LEGACY_BANK_KEY_VERSION = 1;

export function bankAccountKeyFrom(base64Key: string): Buffer {
  const ikm = Buffer.from(base64Key, 'base64');
  if (ikm.length !== 32) throw new Error('the bank account key must decode to 32 bytes');
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), HKDF_INFO, 32));
}

export const BANK_ACCOUNT_CIPHER = Symbol('BANK_ACCOUNT_CIPHER');

export interface BankKeyring {
  /** The version new numbers are sealed with; must be in `keys`. */
  readonly current: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

/** What env.ts hands over (already validated). */
export interface BankKeyEnv {
  readonly NODE_ENV: string;
  readonly STAFF_TOTP_KEY: string;
  readonly BANK_ACCOUNT_KEY?: string | undefined;
  readonly BANK_ACCOUNT_KEY_VERSION: number;
  readonly BANK_ACCOUNT_KEY_PREVIOUS?:
    | { readonly version: number; readonly key: string }
    | undefined;
}

const DEPLOYED = ['staging', 'production'];

/** The keyring for this environment (see the class comment). */
export function bankKeyringFrom(env: BankKeyEnv): BankKeyring {
  const keys = new Map<number, Buffer>();
  const deployed = DEPLOYED.includes(env.NODE_ENV);
  if (!deployed) keys.set(LEGACY_BANK_KEY_VERSION, bankAccountKeyFrom(env.STAFF_TOTP_KEY));
  if (env.BANK_ACCOUNT_KEY_PREVIOUS) {
    keys.set(env.BANK_ACCOUNT_KEY_PREVIOUS.version, raw(env.BANK_ACCOUNT_KEY_PREVIOUS.key));
  }
  if (env.BANK_ACCOUNT_KEY) {
    keys.set(env.BANK_ACCOUNT_KEY_VERSION, raw(env.BANK_ACCOUNT_KEY));
    return { current: env.BANK_ACCOUNT_KEY_VERSION, keys };
  }
  if (deployed) throw new Error('BANK_ACCOUNT_KEY is required in staging and production');
  return { current: LEGACY_BANK_KEY_VERSION, keys };
}

function raw(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('the bank account key must decode to 32 bytes');
  return key;
}

export class BankAccountCipher {
  private readonly ring: BankKeyring;

  /** A single 32-byte key is version 1 (tests and the legacy derivation). */
  constructor(keyOrRing: Buffer | BankKeyring) {
    this.ring = Buffer.isBuffer(keyOrRing)
      ? { current: LEGACY_BANK_KEY_VERSION, keys: new Map([[LEGACY_BANK_KEY_VERSION, keyOrRing]]) }
      : keyOrRing;
    const current = this.ring.keys.get(this.ring.current);
    if (!current || current.length !== 32) {
      throw new Error('BankAccountCipher needs a 32-byte current key');
    }
    if (this.ring.current < 1 || this.ring.current > 255) {
      throw new Error('BankAccountCipher key versions are 1–255');
    }
  }

  /** The version byte a sealed value names (a re-seal job picks out old ones). */
  static versionOf(sealed: Buffer): number | null {
    return sealed.length > HEADER_BYTES ? (sealed[0] ?? null) : null;
  }

  get currentVersion(): number {
    return this.ring.current;
  }

  private aad(photographerId: string): Buffer {
    return Buffer.from(`photographer-bank-account:${photographerId}`);
  }

  seal(accountNumber: string, photographerId: string): Buffer {
    const key = this.ring.keys.get(this.ring.current) as Buffer;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(this.aad(photographerId));
    const ct = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([this.ring.current]), iv, cipher.getAuthTag(), ct]);
  }

  /** Throws on an unknown key version, wrong photographer, tampering or a malformed value. */
  open(sealed: Buffer, photographerId: string): string {
    const version = BankAccountCipher.versionOf(sealed);
    const key = version === null ? undefined : this.ring.keys.get(version);
    if (!key) throw new Error('BankAccountCipher.open: malformed value or unknown key version');
    const iv = sealed.subarray(1, 1 + IV_BYTES);
    const tag = sealed.subarray(1 + IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(this.aad(photographerId));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(sealed.subarray(HEADER_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}
