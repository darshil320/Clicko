import { CreateBookingBody, QuoteRequestBody } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { addonsUnder, REELS_MAX, topLevelAddons } from '@/shared/catalogue';
import {
  addonProbeRequest,
  createBookingBody,
  newDraft,
  quoteRequest,
  setReels,
  toggleAddon,
  upgradeDraft,
  withTier,
} from './draft';

/** ADR-0034: video is a videographer per hour, plus reels (a count) and raw footage (on/off). */
const slot = { dateKey: '2026-11-17', startMinute: 720 };
const basic = newDraft({ tier: 'BASIC', pincode: '395007', slot });
const withVideo = toggleAddon(basic, 'VIDEOGRAPHER');

describe('video in the catalogue', () => {
  it('offers the videographer on every bookable tier, Basic included', () => {
    expect(topLevelAddons('BASIC').map((a) => a.code)).toEqual(['VIDEOGRAPHER']);
    expect(topLevelAddons('SEMI_PRO').map((a) => a.code)).toContain('VIDEOGRAPHER');
  });

  it('lists reels and raw footage under the videographer, not as add-ons of their own', () => {
    expect(topLevelAddons('EXPERT').map((a) => a.code)).not.toContain('REELS');
    expect(addonsUnder('BASIC', 'VIDEOGRAPHER').map((a) => a.code)).toEqual([
      'REELS',
      'RAW_FOOTAGE',
    ]);
    expect(addonsUnder('BASIC', 'DRONE')).toEqual([]);
  });

  it('caps reels at 20, the server’s limit', () => {
    expect(REELS_MAX).toBe(20);
  });
});

describe('a new draft', () => {
  it('starts with no video and no reels', () => {
    expect(basic).toMatchObject({ addons: [], reels: 0 });
  });
});

describe('reels', () => {
  it('cannot be added without the videographer', () => {
    expect(setReels(basic, 3).reels).toBe(0);
  });

  it('counts within 0…20 and never mutates the draft', () => {
    const three = setReels(withVideo, 3);
    expect(three.reels).toBe(3);
    expect(withVideo.reels).toBe(0);
    expect(setReels(withVideo, 25).reels).toBe(REELS_MAX);
    expect(setReels(three, -1).reels).toBe(0);
    expect(setReels(withVideo, 2.5).reels).toBe(2);
  });

  it('are sent as one REELS line with the count as its quantity', () => {
    const request = quoteRequest(setReels(withVideo, 5));
    expect(request.addons).toEqual([
      { code: 'VIDEOGRAPHER', quantity: 1 },
      { code: 'REELS', quantity: 5 },
    ]);
    expect(QuoteRequestBody.safeParse(request).success).toBe(true);
  });

  it('send no REELS line at zero', () => {
    expect(quoteRequest(withVideo).addons).toEqual([{ code: 'VIDEOGRAPHER', quantity: 1 }]);
  });
});

describe('raw footage', () => {
  it('cannot be switched on without the videographer', () => {
    expect(toggleAddon(basic, 'RAW_FOOTAGE').addons).toEqual([]);
  });

  it('switches on and off under the videographer, once per booking', () => {
    const on = toggleAddon(withVideo, 'RAW_FOOTAGE');
    expect(quoteRequest(on).addons).toEqual([
      { code: 'VIDEOGRAPHER', quantity: 1 },
      { code: 'RAW_FOOTAGE', quantity: 1 },
    ]);
    expect(toggleAddon(on, 'RAW_FOOTAGE').addons).toEqual(['VIDEOGRAPHER']);
  });
});

describe('switching the videographer off', () => {
  it('drops raw footage and the reels with it', () => {
    const full = toggleAddon(setReels(withVideo, 5), 'RAW_FOOTAGE');

    const off = toggleAddon(full, 'VIDEOGRAPHER');

    expect(off).toMatchObject({ addons: [], reels: 0 });
    expect(quoteRequest(off).addons).toEqual([]);
  });
});

describe('changing tier keeps video, which every tier can take', () => {
  it('keeps the videographer, reels and raw footage from Expert down to Basic', () => {
    const expert = withTier(toggleAddon(setReels(withVideo, 7), 'RAW_FOOTAGE'), 'EXPERT');

    const back = withTier(expert, 'BASIC');

    expect(back).toMatchObject({ addons: ['VIDEOGRAPHER', 'RAW_FOOTAGE'], reels: 7 });
  });
});

describe('the add-on price probe', () => {
  it('asks for one reel when none is picked, to show the price of a reel', () => {
    const reels = addonProbeRequest(basic).addons?.find((a) => a.code === 'REELS');
    expect(reels).toEqual({ code: 'REELS', quantity: 1 });
  });

  it('asks for the picked count, so the server prices the 5-or-more rate', () => {
    const reels = addonProbeRequest(setReels(withVideo, 6)).addons?.find((a) => a.code === 'REELS');
    expect(reels).toEqual({ code: 'REELS', quantity: 6 });
  });

  it('always includes the videographer the reels and raw footage need', () => {
    expect(addonProbeRequest(basic).addons?.map((a) => a.code)).toEqual([
      'VIDEOGRAPHER',
      'REELS',
      'RAW_FOOTAGE',
    ]);
  });
});

describe('the booking body', () => {
  it('carries the video lines and passes the contract', () => {
    const draft = {
      ...toggleAddon(setReels(withVideo, 5), 'RAW_FOOTAGE'),
      venueAddress: '12 Ghod Dod Road, Surat',
    };
    const body = createBookingBody(
      draft,
      { name: 'Ananya Iyer', phone: '+919999552211' },
      { modelReleaseConsent: false, termsVersion: '2.0' },
    );
    expect(body.addons).toEqual([
      { code: 'VIDEOGRAPHER', quantity: 1 },
      { code: 'RAW_FOOTAGE', quantity: 1 },
      { code: 'REELS', quantity: 5 },
    ]);
    expect(CreateBookingBody.safeParse(body).success).toBe(true);
  });
});

describe('a draft saved before reels existed (store v1)', () => {
  it('resumes with no reels, without touching the saved object', () => {
    const { reels: _dropped, ...saved } = withVideo;

    const upgraded = upgradeDraft(saved, 1);

    expect(upgraded).toEqual({ ...saved, reels: 0 });
    expect('reels' in saved).toBe(false);
    expect(upgradeDraft(null, 1)).toBeNull();
    expect(upgradeDraft(setReels(withVideo, 3), 2)?.reels).toBe(3);
  });
});
