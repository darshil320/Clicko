/**
 * Launch ruleset 2026.10.01 — doc 05 §5 rate card + ADR-0005 festival calendar.
 * Single source for both the engine tests and the database seed, so the two
 * can never disagree.
 */
import type { CityTier, PlanTier } from '@clickco/contracts';
import { roundHalfUp } from '@clickco/utils';
import type { AddonRule, BaseRateRule, FestivalRule, Ruleset, TravelSlabRule } from './types';

export const LAUNCH_RULESET_VERSION = '2026.10.01';
/** Effective from 1 Oct 2026 so staff test bookings and pre-launch dry runs price against the launch card. */
export const LAUNCH_EFFECTIVE_FROM = '2026-10-01T00:00:00+05:30';

const CITY_TIERS: readonly CityTier[] = ['METRO', 'TIER_1', 'TIER_2', 'TIER_3'];
const rupees = (r: number): bigint => BigInt(r) * 100n;

/** Waiting time is 60% of the extension hourly (doc 05 §5). */
const WAITING_SHARE_BPS = 6000n;
const BPS = 10000n;

export const LAUNCH_GST_RATE_BPS = 1800;
export const LAUNCH_SAC_CODE = '998383';
export const LAUNCH_PRICES_INCLUDE_GST = false; // ADR-0005 OD-01

/** Rupees per hour by city tier [METRO, TIER_1, TIER_2, TIER_3] and payout share. */
const RATE_CARD: ReadonlyArray<readonly [PlanTier, readonly number[], number]> = [
  ['BASIC', [2000, 1750, 1500, 1350], 6200],
  ['SEMI_PRO', [3200, 2750, 2400, 2100], 6200],
  ['PROFESSIONAL', [5000, 4250, 3700, 3200], 6000],
  ['EXPERT', [8200, 7000, 6100, 5300], 5800],
];

export const CATEGORY_CATALOGUE = [
  { code: 'PORTRAIT', name: 'Portrait', upliftBps: 10000, certFrom: null, sort: 3 },
  { code: 'EVENT', name: 'Event', upliftBps: 10000, certFrom: null, sort: 5 },
  { code: 'FOOD', name: 'Food', upliftBps: 11500, certFrom: 'PROFESSIONAL', sort: 1 },
  { code: 'PRODUCT', name: 'Product', upliftBps: 11000, certFrom: 'PROFESSIONAL', sort: 4 },
  { code: 'REAL_ESTATE', name: 'Real Estate', upliftBps: 11000, certFrom: 'PROFESSIONAL', sort: 6 },
  { code: 'CORPORATE', name: 'Corporate', upliftBps: 12000, certFrom: 'PROFESSIONAL', sort: 7 },
  { code: 'WEDDING', name: 'Wedding', upliftBps: 12500, certFrom: 'SEMI_PRO', sort: 2 },
] as const satisfies ReadonlyArray<{
  code: string;
  name: string;
  upliftBps: number;
  certFrom: PlanTier | null;
  sort: number;
}>;

export const ADDON_CATALOGUE: readonly (AddonRule & {
  readonly pricePaise: bigint;
  readonly isPerHour: boolean;
  readonly payoutShareBps: number;
  readonly requiresDroneCredentials: boolean;
})[] = [
  {
    code: 'SECOND_SHOOTER',
    label: 'Second shooter',
    minTier: 'SEMI_PRO',
    requiresAirspaceCheck: false,
    requiresDroneCredentials: false,
    pricePaise: rupees(1500),
    isPerHour: true,
    payoutShareBps: 6200,
  },
  {
    code: 'DRONE',
    label: 'Drone coverage',
    minTier: 'PROFESSIONAL',
    requiresAirspaceCheck: true,
    requiresDroneCredentials: true,
    pricePaise: rupees(4500),
    isPerHour: false,
    payoutShareBps: 6000,
  },
  {
    code: 'LIGHTING_KIT',
    label: 'Lighting kit',
    minTier: 'SEMI_PRO',
    requiresAirspaceCheck: false,
    requiresDroneCredentials: false,
    pricePaise: rupees(1500),
    isPerHour: false,
    payoutShareBps: 6000,
  },
  {
    code: 'RUSH_24H',
    label: '24-hour delivery',
    minTier: 'PROFESSIONAL',
    requiresAirspaceCheck: false,
    requiresDroneCredentials: false,
    pricePaise: rupees(2500),
    isPerHour: false,
    payoutShareBps: 6000,
  },
];

export interface LaunchCityIds {
  readonly surat: string;
  readonly mumbai: string;
  readonly vadodara: string;
}

/** ADR-0005. Lunar dates are PROVISIONAL — verify against a panchang before publishing T&C. */
function festivals(c: LaunchCityIds): FestivalRule[] {
  const f = (
    label: string,
    dateFrom: string,
    dateTo: string,
    multiplierBps: number,
    isPeakSeason: boolean,
    cityIds: readonly (string | null)[] = [null],
  ): FestivalRule[] =>
    cityIds.map((cityId) => ({ label, dateFrom, dateTo, cityId, multiplierBps, isPeakSeason }));
  return [
    ...f('Wedding season 2026-27', '2026-11-01', '2027-02-28', 11500, true),
    ...f('Diwali week 2026', '2026-11-06', '2026-11-11', 12500, true),
    ...f('Christmas–New Year 2026-27', '2026-12-24', '2027-01-02', 12000, true),
    ...f('Valentine’s 2027', '2027-02-12', '2027-02-15', 11500, false),
    ...f('Ganesh Chaturthi 2027', '2027-09-04', '2027-09-14', 11500, false, [c.mumbai]),
    ...f('Navratri 2027', '2027-09-30', '2027-10-08', 12000, true, [c.surat, c.vadodara]),
    ...f('Diwali week 2027', '2027-10-26', '2027-10-31', 12500, true),
    ...f('Wedding season 2027-28', '2027-11-01', '2028-02-29', 11500, true),
    ...f('Christmas–New Year 2027-28', '2027-12-24', '2028-01-02', 12000, true),
    ...f('Valentine’s 2028', '2028-02-12', '2028-02-15', 11500, false),
  ];
}

