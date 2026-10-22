import { type QuoteRequest, QuoteResponse } from '@clickco/contracts';
import { HttpException, Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServiceabilityService } from '../../serviceability/serviceability.service';
import { launchRuleset } from '../engine/launch-ruleset';
import type { Ruleset } from '../engine/types';
import { PricingService } from '../pricing.service';
import type { PricingRepository, PromoRecord } from '../repositories/pricing.repository';

const NOW = new Date('2026-11-10T06:30:00.000Z'); // 12:00 IST
const CITY = { surat: 'c-surat', mumbai: 'c-mumbai', vadodara: 'c-vadodara' };
const RULESET = launchRuleset('rs-1', CITY);

const VENUES = {
  '395007': {
    pincode: '395007',
    cityId: CITY.surat,
    cityTier: 'TIER_1',
    state: 'Gujarat',
    travelZone: 0,
  },
  '400050': {
    pincode: '400050',
    cityId: CITY.mumbai,
    cityTier: 'METRO',
    state: 'Maharashtra',
    travelZone: 0,
  },
} as const;

function service(opts: { ruleset?: Ruleset | null; promo?: PromoRecord | null } = {}) {
  const repo = {
    loadCurrent: async () => (opts.ruleset === undefined ? RULESET : opts.ruleset),
    findPromo: async () => opts.promo ?? null,
  } as unknown as PricingRepository;
  const serviceability = {
    resolveVenue: async (pincode: keyof typeof VENUES) => VENUES[pincode],
  } as unknown as ServiceabilityService;
  return new PricingService(repo, serviceability, () => NOW);
}

const request: QuoteRequest = {
  tier: 'PROFESSIONAL',
  categoryCode: 'FOOD',
  pincode: '395007',
  scheduledStart: '2026-11-17T09:30:00.000Z',
  hours: 2,
  addons: [],
};

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
  return 200;
};

describe('PricingService', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('returns a quote that satisfies the shared QuoteResponse contract', async () => {
    const quote = await service().quote(request);
    expect(QuoteResponse.safeParse(quote).success).toBe(true);
    expect(quote).toMatchObject({ kind: 'QUOTE', tier: 'PROFESSIONAL', isPeakSeason: true });
  });

  it('charges IGST for a venue outside Gujarat', async () => {
    const quote = await service().quote({ ...request, pincode: '400050' });
    expect(quote.kind === 'QUOTE' && quote.gst.igstPaise > 0 && quote.gst.cgstPaise === 0).toBe(
      true,
    );
    expect(quote.kind === 'QUOTE' && quote.gst.placeOfSupply).toBe('27');
  });

  it('converts km to metres for travel', async () => {
    const quote = await service().quote({ ...request, travelDistanceKm: 18 });
    expect(
      quote.kind === 'QUOTE' && quote.lines.find((l) => l.code === 'TRAVEL')?.amountPaise,
    ).toBe(25400);
  });

  it('answers QUOTE_ONLY for Signature', async () => {
    expect(await service().quote({ ...request, tier: 'SIGNATURE', hours: 4 })).toMatchObject({
      kind: 'QUOTE_ONLY',
    });
  });

  it('maps engine rejections to 422', async () => {
    expect(await statusOf(service().quote({ ...request, categoryCode: 'UNDERWATER' }))).toBe(422);
  });

  it('fails loudly (500) when no ruleset is effective — never a default price', async () => {
    expect(await statusOf(service({ ruleset: null }).quote(request))).toBe(500);
  });

  it('rejects an unknown promo code', async () => {
    expect(await statusOf(service().quote({ ...request, promoCode: 'NOPE' }))).toBe(422);
  });

  it('applies a valid promo as a first-time user', async () => {
    const promo: PromoRecord = {
      code: 'FIRST200',
      discountBps: null,
      discountFlatPaise: 20000n,
      maxDiscountPaise: null,
      minBookingPaise: 0n,
      appliesToTiers: null,
      appliesToCityIds: null,
      firstBookingOnly: true,
      perUserCap: 1,
      validFrom: new Date('2026-10-01T00:00:00Z'),
      validTo: new Date('2027-01-01T00:00:00Z'),
      isActive: true,
    };
    const quote = await service({ promo }).quote({ ...request, promoCode: 'FIRST200' });
    expect(quote.kind === 'QUOTE' && quote.discountPaise).toBe(20000);
  });
});
