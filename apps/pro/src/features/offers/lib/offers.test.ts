import type { ProOffer } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { UPLOAD_WITHIN_HOURS } from '@/shared/catalogue';
import { areaText, distanceText, expectedFrames, liveOffers, offerRequirements } from './offers';

const NOW = new Date('2026-10-28T10:00:00.000Z');

function offer(overrides: Partial<ProOffer> = {}): ProOffer {
  return {
    attemptId: '6c1f4f0e-2b7a-4c55-9d1e-0a3b5c7d9e01',
    bookingId: '7d2a5b1f-3c8b-4d66-8e2f-1b4c6d8e0f12',
    bookingReference: 'CK-2026-00412',
    categoryCode: 'FOOD',
    tier: 'PROFESSIONAL',
    scheduledStart: '2026-10-29T16:30:00+05:30',
    scheduledHours: 2,
    emergencyBand: 'NONE',
    isBroadcast: false,
    payoutPaise: 510_000,
    distanceKm: 3.5,
    area: { pincode: '395007', areaName: 'Vesu', cityName: 'Surat' },
    clientDisplayName: 'Priya S.',
    expiresAt: '2026-10-28T10:01:24.000Z',
    ...overrides,
  };
}

describe('liveOffers', () => {
  it('hides offers whose window has closed', () => {
    const live = offer({ attemptId: 'a-live', expiresAt: '2026-10-28T10:00:30.000Z' });
    const expired = offer({ attemptId: 'a-gone', expiresAt: '2026-10-28T09:59:59.000Z' });
    const closing = offer({ attemptId: 'a-now', expiresAt: '2026-10-28T10:00:00.000Z' });
    expect(liveOffers([expired, live, closing], NOW).map((o) => o.attemptId)).toEqual(['a-live']);
  });

  it('puts emergency bands first (under 3 h before 3–8 h), then the soonest expiry', () => {
    const normalSoon = offer({ attemptId: 'normal-soon', expiresAt: '2026-10-28T10:00:20.000Z' });
    const sameDay = offer({
      attemptId: 'same-day',
      emergencyBand: 'SAME_DAY',
      expiresAt: '2026-10-28T10:00:40.000Z',
    });
    const emergencyLate = offer({
      attemptId: 'em-3-8',
      emergencyBand: 'HOURS_3_8',
      expiresAt: '2026-10-28T10:01:30.000Z',
    });
    const emergencyUrgent = offer({
      attemptId: 'em-under-3',
      emergencyBand: 'HOURS_UNDER_3',
      expiresAt: '2026-10-28T10:02:00.000Z',
    });
    const order = liveOffers([normalSoon, sameDay, emergencyLate, emergencyUrgent], NOW).map(
      (o) => o.attemptId,
    );
    expect(order).toEqual(['em-under-3', 'em-3-8', 'normal-soon', 'same-day']);
  });

  it('does not reorder the list it was given', () => {
    const input = [
      offer({ attemptId: 'b', expiresAt: '2026-10-28T10:02:00.000Z' }),
      offer({ attemptId: 'a', expiresAt: '2026-10-28T10:01:00.000Z' }),
    ];
    const before = input.map((o) => o.attemptId);
    liveOffers(input, NOW);
    expect(input.map((o) => o.attemptId)).toEqual(before);
  });

  it('breaks a tie on expiry by attempt id, so the order is stable between polls', () => {
    const at = '2026-10-28T10:01:00.000Z';
    const order = liveOffers(
      [offer({ attemptId: 'b', expiresAt: at }), offer({ attemptId: 'a', expiresAt: at })],
      NOW,
    ).map((o) => o.attemptId);
    expect(order).toEqual(['a', 'b']);
  });
});

describe('expectedFrames', () => {
  it('is the tier rate times the booked hours', () => {
    expect(expectedFrames('PROFESSIONAL', 2)).toBe(120);
    expect(expectedFrames('BASIC', 3)).toBe(120);
    expect(expectedFrames('SIGNATURE', 4)).toBe(320);
  });

  it('rounds a half-hour booking to a whole frame', () => {
    expect(expectedFrames('EXPERT', 2.5)).toBe(188);
  });
});

describe('distanceText', () => {
  it.each([
    [3.5, '3.5 km away'],
    [12, '12 km away'],
    [0.5, '0.5 km away'],
    [0, 'Under 0.5 km away'],
  ])('%s km → %s', (km, expected) => {
    expect(distanceText(km)).toBe(expected);
  });

  it('says so when the distance is not known', () => {
    expect(distanceText(null)).toBe('Distance not known');
  });
});

describe('areaText', () => {
  it('names the area and the city', () => {
    expect(areaText({ pincode: '395007', areaName: 'Vesu', cityName: 'Surat' })).toBe(
      'Vesu, Surat',
    );
  });

  it('falls back to the city', () => {
    expect(areaText({ pincode: '395007', areaName: null, cityName: 'Surat' })).toBe('Surat');
    expect(areaText({ pincode: '380001', areaName: 'Ahmedabad', cityName: 'Ahmedabad' })).toBe(
      'Ahmedabad',
    );
  });
});

describe('offerRequirements', () => {
  it('lists gear, dual cards, frames, category and the upload deadline for a dual-card tier', () => {
    const list = offerRequirements(offer(), 'Professional');
    expect(list.map((r) => r.kind)).toEqual(['gear', 'dualCard', 'frames', 'category', 'upload']);
    expect(list[0]).toEqual({
      kind: 'gear',
      title: 'Full-frame with lighting',
      detail: 'Professional tier',
    });
    expect(list[2]?.title).toBe('About 120 frames expected');
    expect(list[2]?.detail).toBe('60 an hour × 2 hours');
    expect(list[3]?.title).toBe('Food shoot');
    expect(list[4]?.title).toBe(
      `Upload RAW + JPEG within ${UPLOAD_WITHIN_HOURS} hours of check-out`,
    );
  });

  it('leaves out dual cards when the tier does not require them', () => {
    const list = offerRequirements(offer({ tier: 'SEMI_PRO', scheduledHours: 3 }), 'Semi-Pro');
    expect(list.map((r) => r.kind)).toEqual(['gear', 'frames', 'category', 'upload']);
    expect(list.find((r) => r.kind === 'frames')?.title).toBe('About 150 frames expected');
  });
});
