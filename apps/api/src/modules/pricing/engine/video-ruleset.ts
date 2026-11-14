/**
 * Ruleset 2026.11.14 — the owner's videography rate card (ADR-0034), layered on the launch card.
 * Single source for the engine tests and the seed: the seed copies whatever ruleset is current
 * and applies exactly these rows, so a photography rate published in the editor is never undone.
 *
 * All prices GST-exclusive (OD-01), integer paise.
 *   VIDEOGRAPHER  per hour, by the booking's tier. "Basic / Advanced / Professional" map to
 *                 BASIC / SEMI_PRO / PROFESSIONAL; EXPERT takes the top (Professional) rate.
 *                 One rate in every city tier.
 *   REELS         ₹3,000 per reel; from 5 reels, ₹2,000 per reel for all of them. Needs video.
 *   RAW_FOOTAGE   ₹1,000 per booking, not per hour. Needs video.
 */
import type { PlanTier } from '@clickco/contracts';
import { ADDON_CATALOGUE, type LaunchCityIds, launchRuleset, toAddonRule } from './launch-ruleset';
import type { AddonPriceRule, AddonRule, Ruleset } from './types';

export const VIDEO_RULESET_VERSION = '2026.11.14';
/** The day the owner sent the card. Closes 2026.10.01 at this instant, as a publish would. */
export const VIDEO_EFFECTIVE_FROM = '2026-11-14T00:00:00+05:30';
export const VIDEO_RULESET_LABEL = 'Videography rate card (ADR-0034)';

const rupees = (r: number): bigint => BigInt(r) * 100n;

/** Most reels one booking may order (ADR-0034, owner-overridable). */
export const MAX_REELS = 20;
/** The quantity from which every reel is priced at the bulk rate. */
export const REELS_BULK_FROM = 5;

/** Payout shares recorded on the rows. The v1 engine pays the tier share on all add-ons (step 12). */
const VIDEO_PAYOUT_BPS = 6200;
const DELIVERABLE_PAYOUT_BPS = 6000;

/** New catalogue rows, appended after ADDON_CATALOGUE so earlier sort orders never move. */
export const VIDEO_ADDON_CATALOGUE: readonly (AddonRule & {
  readonly requiresDroneCredentials: boolean;
})[] = [
  {
    code: 'REELS',
    label: 'Reels',
    minTier: 'BASIC',
    requiresAirspaceCheck: false,
    requiresDroneCredentials: false,
    maxQuantity: MAX_REELS,
    requiresAddonCode: 'VIDEOGRAPHER',
  },
  {
    code: 'RAW_FOOTAGE',
    label: 'Raw footage',
    minTier: 'BASIC',
    requiresAirspaceCheck: false,
    requiresDroneCredentials: false,
    maxQuantity: 1,
    requiresAddonCode: 'VIDEOGRAPHER',
  },
];

/** Rupees per hour of video, by the booking's tier. */
const VIDEO_HOURLY: ReadonlyArray<readonly [PlanTier, number]> = [
  ['BASIC', 2000],
  ['SEMI_PRO', 3000],
  ['PROFESSIONAL', 5000],
  ['EXPERT', 5000],
];

const row = (
  addonCode: string,
  tier: PlanTier | null,
  minQuantity: number,
  amountPaise: bigint,
  isPerHour: boolean,
  payoutShareBps: number,
): AddonPriceRule => ({
  addonCode,
  tier,
  cityTier: null,
  minQuantity,
  amountPaise,
  isPerHour,
  payoutShareBps,
});

/** Every addon_prices row the video card writes. They replace any earlier row for these codes. */
export const VIDEO_ADDON_PRICES: readonly AddonPriceRule[] = [
  ...VIDEO_HOURLY.map(([tier, perHour]) =>
    row('VIDEOGRAPHER', tier, 1, rupees(perHour), true, VIDEO_PAYOUT_BPS),
  ),
  row('REELS', null, 1, rupees(3000), false, DELIVERABLE_PAYOUT_BPS),
  row('REELS', null, REELS_BULK_FROM, rupees(2000), false, DELIVERABLE_PAYOUT_BPS),
  row('RAW_FOOTAGE', null, 1, rupees(1000), false, DELIVERABLE_PAYOUT_BPS),
];

export const VIDEO_PRICED_CODES: readonly string[] = [
  ...new Set(VIDEO_ADDON_PRICES.map((p) => p.addonCode)),
];

/** Applies the video card to a ruleset: new catalogue rules, and its rows replace these codes'. */
export function withVideoRateCard(base: Ruleset, id: string, version: string): Ruleset {
  const known = new Set(base.addons.map((a) => a.code));
  return {
    ...base,
    id,
    version,
    addons: [
      ...base.addons,
      ...VIDEO_ADDON_CATALOGUE.filter((a) => !known.has(a.code)).map(toAddonRule),
    ],
    addonPrices: [
      ...base.addonPrices.filter((p) => !VIDEO_PRICED_CODES.includes(p.addonCode)),
      ...VIDEO_ADDON_PRICES,
    ],
  };
}

export function videoRuleset(id: string, cityIds: LaunchCityIds): Ruleset {
  return withVideoRateCard(launchRuleset(id, cityIds), id, VIDEO_RULESET_VERSION);
}

/** Every catalogue row, in sort order: the launch add-ons, then the video ones. */
export const FULL_ADDON_CATALOGUE = [...ADDON_CATALOGUE, ...VIDEO_ADDON_CATALOGUE];
