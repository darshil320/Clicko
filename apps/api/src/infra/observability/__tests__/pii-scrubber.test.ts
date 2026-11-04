import { describe, expect, it } from 'vitest';
import { REDACTED, scrubPii, scrubText } from '../pii-scrubber';

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

const UUID = '3f2b8a52-6c1e-4d7a-9b1f-0c8e2a4d5b6f';

describe('scrubPii — sensitive keys (ADR-0029 D3)', () => {
  it('redacts phone, email, token and bank fields at any depth, in any case style', () => {
    const scrubbed = scrubPii({
      phone: '+919876543210',
      booker: { phoneE164: '+919876543210', email: 'rohan@example.com', fullName: 'Rohan Shah' },
      accessToken: 'abc',
      refresh_token: 'def',
      headers: { authorization: 'Bearer xyz', cookie: 'sid=1' },
      password: 'hunter2',
      otp: '123456',
      bankAccountNumber: '123456789012',
      account_number: '000123',
      ifsc: 'HDFC0001234',
      upiId: 'rohan@okicici',
      vpa: 'rohan@ybl',
      pan: 'ABCDE1234F',
      aadhaarNumber: '1234 5678 9012',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      venueAddress: '4 Athwalines, Surat',
      location: { lat: 21.17, lng: 72.83 },
      signature: 'deadbeef',
      contact: '+919876543210',
      payerVpa: 'rohan@ybl',
      customerUpi: 'rohan@ybl',
      lastOtp: '123456',
      beneficiaryName: 'Hetal Patel',
      holderName: 'Hetal Patel',
      pincode: '395007',
    });
    expect(scrubbed).toEqual({
      phone: REDACTED,
      booker: { phoneE164: REDACTED, email: REDACTED, fullName: REDACTED },
      accessToken: REDACTED,
      refresh_token: REDACTED,
      headers: { authorization: REDACTED, cookie: REDACTED },
      password: REDACTED,
      otp: REDACTED,
      bankAccountNumber: REDACTED,
      account_number: REDACTED,
      ifsc: REDACTED,
      upiId: REDACTED,
      vpa: REDACTED,
      pan: REDACTED,
      aadhaarNumber: REDACTED,
      totpSecret: REDACTED,
      venueAddress: REDACTED,
      location: REDACTED,
      signature: REDACTED,
      contact: REDACTED,
      payerVpa: REDACTED,
      customerUpi: REDACTED,
      lastOtp: REDACTED,
      beneficiaryName: REDACTED,
      holderName: REDACTED,
      pincode: REDACTED,
    });
  });

  it('keeps what debugging needs: ids, codes, statuses, amounts, job and file names', () => {
    const safe = {
      code: 'BOOKING_NOT_FOUND',
      bookingId: UUID,
      status: 'QA',
      amountPaise: 291_822,
      job: 'notifications.send',
      queue: 'notifications',
      name: 'DRY_0001.DNG',
      groupId: 'g-1',
      company: 'Clicko',
      attemptsMade: 5,
      final: true,
      at: '2026-11-04T08:42:51.527Z',
    };
    expect(scrubPii(safe)).toEqual(safe);
  });

  it('never changes its input', () => {
    const input = deepFreeze({
      user: { phone: '+919876543210', id: UUID },
      list: [{ email: 'a@b.co' }],
    });
    const before = JSON.stringify(input);
    expect(() => scrubPii(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('scrubText — personal data inside free text', () => {
  it.each([
    ['Call +91 98765 43210 now', '+91 98765 43210'],
    ['phone 9876543210 refused', '9876543210'],
    ['E.164 +447911123456', '+447911123456'],
    ['mail rohan.shah+x@example.co.in', 'rohan.shah+x@example.co.in'],
    ['pay to rohan@okicici', 'rohan@okicici'],
    ['Authorization: Bearer abc.def-ghi_jkl', 'abc.def-ghi_jkl'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlc2lnbmF0dXJl', 'eyJhbGciOiJIUzI1NiJ9'],
    ['GET /d/Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG failed', 'Abcdefghijklmnop'],
    ['account 50100123456789 IFSC HDFC0001234', '50100123456789'],
    ['account 50100123456789 IFSC HDFC0001234', 'HDFC0001234'],
    ['PAN ABCDE1234F on file', 'ABCDE1234F'],
    ['aadhaar 1234 5678 9012', '1234 5678 9012'],
    ['refresh 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08x', '9f86d081884c'],
    // Security review (4 Nov): formats the first rules missed.
    ['call 091-9876543210', '9876543210'],
    ['call 91-9876543210', '9876543210'],
    ['call 987-654-3210', '654-3210'],
    ['call 9876 543 210', '543 210'],
    ['call 98765.43210', '98765.43210'],
    ['acct-50100123456789 failed', '50100123456789'],
    ['aadhaar 1234-5678-9012', '5678-9012'],
    ['ref 1234567890123456789012345 seen', '1234567890123456789012345'],
    // A long secret with a digit run must not be split into short surviving pieces.
    [
      'hmac abcdefabcdefabcdefabcdefabc123456789abcdefabcdefabcdefabcdefabcd',
      'abcdefabcdefabcdefabcdefabc',
    ],
    ['key dGhpcyBpcyBhIHNlY3JldCBrZXkgdGhhdCBpcyBsb25n+/k= end', 'dGhpcyBpcyBhIHNlY3JldCBr'],
  ])('%s → hides %s', (text, secret) => {
    const out = scrubText(text);
    expect(out).not.toContain(secret);
    expect(out).toContain('[');
  });

  it('keeps job ids readable: a uuid inside a longer id survives', () => {
    expect(scrubText(`jpeg-export-${UUID}`)).toBe(`jpeg-export-${UUID}`);
    expect(scrubText(`deadline-${UUID}-1730700000`)).toContain(UUID);
  });

  it('does not mistake ordinary words after "basic" or "bearer" for a credential', () => {
    expect(scrubText('No extension rate for BASIC in TIER_1')).toBe(
      'No extension rate for BASIC in TIER_1',
    );
  });

  it('scrubs before it truncates, so a cut never leaves half a phone number', () => {
    const text = `${'x'.repeat(1_995)} +919876543210`;
    expect(scrubText(text)).not.toMatch(/\+9198/);
  });

  it('keeps uuids, error codes, short numbers and plain sentences', () => {
    const text = `Booking ${UUID} is in QA (code BOOKING_CHANGED, 3 of 5 attempts, 409)`;
    expect(scrubText(text)).toBe(text);
  });
});

describe('scrubPii — shapes', () => {
  it('turns an Error into its scrubbed name, message, stack and cause', () => {
    const cause = new Error('upstream said 9876543210 is invalid');
    const error = Object.assign(new Error('OTP for rohan@example.com failed', { cause }), {
      code: 'SMS_FAILED',
    });
    const out = scrubPii(error) as Record<string, unknown>;
    expect(out.name).toBe('Error');
    expect(out.code).toBe('SMS_FAILED');
    expect(String(out.message)).not.toContain('rohan@example.com');
    expect(String(out.stack)).not.toContain('rohan@example.com');
    expect(JSON.stringify(out.cause)).not.toContain('9876543210');
  });

  it('survives cycles, deep nesting, binary and huge inputs', () => {
    const cyclic: Record<string, unknown> = { id: UUID };
    cyclic.self = cyclic;
    expect(scrubPii(cyclic)).toEqual({ id: UUID, self: '[circular]' });

    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    expect(JSON.stringify(scrubPii(deep))).toContain('[depth]');

    expect(scrubPii({ body: Buffer.from('hello') })).toEqual({ body: '[binary 5 bytes]' });
    const big = scrubPii({
      text: 'x'.repeat(10_000),
      list: Array.from({ length: 500 }, (_, i) => i),
    });
    const { text, list } = big as { text: string; list: unknown[] };
    expect(text.length).toBeLessThan(2_100);
    expect(list.length).toBeLessThanOrEqual(51);
  });

  it('is JSON-safe for bigint, dates, functions and undefined', () => {
    const out = scrubPii({
      big: 10n,
      at: new Date('2026-11-04T00:00:00Z'),
      fn: () => 1,
      u: undefined,
    });
    expect(out).toEqual({ big: '10', at: '2026-11-04T00:00:00.000Z', fn: '[function]' });
  });
});
