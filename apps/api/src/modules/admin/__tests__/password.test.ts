import { describe, expect, it } from 'vitest';
import {
  generateTemporaryPassword,
  hashPassword,
  SCRYPT_MAX_CONCURRENT,
  SCRYPT_MAX_WAITING,
  SCRYPT_PARAMS,
  scryptRunning,
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

  it('runs at most SCRYPT_MAX_CONCURRENT derivations at once and finishes every queued one', async () => {
    const stored = await hashPassword('correct horse battery staple');
    let peak = 0;
    const sampler = setInterval(() => {
      peak = Math.max(peak, scryptRunning());
    }, 1);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        verifyPassword(i % 2 === 0 ? 'correct horse battery staple' : 'wrong', stored),
      ),
    );
    clearInterval(sampler);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(SCRYPT_MAX_CONCURRENT);
    expect(results).toEqual([true, false, true, false, true, false]);
    expect(scryptRunning()).toBe(0);
  });

  it('turns a request away (503) when the queue is full, and frees every slot after', async () => {
    const stored = await hashPassword('correct horse battery staple');
    const total = SCRYPT_MAX_CONCURRENT + SCRYPT_MAX_WAITING + 1;
    const results = await Promise.allSettled(
      Array.from({ length: total }, () => verifyPassword('wrong', stored)),
    );
    const refused = results.filter((r) => r.status === 'rejected');
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({ status: 503 });
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(total - 1);
    expect(scryptRunning()).toBe(0);
  }, 30_000);
});
