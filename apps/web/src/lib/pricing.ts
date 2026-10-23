import {
  BOOKABLE_TIERS,
  type BookableTier,
  BPS_DENOMINATOR,
  CATEGORY_UPLIFT_BPS,
  type CategoryCode,
  GST_RATE_BPS,
  type LaunchCityTier,
  MIN_HOURS,
  RATE_PER_HOUR_PAISE,
  REFERENCE_UPLIFT_BPS,
} from '../content/rate-card';
import { formatRupees, roundHalfUp } from './money';

/** A "from" price: weekday daytime, booked 2+ days ahead, no add-ons, no travel. */
export interface FromPrice {
  readonly tier: BookableTier;
  readonly hours: number;
  readonly basePaise: bigint;
  readonly gstPaise: bigint;
  readonly totalPaise: bigint;
  /** Each additional hour = base hourly × category uplift (doc 05 §5 extension_rates). */
  readonly extraHourPaise: bigint;
}

const BPS = BigInt(BPS_DENOMINATOR);

/**
 * Doc 05 step 9 with every multiplier but the category uplift at 1.00×, rounded once,
 * then exclusive GST (step 11). Hours are whole for marketing copy.
 */
export function fromPrice(
  tier: BookableTier,
  cityTier: LaunchCityTier,
  upliftBps: number = REFERENCE_UPLIFT_BPS,
  hours: number = MIN_HOURS,
): FromPrice {
  if (!Number.isInteger(hours) || hours < MIN_HOURS) {
    throw new RangeError(`hours must be a whole number ≥ ${MIN_HOURS}`);
  }
  if (!Number.isInteger(upliftBps) || upliftBps < BPS_DENOMINATOR) {
    throw new RangeError('uplift must be whole basis points ≥ 10000');
  }
  const rate = RATE_PER_HOUR_PAISE[tier][cityTier];
  const uplift = BigInt(upliftBps);
  const basePaise = roundHalfUpBps(rate * BigInt(hours) * uplift);
  const gstPaise = roundHalfUpBps(basePaise * BigInt(GST_RATE_BPS));
  return {
    tier,
    hours,
    basePaise,
    gstPaise,
    totalPaise: basePaise + gstPaise,
    extraHourPaise: roundHalfUpBps(rate * uplift),
  };
}

function roundHalfUpBps(numerator: bigint): bigint {
  return roundHalfUp(numerator, BPS);
}

export function categoryFromPrices(
  cityTier: LaunchCityTier,
  category?: CategoryCode,
): readonly FromPrice[] {
  const uplift = category ? CATEGORY_UPLIFT_BPS[category] : REFERENCE_UPLIFT_BPS;
  return BOOKABLE_TIERS.map((tier) => fromPrice(tier, cityTier, uplift));
}

/** "+15%" for 11500 bps; "standard" for 10000. */
export function percentAbove(bps: number): string {
  const delta = bps - BPS_DENOMINATOR;
  if (delta === 0) return 'standard';
  return `+${delta / 100}%`;
}

/** "2.2×" for 22000 bps. */
export function multiplierLabel(bps: number): string {
  const whole = Math.trunc(bps / BPS_DENOMINATOR);
  const hundredths = (bps % BPS_DENOMINATOR) / 100;
  if (hundredths === 0) return `${whole}×`;
  const decimals = hundredths % 10 === 0 ? `${hundredths / 10}` : `${hundredths}`.padStart(2, '0');
  return `${whole}.${decimals}×`;
}

/** Serialisable display strings for a tier card (safe to pass to a client component). */
export interface PriceCardData {
  readonly tier: BookableTier;
  readonly base: string;
  readonly total: string;
  readonly extraHour: string;
  readonly hours: number;
}

export function toCardData(price: FromPrice): PriceCardData {
  return {
    tier: price.tier,
    base: formatRupees(price.basePaise),
    total: formatRupees(price.totalPaise),
    extraHour: formatRupees(price.extraHourPaise),
    hours: price.hours,
  };
}
