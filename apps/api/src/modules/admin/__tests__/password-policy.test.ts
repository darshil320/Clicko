import { STAFF_PASSWORD_POLICY, staffPasswordProblem } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../auth/password';
import {
  assertNewPassword,
  temporaryPasswordExpired,
  temporaryPasswordExpiry,
} from '../auth/password-policy';

const NOW = new Date('2026-10-30T09:30:00.000Z');

describe('staff password lifecycle rules (ADR-0026 D7)', () => {
  it('gives a temporary password 72 hours', () => {
    expect(STAFF_PASSWORD_POLICY.temporaryTtlHours).toBe(72);
    expect(temporaryPasswordExpiry(NOW).toISOString()).toBe('2026-11-02T09:30:00.000Z');
  });

  it('expires only a temporary password, at its expiry (and fails closed without one)', () => {
    const until = temporaryPasswordExpiry(NOW);
    const temp = { mustChangePassword: true, tempPasswordExpiresAt: until };
    expect(temporaryPasswordExpired(temp, new Date(until.getTime() - 1))).toBe(false);
    expect(temporaryPasswordExpired(temp, until)).toBe(true);
    expect(temporaryPasswordExpired({ ...temp, tempPasswordExpiresAt: null }, NOW)).toBe(true);
    expect(
      temporaryPasswordExpired({ mustChangePassword: false, tempPasswordExpiresAt: null }, until),
    ).toBe(false);
  });

  it('explains what is wrong with a new password', () => {
    const email = 'aisha.khan@clickco.in';
    expect(staffPasswordProblem('short', { email })).toBe('Use at least 12 characters');
    expect(staffPasswordProblem('x'.repeat(129), { email })).toBe('Use at most 128 characters');
    expect(staffPasswordProblem(' Aisha.Khan@Clickco.in ', { email })).toBe(
      'Don’t use your email as your password',
    );
    expect(staffPasswordProblem('aisha.khan12', { email: 'aisha.khan12@clickco.in' })).toBe(
      'Don’t use your email as your password',
    );
    expect(
      staffPasswordProblem('monsoon-ferry-lantern', { email, previous: 'monsoon-ferry-lantern' }),
    ).toBe('Choose a password different from the current one');
    expect(staffPasswordProblem('monsoon-ferry-lantern', { email })).toBeNull();
  });

  it('refuses the password being replaced, checked against its hash', async () => {
    const passwordHash = await hashPassword('the-temporary-one');
    const staff = { email: 'aisha.khan@clickco.in', passwordHash };
    await expect(assertNewPassword('the-temporary-one', staff)).rejects.toMatchObject({
      response: { code: 'PASSWORD_REJECTED' },
    });
    await expect(assertNewPassword('aisha.khan@clickco.in', staff)).rejects.toMatchObject({
      response: { message: 'Don’t use your email as your password' },
    });
    await expect(assertNewPassword('a-brand-new-password', staff)).resolves.toBeUndefined();
  });
});