function travelSlabs(): TravelSlabRule[] {
  return CITY_TIERS.flatMap((cityTier) => [
    {
      cityTier,
      zone: 0,
      fromMetres: 0,
      toMetres: 15_000,
      flatPaise: 0n,
      perKmPaise: 0n,
      overnightPaise: 0n,
    },
    {
      cityTier,
      zone: 1,
      fromMetres: 15_000,
      toMetres: 40_000,
      flatPaise: rupees(200),
      perKmPaise: rupees(18),
      overnightPaise: 0n,
    },
    {
      cityTier,
      zone: 2,
      fromMetres: 40_000,
      toMetres: null,
      flatPaise: rupees(800),
      perKmPaise: rupees(22),
      overnightPaise: rupees(1500),
    },
  ]);
}

function rateAt(tier: PlanTier, perCityTier: readonly number[], i: number): number {
  const rate = perCityTier[i];
  if (rate === undefined) throw new Error(`launch rate card: no ${tier} rate for city tier #${i}`);
  return rate;
}

function baseRates(): BaseRateRule[] {
  const priced = RATE_CARD.flatMap(([tier, perCityTier, payoutShareBps]) =>
    CITY_TIERS.map((cityTier, i) => ({
      tier,
      cityTier,
      ratePerHourPaise: rupees(rateAt(tier, perCityTier, i)),
      payoutShareBps,
      isQuoteOnly: false,
    })),
  );
  const signature = CITY_TIERS.map((cityTier) => ({
    tier: 'SIGNATURE' as const,
    cityTier,
    ratePerHourPaise: 0n,
    payoutShareBps: 5500,
    isQuoteOnly: true,
  }));
  return [...priced, ...signature];
}

export function launchRuleset(id: string, cityIds: LaunchCityIds): Ruleset {
  const rates = baseRates();
  return {
    id,
    version: LAUNCH_RULESET_VERSION,
    pricesIncludeGst: LAUNCH_PRICES_INCLUDE_GST,
    gstRateBps: LAUNCH_GST_RATE_BPS,
    sacCode: LAUNCH_SAC_CODE,
    baseRates: rates,
    categoryUplifts: CATEGORY_CATALOGUE.map((c) => ({
      categoryCode: c.code,
      tier: null,
      multiplierBps: c.upliftBps,
    })),
    // ADR-0012 D1: every band auto-cancels an unfilled booking 90 min before the start; SA-14 /
    // T&C §3.7: under 8 h is best effort, so HOURS_3_8 is not guaranteed.
    emergency: [
      {
        band: 'NONE',
        multiplierBps: 10000,
        captureOnAcceptOnly: false,
        isGuaranteed: true,
        autoRefundMinutesBefore: 90,
      },
      {
        band: 'NEXT_DAY',
        multiplierBps: 12000,
        captureOnAcceptOnly: false,
        isGuaranteed: true,
        autoRefundMinutesBefore: 90,
      },
      {
        band: 'SAME_DAY',
        multiplierBps: 14000,
        captureOnAcceptOnly: false,
        isGuaranteed: true,
        autoRefundMinutesBefore: 90,
      },
      {
        band: 'HOURS_3_8',
        multiplierBps: 18000,
        captureOnAcceptOnly: false,
        isGuaranteed: false,
        autoRefundMinutesBefore: 90,
      },
      {
        band: 'HOURS_UNDER_3',
        multiplierBps: 22000,
        captureOnAcceptOnly: true,
        isGuaranteed: false,
        autoRefundMinutesBefore: 90,
      },
    ],
    night: { windowStartMinute: 22 * 60, windowEndMinute: 6 * 60, multiplierBps: 12500 },
    weekend: { isoDays: [6, 7], multiplierBps: 11000 },
    festivals: festivals(cityIds),
    travelSlabs: travelSlabs(),
    addons: ADDON_CATALOGUE.map(({ code, label, minTier, requiresAirspaceCheck }) => ({
      code,
      label,
      minTier,
      requiresAirspaceCheck,
    })),
    addonPrices: ADDON_CATALOGUE.map((a) => ({
      addonCode: a.code,
      tier: null,
      cityTier: null,
      amountPaise: a.pricePaise,
      isPerHour: a.isPerHour,
      payoutShareBps: a.payoutShareBps,
    })),
    extensionRates: rates
      .filter((r) => !r.isQuoteOnly)
      .map((r) => ({
        tier: r.tier,
        cityTier: r.cityTier,
        hourlyPaise: r.ratePerHourPaise,
        waitingGraceMinutes: 15,
        waitingHourlyPaise: roundHalfUp(r.ratePerHourPaise * WAITING_SHARE_BPS, BPS),
      })),
    deliverables: [
      { tier: 'BASIC', minHalfHours: 4, isInstantBookable: true },
      { tier: 'SEMI_PRO', minHalfHours: 4, isInstantBookable: true },
      { tier: 'PROFESSIONAL', minHalfHours: 4, isInstantBookable: true },
      { tier: 'EXPERT', minHalfHours: 4, isInstantBookable: true },
      { tier: 'SIGNATURE', minHalfHours: 8, isInstantBookable: false }, // v0.2 §10: minimum 4 hours
    ],
  };
}
