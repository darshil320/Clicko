import { describe, expect, it } from 'vitest';
import {
  DeclineOfferBody,
  ProOffer,
  ProOtpVerifyBody,
  RequestOtpBody,
  VerifyOtpResponse,
} from './index.js';

const offer = {
  attemptId: '8a2c5a7e-4a0b-4c1e-9d4f-2f6b1b9a3c11',
  bookingId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
  bookingReference: 'CLK-1001',
  categoryCode: 'FOOD',
  tier: 'PROFESSIONAL',
  scheduledStart: '2026-11-15T06:30:00.000Z',
  scheduledHours: 2,
  emergencyBand: 'NONE',
  isBroadcast: false,
  payoutPaise: 620_000,
  distanceKm: 3.5,
  area: { pincode: '395007', areaName: null, cityName: 'Surat' },
  clientDisplayName: 'Ananya I.',
  expiresAt: '2026-11-10T06:32:00.000Z',
};

describe('dispatch contracts', () => {
  it('a pro offer carries no address or phone: unknown keys are stripped', () => {
    const parsed = ProOffer.parse({
      ...offer,
      venueAddress: '12 Ghod Dod Road',
      bookerPhone: '+919876543210',
    });
    expect(parsed).not.toHaveProperty('venueAddress');
    expect(parsed).not.toHaveProperty('bookerPhone');
  });

  it('refuses a fractional payout and a distance finer than 0.5 km', () => {
    expect(ProOffer.safeParse({ ...offer, payoutPaise: 620_000.5 }).success).toBe(false);
    expect(ProOffer.safeParse({ ...offer, distanceKm: 3.4 }).success).toBe(false);
  });

  it('decline reason is optional, trimmed and bounded', () => {
    expect(DeclineOfferBody.parse({})).toEqual({});
    expect(DeclineOfferBody.parse({ reason: '  too far  ' })).toEqual({ reason: 'too far' });
    expect(DeclineOfferBody.safeParse({ reason: 'x'.repeat(201) }).success).toBe(false);
  });

  it('pro OTP verify needs a 6-digit code and an Indian mobile', () => {
    const ok = {
      challengeId: offer.attemptId,
      phone: '+919825010001',
      code: '123456',
    };
    expect(ProOtpVerifyBody.safeParse(ok).success).toBe(true);
    expect(ProOtpVerifyBody.safeParse({ ...ok, code: '12345' }).success).toBe(false);
  });

  it('the client OTP endpoint only accepts the LOGIN purpose', () => {
    expect(RequestOtpBody.parse({ phone: '+919825010001' }).purpose).toBe('LOGIN');
    expect(RequestOtpBody.safeParse({ phone: '+919825010001', purpose: 'PRO_LOGIN' }).success).toBe(
      false,
    );
    expect(VerifyOtpResponse).toBeDefined();
  });
});
