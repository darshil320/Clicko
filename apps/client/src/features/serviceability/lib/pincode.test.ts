import { describe, expect, it } from 'vitest';
import {
  locationLabel,
  normalisePincode,
  notServedHeadline,
  PincodeForm,
  WaitlistForm,
  waitingLine,
} from './pincode';

describe('normalisePincode', () => {
  it('accepts a 6-digit Indian pincode, spaces allowed', () => {
    expect(normalisePincode('395007')).toBe('395007');
    expect(normalisePincode('395 007')).toBe('395007');
  });

  it.each(['095007', '39500', '3950077', 'abcdef', ''])('rejects %s', (input) => {
    expect(normalisePincode(input)).toBeNull();
  });

  it('backs the form with a plain message', () => {
    expect(PincodeForm.safeParse({ pincode: '39500' }).error?.issues[0]?.message).toBe(
      'Enter a 6-digit pincode',
    );
  });
});

describe('serviceability copy', () => {
  it('labels a served pincode with its area when known', () => {
    const base = {
      bookable: true as const,
      pincode: '395007',
      status: 'LIVE' as const,
      city: { id: '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f', name: 'Surat', tier: 'TIER_1' as const },
      travelZone: 0 as const,
      limitedAvailability: false,
    };
    expect(locationLabel({ ...base, areaName: 'Vesu' })).toBe('Vesu, Surat');
    expect(locationLabel({ ...base, areaName: null })).toBe('Surat');
  });

  it('explains an unserved pincode by status', () => {
    const base = {
      bookable: false as const,
      pincode: '302001',
      canJoinWaitlist: true,
      waitingCount: 0,
    };
    expect(notServedHeadline({ ...base, status: 'WAITLIST', cityName: 'Jaipur' })).toBe(
      "We're coming to Jaipur soon",
    );
    expect(notServedHeadline({ ...base, status: 'UNKNOWN', cityName: null })).toBe(
      "We don't shoot in pincode 302001 yet",
    );
    expect(notServedHeadline({ ...base, status: 'BLOCKED', cityName: 'Pune' })).toBe(
      "We can't take bookings in Pune right now",
    );
  });

  it('counts the waitlist in words', () => {
    expect(waitingLine(0)).toBeNull();
    expect(waitingLine(1)).toBe('1 person is waiting here');
    expect(waitingLine(24)).toBe('24 people are waiting here');
  });

  it('requires a name to join the waitlist', () => {
    expect(WaitlistForm.safeParse({ fullName: ' ' }).success).toBe(false);
    expect(WaitlistForm.safeParse({ fullName: 'Vikram Reddy' }).success).toBe(true);
  });
});
