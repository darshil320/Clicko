import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const TAG_BYTES = 16;

/**
 * AES-256-GCM for `staff_users.totp_secret` at rest (ADR-0025 D2). The key is env
 * STAFF_TOTP_KEY (32 bytes, base64). The staff id is the additional authenticated data, so a
 * sealed secret copied onto another staff row does not open.
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('STAFF_TOTP_KEY must decode to 32 bytes');
    this.key = key;
  }

  seal(plaintext: Buffer, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  /** Throws on a wrong key, wrong AAD, tampering or a malformed value. */
  open(sealed: string, aad: string): Buffer {
    const [version, iv, tag, ct] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || ct === undefined) {
      throw new Error('SecretBox.open: malformed value');
    }
    const authTag = Buffer.from(tag, 'base64url');
    // A truncated tag is forgeable: only the full 16 bytes are accepted.
    if (authTag.length !== TAG_BYTES) throw new Error('SecretBox.open: malformed value');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
  }
}

/**
 * A fixed, PUBLIC key for development and test only (env.ts refuses it elsewhere), so local
 * machines and CI need no secret. Anything sealed with it is readable by anyone with the repo.
 */
export const DEV_STAFF_TOTP_KEY = createHash('sha256')
  .update('clickco-staff-totp-key-development-only')
  .digest('base64');
