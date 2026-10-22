/** doc 05 §3 steps 3–8: validate the request and resolve every rate and factor. */
import type { EmergencyBand, PlanTier } from '@clickco/contracts';
import { DEFAULT_MIN_HALF_HOURS } from './constants';
import {
  resolveEmergencyBand,
  resolveNightBps,
  resolveSurge,
  resolveUpliftBps,
  resolveWeekendBps,
  type Surge,
} from './factors';
import { toIst } from './ist-time';
import { type Outcome, ok, reject, stop } from './outcome';
import type { BaseRateRule, EmergencyRule, PricingRequest, Ruleset } from './types';

export interface ResolvedInputs {
  readonly baseRate: BaseRateRule;
  readonly halfHours: bigint;
  readonly upliftBps: number;
}

export interface ResolvedFactors {
  readonly band: EmergencyBand;
  readonly emergency: EmergencyRule;
  readonly surge: Surge;
  readonly nightBps: number;
  readonly weekendBps: number;
}

function minHalfHours(ruleset: Ruleset, tier: PlanTier): number {
  return ruleset.deliverables.find((d) => d.tier === tier)?.minHalfHours ?? DEFAULT_MIN_HALF_HOURS;
}

/** Duration as integer half-hours. Below-minimum is checked before the 0.5 h increment. */
function validateDuration(hours: number, minimumHalfHours: number): Outcome<bigint> {
  const halfHours = hours * 2;
  if (hours < 0 || halfHours < minimumHalfHours) {
    return reject('BELOW_MINIMUM', `Minimum booking is ${minimumHalfHours / 2} hours`);
  }
  if (!Number.isSafeInteger(halfHours)) {
    return reject('INVALID_INCREMENT', 'Duration must be in steps of 0.5 hours');
  }
  return ok(BigInt(halfHours));
}

/**
 * Order is binding: start in past → quote-only (Signature) → duration → base rate → category.
 * Quote-only is decided before duration so a Signature enquiry is never rejected on hours.
 */
export function resolveInputs(request: PricingRequest, ruleset: Ruleset): Outcome<ResolvedInputs> {
  const { tier, venue } = request;
  if (request.scheduledStart.getTime() <= request.now.getTime()) {
    return reject('START_IN_PAST', 'The shoot must start in the future');
  }
  const baseRate = ruleset.baseRates.find((r) => r.tier === tier && r.cityTier === venue.cityTier);
  if (tier === 'SIGNATURE' || baseRate?.isQuoteOnly === true) {
    return stop({ kind: 'QUOTE_ONLY', tier, rulesetVersion: ruleset.version });
  }
  const duration = validateDuration(request.hours, minHalfHours(ruleset, tier));
  if (!duration.ok) return duration;
  if (baseRate === undefined) {
    return reject('NO_BASE_RATE', `No base rate for ${tier} in ${venue.cityTier} cities`);
  }
  const upliftBps = resolveUpliftBps(ruleset.categoryUplifts, request.categoryCode, tier);
  if (upliftBps === undefined) {
    return reject('UNKNOWN_CATEGORY', `Category ${request.categoryCode} is not priced`);
  }
  return ok({ baseRate, halfHours: duration.value, upliftBps });
}

/** Emergency from lead time; surge, night and weekend from the IST wall clock at the start. */
export function resolveFactors(
  request: PricingRequest,
  ruleset: Ruleset,
): Outcome<ResolvedFactors> {
  const band = resolveEmergencyBand(request.scheduledStart, request.now);
  const emergency = ruleset.emergency.find((e) => e.band === band);
  if (emergency === undefined) {
    return reject('NO_EMERGENCY_RULE', `No emergency rule for band ${band}`);
  }
  const ist = toIst(request.scheduledStart);
  return ok({
    band,
    emergency,
    surge: resolveSurge(ruleset.festivals, ist.isoDate, request.venue.cityId),
    nightBps: resolveNightBps(ruleset.night, ist.minuteOfDay),
    weekendBps: resolveWeekendBps(ruleset.weekend, ist.isoWeekday),
  });
}
