import { CreateBookingBody, QuoteRequestBody } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  addonProbeRequest,
  CheckoutForm,
  createBookingBody,
  newDraft,
  quoteRequest,
  referenceRequest,
  toggleAddon,
  VenueForm,
  withTier,
} from './draft';
import { canDecrease, canIncrease, MAX_HOURS, MIN_HOURS, stepHours } from './duration';

const slot = { dateKey: '2026-11-14', startMinute: 990 };
const base = newDraft({ tier: 'PROFESSIONAL', pincode: '395007', slot, categoryCode: 'FOOD' });

describe('newDraft', () => {
  it('starts at the 2-hour minimum with no add-ons and the Portrait default category', () => {
    const draft = newDraft({ tier: 'BASIC', pincode: '395007', slot });
    expect(draft).toMatchObject({
      hours: 2,
      addons: [],
      categoryCode: 'PORTRAIT',
      startMinute: 990,
    });
  });
});

describe('draft → quote request', () => {
  it('sends the start as IST wall-clock with an explicit offset', () => {
    const request = quoteRequest({ ...base, addons: ['DRONE'] });
    expect(request).toEqual({
      tier: 'PROFESSIONAL',
      categoryCode: 'FOOD',
      pincode: '395007',
      scheduledStart: '2026-11-14T16:30:00+05:30',
      hours: 2,
      addons: [{ code: 'DRONE', quantity: 1 }],
    });
    expect(QuoteRequestBody.safeParse(request).success).toBe(true);
  });

  it('probes every add-on the tier is eligible for', () => {
    expect(addonProbeRequest(base).addons?.map((a) => a.code)).toEqual([
      'SECOND_SHOOTER',
      'DRONE',
      'LIGHTING_KIT',
      'RUSH_24H',
    ]);
    expect(addonProbeRequest(withTier(base, 'SEMI_PRO')).addons?.map((a) => a.code)).toEqual([
      'SECOND_SHOOTER',
      'LIGHTING_KIT',
    ]);
    expect(addonProbeRequest(withTier(base, 'BASIC')).addons).toEqual([]);
  });

  it('prices "from" as the uplift-free Portrait category for 2 hours', () => {
    const request = referenceRequest('EXPERT', '400050', {
      dateKey: '2026-11-13',
      startMinute: 660,
    });
    expect(request).toMatchObject({
      tier: 'EXPERT',
      categoryCode: 'PORTRAIT',
      hours: 2,
      addons: [],
    });
    expect(request.scheduledStart).toBe('2026-11-13T11:00:00+05:30');
  });
});

describe('editing a draft never mutates it', () => {
  it('toggles an add-on on and off', () => {
    const on = toggleAddon(base, 'LIGHTING_KIT');
    expect(on.addons).toEqual(['LIGHTING_KIT']);
    expect(base.addons).toEqual([]);
    expect(toggleAddon(on, 'LIGHTING_KIT').addons).toEqual([]);
  });

  it('drops add-ons the new tier cannot take', () => {
    const loaded = { ...base, addons: ['DRONE', 'LIGHTING_KIT', 'SECOND_SHOOTER'] as const };
    expect(withTier({ ...loaded, addons: [...loaded.addons] }, 'SEMI_PRO').addons).toEqual([
      'LIGHTING_KIT',
      'SECOND_SHOOTER',
    ]);
    expect(withTier({ ...loaded, addons: [...loaded.addons] }, 'BASIC').addons).toEqual([]);
  });
});

describe('duration stepper', () => {
  it('steps by half an hour between 2 and 12 hours', () => {
    expect(stepHours(2, 1)).toBe(2.5);
    expect(stepHours(2, -1)).toBe(MIN_HOURS);
    expect(stepHours(MAX_HOURS, 1)).toBe(MAX_HOURS);
    expect(canDecrease(2)).toBe(false);
    expect(canDecrease(2.5)).toBe(true);
    expect(canIncrease(MAX_HOURS)).toBe(false);
  });
});

describe('draft → CreateBookingBody', () => {
  const draft = {
    ...base,
    addons: ['DRONE' as const],
    venueAddress: '  14, Rajhans Platinum, Vesu, Surat ',
    venueLandmark: ' ',
  };

  it('builds a body the contract accepts, with consent exactly as given', () => {
    const body = createBookingBody(
      draft,
      { name: ' Priya Sharma ', phone: '+919800000777' },
      { modelReleaseConsent: false, termsVersion: 'v2-draft' },
    );
    expect(body).toMatchObject({
      tier: 'PROFESSIONAL',
      categoryCode: 'FOOD',
      scheduledStart: '2026-11-14T16:30:00+05:30',
      venueAddress: '14, Rajhans Platinum, Vesu, Surat',
      booker: { name: 'Priya Sharma', phone: '+919800000777' },
      galleryRecipient: 'BOOKER',
      modelReleaseConsent: false,
      acceptedTermsVersion: 'v2-draft',
    });
    expect('venueLandmark' in body).toBe(false);
    expect(CreateBookingBody.safeParse(body).success).toBe(true);
  });

  it('never sends a price — the server re-prices', () => {
    const body = createBookingBody(
      { ...draft, venueLandmark: 'Opposite VR Mall' },
      { name: 'Rahul Mehta', phone: '+919812345678' },
      { modelReleaseConsent: true, termsVersion: 'v2-draft' },
    );
    expect(body.venueLandmark).toBe('Opposite VR Mall');
    expect(Object.keys(body).some((k) => /paise|total|amount|price/i.test(k))).toBe(false);
  });
});

describe('forms', () => {
  it('requires a real venue address', () => {
    expect(VenueForm.safeParse({ venueAddress: 'Vesu', venueLandmark: '' }).success).toBe(false);
    expect(
      VenueForm.safeParse({ venueAddress: '14, Rajhans Platinum, Vesu', venueLandmark: '' })
        .success,
    ).toBe(true);
  });

  it('requires the terms but leaves the model release optional', () => {
    const ok = { bookerName: 'Ananya Iyer', acceptTerms: true, modelReleaseConsent: false };
    expect(CheckoutForm.safeParse(ok).success).toBe(true);
    expect(CheckoutForm.safeParse({ ...ok, acceptTerms: false }).success).toBe(false);
    expect(CheckoutForm.safeParse({ ...ok, bookerName: '  ' }).success).toBe(false);
  });
});
