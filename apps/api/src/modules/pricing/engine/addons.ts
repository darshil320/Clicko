/** doc 05 §3 step 10 (addons). Never multiplied by uplift, surge, emergency, night or weekend. */
import type { CityTier, PlanTier } from '@clickco/contracts';
import { roundHalfUp } from '@clickco/utils';
import { HALF_HOURS_PER_HOUR } from './constants';
import { collect, type Outcome, ok, reject } from './outcome';
import { type AddonPriceRule, type Ruleset, TIER_ORDER } from './types';

export interface PricedAddon {
  readonly code: string;
  readonly label: string;
  readonly quantity: number;
  readonly unitPaise: bigint;
  readonly isPerHour: boolean;
  readonly amountPaise: bigint;
  readonly requiresAirspaceCheck: boolean;
}

export interface PricedAddons {
  readonly items: readonly PricedAddon[];
  readonly totalPaise: bigint;
  readonly airspaceCheckRequired: boolean;
}

interface AddonContext {
  readonly ruleset: Ruleset;
  readonly tier: PlanTier;
  readonly cityTier: CityTier;
  readonly halfHours: bigint;
}

type AddonRequest = { readonly code: string; readonly quantity: number };

const tierRank = (tier: PlanTier): number => TIER_ORDER.indexOf(tier);

/** Most specific wins: (tier, cityTier) → (tier, null) → (null, null). */
function findPrice(
  prices: readonly AddonPriceRule[],
  code: string,
  tier: PlanTier,
  cityTier: CityTier,
): AddonPriceRule | undefined {
  const forAddon = prices.filter((p) => p.addonCode === code);
  return (
    forAddon.find((p) => p.tier === tier && p.cityTier === cityTier) ??
    forAddon.find((p) => p.tier === tier && p.cityTier === null) ??
    forAddon.find((p) => p.tier === null && p.cityTier === null)
  );
}

function priceAddon(item: AddonRequest, ctx: AddonContext): Outcome<PricedAddon> {
  const rule = ctx.ruleset.addons.find((a) => a.code === item.code);
  if (rule === undefined) {
    return reject('ADDON_NOT_PRICED', `Add-on ${item.code} is not offered by this ruleset`);
  }
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
    return reject(
      'INVALID_ADDON_QUANTITY',
      `Add-on ${item.code} quantity must be a whole number ≥ 1`,
    );
  }
  if (rule.minTier !== null && tierRank(ctx.tier) < tierRank(rule.minTier)) {
    return reject('ADDON_TIER_INELIGIBLE', `Add-on ${item.code} requires ${rule.minTier} or above`);
  }
  const price = findPrice(ctx.ruleset.addonPrices, item.code, ctx.tier, ctx.cityTier);
  if (price === undefined) {
    return reject('ADDON_NOT_PRICED', `Add-on ${item.code} has no price for ${ctx.tier}`);
  }
  const quantity = BigInt(item.quantity);
  const amountPaise = price.isPerHour
    ? roundHalfUp(price.amountPaise * ctx.halfHours * quantity, HALF_HOURS_PER_HOUR)
    : price.amountPaise * quantity;
  return ok({
    code: rule.code,
    label: rule.label,
    quantity: item.quantity,
    unitPaise: price.amountPaise,
    isPerHour: price.isPerHour,
    amountPaise,
    requiresAirspaceCheck: rule.requiresAirspaceCheck,
  });
}

/** Rejects on the first invalid addon, in request order. Airspace checks flag, never block. */
export function priceAddons(
  requested: readonly AddonRequest[],
  ctx: AddonContext,
): Outcome<PricedAddons> {
  const priced = collect(requested.map((item) => priceAddon(item, ctx)));
  if (!priced.ok) return priced;
  const items = priced.value;
  return ok({
    items,
    totalPaise: items.reduce((sum, a) => sum + a.amountPaise, 0n),
    airspaceCheckRequired: items.some((a) => a.requiresAirspaceCheck),
  });
}
