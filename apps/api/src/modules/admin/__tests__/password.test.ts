import { describe, expect, it } from 'vitest';
import {
  generateTemporaryPassword,
  hashPassword,
  SCRYPT_PARAMS,
  verifyPassword,
} from '../auth/password';

describe('staff password hashing (scrypt, ADR-0025 D2)', () => {
  it('stores scrypt$N$r$p$salt$hash with the ADR parameters and a 16-byte salt', async () => {
    const stored = await hashPassword('correct horse battery staple');
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    expect([scheme, n, r, p]).toEqual(['scrypt', '32768', '8', '1']);
    expect(SCRYPT_PARAMS).toMatchObject({ N: 2 ** 15, r: 8, p: 1, saltBytes: 16 });
    expect(Buffer.from(salt ?? '', 'base64url')).toHaveLength(16);
    expect(Buffer.from(hash ?? '', 'base64url')).toHaveLength(SCRYPT_PARAMS.keyBytes);
  });

  it('verifies the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('refuses malformed or foreign hashes instead of throwing', async () => {
    for (const bad of ['!', '', 'scrypt$1$8$1$x$y', 'bcrypt$2b$10$abc', 'scrypt$32768$8$1$$']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('temporary passwords are at least 16 characters and unique', () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
