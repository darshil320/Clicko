import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEV_STAFF_TOTP_KEY, SecretBox } from '../auth/secret-box';

const key = randomBytes(32).toString('base64');

describe('SecretBox (AES-256-GCM for totp_secret at rest)', () => {
  it('round-trips and never stores the plaintext', () => {
    const box = new SecretBox(key);
    const sealed = box.seal(Buffer.from('JBSWY3DPEHPK3PXP'), 'staff-1');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed, 'staff-1').toString()).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh IV per seal', () => {
    const box = new SecretBox(key);
    expect(box.seal(Buffer.from('x'), 'a')).not.toBe(box.seal(Buffer.from('x'), 'a'));
  });

  it('is bound to its row: another staff id (AAD) cannot open it', () => {
    const box = new SecretBox(key);
    const sealed = box.seal(Buffer.from('secret'), 'staff-1');
    expect(() => box.open(sealed, 'staff-2')).toThrow();
  });

  it('detects tampering and a wrong key', () => {
    const box = new SecretBox(key);
    const sealed = box.seal(Buffer.from('secret'), 'staff-1');
    const parts = sealed.split('.');
    const ct = Buffer.from(parts[3] ?? '', 'base64url');
    ct[0] = (ct[0] ?? 0) ^ 1;
    const tampered = [parts[0], parts[1], parts[2], ct.toString('base64url')].join('.');
    expect(() => box.open(tampered, 'staff-1')).toThrow();
    expect(() =>
      new SecretBox(randomBytes(32).toString('base64')).open(sealed, 'staff-1'),
    ).toThrow();
    expect(() => box.open('not-sealed', 'staff-1')).toThrow();
  });

  it('refuses a key that is not 32 bytes of base64', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => new SecretBox('')).toThrow(/32 bytes/);
  });

  it('ships a public development key that decodes to 32 bytes', () => {
    expect(Buffer.from(DEV_STAFF_TOTP_KEY, 'base64')).toHaveLength(32);
  });
});
