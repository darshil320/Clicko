/**
 * doc 05 §3 — the pricing pipeline. Pure: no clock, no I/O, bigint paise and integer bps only.
 * Rounding happens once per line item (base, each addon, travel, discount, GST).
 */
import type { CityTier, PlanTier } from '@clickco/contracts';
import { roundHalfUp } from '@clickco/utils';
import { type PricedAddons, priceAddons } from './addons';
import { BPS_SCALE, HALF_HOURS_PER_HOUR, QUOTE_TTL_MS } from './constants';
import { resolveUpliftBps } from './factors';
import { applyGst, splitAdvance } from './gst';
import { buildLines } from './lines';
import { type Outcome, ok } from './outcome';
import { resolveDiscount } from './promo';
import {
  type ResolvedFactors,
  type ResolvedInputs,
  resolveFactors,
  resolveInputs,
} from './resolve';
import { type PricedTravel, priceTravel } from './travel';
import type {
  ExtensionPrice,
  PricingRequest,
  PricingResult,
  Quote,
  QuoteLine,
  Ruleset,
} from './types';

export { resolveEmergencyBand } from './factors';

interface Components {
  readonly baseAmountPaise: bigint;
  readonly addons: PricedAddons;
  readonly travel: PricedTravel;
  readonly subtotalPaise: bigint;
  readonly discountPaise: bigint;
}

function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`computeQuote: ${name} must be a valid Date`);
  }
}

/** The single place multipliers compose: one expression, one rounding (doc 05 §3 step 9). */
function computeBaseAmount(inputs: ResolvedInputs, factors: Quote['factors']): bigint {
  const numerator =
    inputs.baseRate.ratePerHourPaise *
    inputs.halfHours *
    BigInt(factors.categoryUpliftBps) *
    BigInt(factors.emergencyBps) *
    BigInt(factors.surgeBps) *
    BigInt(factors.nightBps) *
    BigInt(factors.weekendBps);
  return roundHalfUp(numerator, HALF_HOURS_PER_HOUR * BPS_SCALE ** 5n);
}

function toFactorBps(inputs: ResolvedInputs, resolved: ResolvedFactors): Quote['factors'] {
  return {
    categoryUpliftBps: inputs.upliftBps,
    emergencyBps: resolved.emergency.multiplierBps,
    surgeBps: resolved.surge.surgeBps,
    nightBps: resolved.nightBps,
    weekendBps: resolved.weekendBps,
  };
}

/** Steps 9–11: base, addons, travel, subtotal and discount. */
function priceComponents(
  request: PricingRequest,
  ruleset: Ruleset,
  inputs: ResolvedInputs,
  factors: Quote['factors'],
): Outcome<Components> {
  const { tier, venue } = request;
  const addonContext = { ruleset, tier, cityTier: venue.cityTier, halfHours: inputs.halfHours };
  const addons = priceAddons(request.addons, addonContext);
  if (!addons.ok) return addons;
  const travel = priceTravel(ruleset, venue, request.travelDistanceMetres);
  if (!travel.ok) return travel;
  const baseAmountPaise = computeBaseAmount(inputs, factors);
  const subtotalPaise = baseAmountPaise + addons.value.totalPaise + travel.value.amountPaise;
  const discount = resolveDiscount(request.promo, {
    tier,
    cityId: venue.cityId,
    now: request.now,
    subtotalPaise,
  });
  if (!discount.ok) return discount;
  return ok({
    baseAmountPaise,
    addons: addons.value,
    travel: travel.value,
    subtotalPaise,
    discountPaise: discount.value,
  });
}

/** Step 12: travel is reimbursement and passes through at 100%; the share applies to the rest. */
function expectedPayout(c: Components, payoutShareBps: number): bigint {
  const shared = c.baseAmountPaise + c.addons.totalPaise;
  return roundHalfUp(shared * BigInt(payoutShareBps), BPS_SCALE) + c.travel.amountPaise;
}

function quoteLines(
  request: PricingRequest,
  inputs: ResolvedInputs,
  resolved: ResolvedFactors,
  c: Components,
  factors: Quote['factors'],
): readonly QuoteLine[] {
  return buildLines({
    tier: request.tier,
    categoryCode: request.categoryCode,
    hours: request.hours,
    baseRatePerHourPaise: inputs.baseRate.ratePerHourPaise,
    baseAmountPaise: c.baseAmountPaise,
    factors,
    emergencyBand: resolved.band,
    surgeLabel: resolved.surge.label,
    addons: c.addons.items,
    travel: c.travel,
    discountPaise: c.discountPaise,
    promoCode: request.promo?.code ?? null,
  });
}

