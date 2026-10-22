/** doc 05 §3 step 11 (discount). Applied to the subtotal, before GST. */
import type { PlanTier } from '@clickco/contracts';
import { roundHalfUp } from '@clickco/utils';
import { BPS_SCALE } from './constants';
import { type Outcome, ok, reject } from './outcome';
import type { PromoInput } from './types';

interface PromoContext {
  readonly tier: PlanTier;
  readonly cityId: string;
  readonly now: Date;
  readonly subtotalPaise: bigint;
}

const minBigint = (a: bigint, b: bigint): bigint => (a < b ? a : b);

function isApplicable(promo: PromoInput, ctx: PromoContext): boolean {
  const tierOk = promo.appliesToTiers === null || promo.appliesToTiers.includes(ctx.tier);
  const cityOk = promo.appliesToCityIds === null || promo.appliesToCityIds.includes(ctx.cityId);
  const firstOk = !promo.firstBookingOnly || promo.userBookingCount === 0;
  return tierOk && cityOk && firstOk;
}

/** Checks run in a fixed order so the same promo always fails with the same code. */
function checkEligibility(promo: PromoInput, ctx: PromoContext): Outcome<true> {
  const nowMs = ctx.now.getTime();
  if (!promo.isActive) return reject('PROMO_INACTIVE', `Promo ${promo.code} is not active`);
  if (nowMs < promo.validFrom.getTime() || nowMs >= promo.validTo.getTime()) {
    return reject('PROMO_EXPIRED', `Promo ${promo.code} is outside its validity window`);
  }
  if (!isApplicable(promo, ctx)) {
    return reject('PROMO_NOT_APPLICABLE', `Promo ${promo.code} does not apply to this booking`);
  }
  if (ctx.subtotalPaise < promo.minBookingPaise) {
    return reject('PROMO_MIN_NOT_MET', `Promo ${promo.code} needs a higher booking value`);
  }
  if (promo.userRedemptions >= promo.perUserCap) {
    return reject('PROMO_USAGE_EXCEEDED', `Promo ${promo.code} has already been used`);
  }
  return ok(true);
}

/** Percentage (bps) or flat, then capped at maxDiscountPaise, then at the subtotal. */
function discountAmount(promo: PromoInput, subtotalPaise: bigint): bigint {
  const raw =
    promo.discountBps !== null
      ? roundHalfUp(subtotalPaise * BigInt(promo.discountBps), BPS_SCALE)
      : (promo.discountFlatPaise ?? 0n);
  const capped = promo.maxDiscountPaise === null ? raw : minBigint(raw, promo.maxDiscountPaise);
  return minBigint(capped, subtotalPaise);
}

/** 0n when no promo is supplied. */
export function resolveDiscount(promo: PromoInput | undefined, ctx: PromoContext): Outcome<bigint> {
  if (promo === undefined) return ok(0n);
  const eligible = checkEligibility(promo, ctx);
  if (!eligible.ok) return eligible;
  return ok(discountAmount(promo, ctx.subtotalPaise));
}
