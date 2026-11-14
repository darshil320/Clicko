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

/** One item's view of the whole request: which codes it holds, and whether this code repeats. */
interface RequestFacts {
  readonly codes: ReadonlySet<string>;
  readonly duplicates: ReadonlySet<string>;
}

type AddonRequest = { readonly code: string; readonly quantity: number };

const tierRank = (tier: PlanTier): number => TIER_ORDER.indexOf(tier);

/** The highest quantity break this many units reach; its unit price covers every unit. */
function bestBreak(rows: readonly AddonPriceRule[], quantity: number): AddonPriceRule | undefined {
  return rows
    .filter((p) => p.minQuantity <= quantity)
    .reduce<AddonPriceRule | undefined>(
      (best, p) => (best === undefined || p.minQuantity > best.minQuantity ? p : best),
      undefined,
    );
}

/**
 * Most specific scope wins: (tier, cityTier) → (tier, null) → (null, null) (doc 05 step 10).
 * Within the first scope that prices this quantity, the highest quantity break applies
 * (ADR-0034: 5+ reels are ₹2,000 each, for all of them).
 */
function findPrice(
  prices: readonly AddonPriceRule[],
  code: string,
  tier: PlanTier,
  cityTier: CityTier,
  quantity: number,
): AddonPriceRule | undefined {
  const forAddon = prices.filter((p) => p.addonCode === code);
  const scopes = [
    forAddon.filter((p) => p.tier === tier && p.cityTier === cityTier),
    forAddon.filter((p) => p.tier === tier && p.cityTier === null),
    forAddon.filter((p) => p.tier === null && p.cityTier === null),
  ];
  return scopes.map((rows) => bestBreak(rows, quantity)).find((p) => p !== undefined);
}

function priceAddon(
  item: AddonRequest,
  ctx: AddonContext,
  facts: RequestFacts,
): Outcome<PricedAddon> {
  const rule = ctx.ruleset.addons.find((a) => a.code === item.code);
  if (rule === undefined) {
    return reject('ADDON_NOT_PRICED', `Add-on ${item.code} is not offered by this ruleset`);
  }
  if (
    !Number.isSafeInteger(item.quantity) ||
    item.quantity < 1 ||
    item.quantity > rule.maxQuantity
  ) {
    return reject(
      'INVALID_ADDON_QUANTITY',
      `Add-on ${item.code} quantity must be a whole number from 1 to ${rule.maxQuantity}`,
    );
  }
  if (facts.duplicates.has(item.code)) {
    return reject('DUPLICATE_ADDON', `Add-on ${item.code} appears more than once`);
  }
  if (rule.minTier !== null && tierRank(ctx.tier) < tierRank(rule.minTier)) {
    return reject('ADDON_TIER_INELIGIBLE', `Add-on ${item.code} requires ${rule.minTier} or above`);
  }
  if (rule.requiresAddonCode !== null && !facts.codes.has(rule.requiresAddonCode)) {
    return reject(
      'ADDON_REQUIRES_ADDON',
      `Add-on ${item.code} can only be booked with ${rule.requiresAddonCode}`,
    );
  }
  const price = findPrice(
    ctx.ruleset.addonPrices,
    item.code,
    ctx.tier,
    ctx.cityTier,
    item.quantity,
  );
  if (price === undefined) {
    return reject(
      'ADDON_NOT_PRICED',
      `Add-on ${item.code} has no price for ${ctx.tier} at quantity ${item.quantity}`,
    );
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

function requestFacts(requested: readonly AddonRequest[]): RequestFacts {
  const codes = requested.map((item) => item.code);
  return {
    codes: new Set(codes),
    duplicates: new Set(codes.filter((code, i) => codes.indexOf(code) !== i)),
  };
}

/**
 * Rejects on the first invalid addon, in request order: a repeated code, a tier below the add-on's,
 * a missing parent (reels without video), a bad quantity or no price. Airspace checks flag only.
 */
export function priceAddons(
  requested: readonly AddonRequest[],
  ctx: AddonContext,
): Outcome<PricedAddons> {
  const facts = requestFacts(requested);
  const priced = collect(requested.map((item) => priceAddon(item, ctx, facts)));
  if (!priced.ok) return priced;
  const items = priced.value;
  return ok({
    items,
    totalPaise: items.reduce((sum, a) => sum + a.amountPaise, 0n),
    airspaceCheckRequired: items.some((a) => a.requiresAirspaceCheck),
  });
}
