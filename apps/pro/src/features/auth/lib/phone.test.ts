import { describe, expect, it } from 'vitest';
import { formatCountdown, OtpForm, PhoneForm, secondsUntil, toE164 } from './phone';

describe('toE164', () => {
  it.each([
    ['9800000777', '+919800000777'],
    ['98000 00777', '+919800000777'],
    ['098000-00777', '+919800000777'],
    ['+91 98000 00777', '+919800000777'],
    ['919800000777', '+919800000777'],
  ])('%s → %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(['12345', '5800000777', '98000007771', '+1 415 555 0100', ''])('rejects %s', (input) => {
    expect(toE164(input)).toBeNull();
  });
});

describe('sign-in forms', () => {
  it('validates the phone with a plain message', () => {
    const result = PhoneForm.safeParse({ phone: '12345' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Enter your 10-digit mobile number');
    expect(PhoneForm.safeParse({ phone: '98000 00777' }).success).toBe(true);
  });

  it('validates the 6-digit code', () => {
    expect(OtpForm.safeParse({ code: ' 123456 ' }).success).toBe(true);
    const bad = OtpForm.safeParse({ code: '12a456' });
    expect(bad.error?.issues[0]?.message).toBe('Enter the 6-digit code');
  });
});

describe('resend countdown', () => {
  it('counts whole seconds down to zero', () => {
    expect(secondsUntil(30_000, 0)).toBe(30);
    expect(secondsUntil(30_000, 29_500)).toBe(1);
    expect(secondsUntil(30_000, 40_000)).toBe(0);
    expect(formatCountdown(27)).toBe('0:27');
    expect(formatCountdown(65)).toBe('1:05');
  });
});