function assembleQuote(
  request: PricingRequest,
  ruleset: Ruleset,
  inputs: ResolvedInputs,
  resolved: ResolvedFactors,
  c: Components,
): Quote {
  const factors = toFactorBps(inputs, resolved);
  const taxed = applyGst(c.subtotalPaise - c.discountPaise, ruleset, request.venue);
  const nowMs = request.now.getTime();
  return {
    kind: 'QUOTE',
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.version,
    tier: request.tier,
    cityTier: request.venue.cityTier,
    categoryCode: request.categoryCode,
    hours: request.hours,
    emergencyBand: resolved.band,
    isGuaranteed: resolved.emergency.isGuaranteed,
    captureOnAcceptOnly: resolved.emergency.captureOnAcceptOnly,
    autoRefundMinutesBefore: resolved.emergency.autoRefundMinutesBefore,
    isPeakSeason: resolved.surge.isPeakSeason,
    travelZone: c.travel.zone,
    baseRatePerHourPaise: inputs.baseRate.ratePerHourPaise,
    factors,
    baseAmountPaise: c.baseAmountPaise,
    addonsAmountPaise: c.addons.totalPaise,
    travelAmountPaise: c.travel.amountPaise,
    subtotalPaise: c.subtotalPaise,
    discountAmountPaise: c.discountPaise,
    ...taxed,
    pricesIncludeGst: ruleset.pricesIncludeGst,
    ...splitAdvance(resolved.band, taxed.totalPaise),
    payoutShareBps: inputs.baseRate.payoutShareBps,
    expectedPayoutPaise: expectedPayout(c, inputs.baseRate.payoutShareBps),
    airspaceCheckRequired: c.addons.airspaceCheckRequired,
    promoCode: request.promo?.code ?? null,
    lines: quoteLines(request, inputs, resolved, c, factors),
    computedAt: new Date(nowMs),
    quoteExpiresAt: new Date(nowMs + QUOTE_TTL_MS),
  };
}

/**
 * doc 05 §3. The caller has already resolved the ruleset (step 1) and passed the
 * serviceability gate (step 2); `request.venue` carries the result.
 */
export function computeQuote(request: PricingRequest, ruleset: Ruleset): PricingResult {
  assertValidDate(request.now, 'now');
  assertValidDate(request.scheduledStart, 'scheduledStart');
  const inputs = resolveInputs(request, ruleset);
  if (!inputs.ok) return inputs.result;
  const resolved = resolveFactors(request, ruleset);
  if (!resolved.ok) return resolved.result;
  const factors = toFactorBps(inputs.value, resolved.value);
  const components = priceComponents(request, ruleset, inputs.value, factors);
  if (!components.ok) return components.result;
  return assembleQuote(request, ruleset, inputs.value, resolved.value, components.value);
}

/**
 * doc 05 §5 extension_rates: base hourly × category uplift only — never surge, emergency,
 * night or weekend. Throws on missing configuration; callers validate tier and category first.
 */
export function priceExtension(
  tier: PlanTier,
  cityTier: CityTier,
  categoryCode: string,
  ruleset: Ruleset,
): ExtensionPrice {
  const rule = ruleset.extensionRates.find((r) => r.tier === tier && r.cityTier === cityTier);
  if (rule === undefined) {
    throw new Error(`priceExtension: no extension rate for ${tier} in ${cityTier} cities`);
  }
  const upliftBps = resolveUpliftBps(ruleset.categoryUplifts, categoryCode, tier);
  if (upliftBps === undefined) {
    throw new Error(`priceExtension: category ${categoryCode} is not priced`);
  }
  const uplift = BigInt(upliftBps);
  return {
    hourlyPaise: roundHalfUp(rule.hourlyPaise * uplift, BPS_SCALE),
    waitingHourlyPaise: roundHalfUp(rule.waitingHourlyPaise * uplift, BPS_SCALE),
    waitingGraceMinutes: rule.waitingGraceMinutes,
  };
}
