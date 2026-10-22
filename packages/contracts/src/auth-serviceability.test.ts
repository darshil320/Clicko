import { describe, expect, it } from 'vitest';
import { JoinWaitlistBody, RequestOtpBody, ServiceabilityResult, VerifyOtpBody } from './index.js';

describe('auth contracts', () => {
  it('defaults the OTP purpose to LOGIN', () => {
    expect(RequestOtpBody.parse({ phone: '+919876543210' }).purpose).toBe('LOGIN');
  });

  it('rejects a non-Indian or malformed phone', () => {
    expect(RequestOtpBody.safeParse({ phone: '+14155550100' }).success).toBe(false);
  });

  it('requires exactly six digits for the code', () => {
    const base = { challengeId: '7b0f0d3e-2f4e-4c8a-9d4b-0c6b8f6a1e21', phone: '+919876543210' };
    expect(VerifyOtpBody.safeParse({ ...base, code: '123456' }).success).toBe(true);
    expect(VerifyOtpBody.safeParse({ ...base, code: '12345' }).success).toBe(false);
    expect(VerifyOtpBody.safeParse({ ...base, code: '12345a' }).success).toBe(false);
  });
});

describe('serviceability contracts', () => {
  it('describes a bookable LIVE pincode', () => {
    const r = ServiceabilityResult.parse({
      bookable: true,
      pincode: '395007',
      status: 'LIVE',
      areaName: 'Vesu',
      city: { id: '5c2d7a90-1e3f-4b6a-8c9d-2e4f6a8b0c12', name: 'Surat', tier: 'TIER_1' },
      travelZone: 0,
      limitedAvailability: false,
    });
    expect(r.bookable).toBe(true);
  });

  it('never marks a WAITLIST pincode as bookable', () => {
    expect(
      ServiceabilityResult.safeParse({
        bookable: true,
        pincode: '600001',
        status: 'WAITLIST',
        areaName: null,
        city: { id: '5c2d7a90-1e3f-4b6a-8c9d-2e4f6a8b0c12', name: 'Chennai', tier: 'METRO' },
        travelZone: 0,
        limitedAvailability: false,
      }).success,
    ).toBe(false);
  });

  it('trims the waitlist name and rejects an empty one', () => {
    const base = { phone: '+919876543210', pincode: '600001' };
    expect(JoinWaitlistBody.parse({ ...base, fullName: '  Ananya Iyer ' }).fullName).toBe(
      'Ananya Iyer',
    );
    expect(JoinWaitlistBody.safeParse({ ...base, fullName: '   ' }).success).toBe(false);
  });
});
