/** Pure mappings from the engine's Quote to the rows written at DRAFT → QUOTED. */
import { type OnsiteCharge, toBreakdownJson } from '../pricing/engine';
import type { Quote } from '../pricing/engine/types';
import type { ChargeBasis } from './bookings.types';

export interface SnapshotRow {
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly sequence: number;
  readonly tier: Quote['tier'];
  readonly cityTier: Quote['cityTier'];
  readonly categoryCode: string;
  readonly hours: number;
  readonly baseRatePerHourPaise: bigint;
  readonly categoryUpliftBps: number;
  readonly emergencyMultiplierBps: number;
  readonly surgeMultiplierBps: number;
  readonly nightMultiplierBps: number;
  readonly weekendMultiplierBps: number;
  readonly baseAmountPaise: bigint;
  readonly addonsAmountPaise: bigint;
  readonly travelAmountPaise: bigint;
  readonly discountAmountPaise: bigint;
  readonly taxableAmountPaise: bigint;
  readonly gstRateBps: number;
  readonly gstAmountPaise: bigint;
  readonly totalAmountPaise: bigint;
  readonly pricesIncludeGst: boolean;
  readonly payoutShareBps: number;
  readonly expectedPayoutPaise: bigint;
  readonly breakdown: Record<string, unknown>;
  readonly promoCode: string | null;
  readonly computedAt: Date;
}

/** booking_price_snapshots sequence 1: every resolved factor and line, frozen (DOMAIN §5 rule 3). */
export function toSnapshotRow(q: Quote): SnapshotRow {
  return {
    rulesetId: q.rulesetId,
    rulesetVersion: q.rulesetVersion,
    sequence: 1,
    tier: q.tier,
    cityTier: q.cityTier,
    categoryCode: q.categoryCode,
    hours: q.hours,
    baseRatePerHourPaise: q.baseRatePerHourPaise,
    categoryUpliftBps: q.factors.categoryUpliftBps,
    emergencyMultiplierBps: q.factors.emergencyBps,
    surgeMultiplierBps: q.factors.surgeBps,
    nightMultiplierBps: q.factors.nightBps,
    weekendMultiplierBps: q.factors.weekendBps,
    baseAmountPaise: q.baseAmountPaise,
    addonsAmountPaise: q.addonsAmountPaise,
    travelAmountPaise: q.travelAmountPaise,
    discountAmountPaise: q.discountAmountPaise,
    taxableAmountPaise: q.taxablePaise,
    gstRateBps: q.gst.rateBps,
    gstAmountPaise: q.gstAmountPaise,
    totalAmountPaise: q.totalPaise,
    pricesIncludeGst: q.pricesIncludeGst,
    payoutShareBps: q.payoutShareBps,
    expectedPayoutPaise: q.expectedPayoutPaise,
    breakdown: toBreakdownJson(q),
    promoCode: q.promoCode,
    computedAt: q.computedAt,
  };
}

export interface AddonRow {
  readonly addonId: string;
  readonly quantity: number;
  readonly amountPaise: bigint;
}

/**
 * One booking_addons row per requested add-on, priced from the quote's ADDON_<code> line.
 * Codes must be unique (booking_addons_uq); checkout rejects duplicates before pricing.
 */
export function toAddonRows(
  quote: Quote,
  requested: ReadonlyArray<{ readonly code: string; readonly quantity: number }>,
  addonIds: ReadonlyMap<string, string>,
): AddonRow[] {
  return requested.map(({ code, quantity }) => {
    const line = quote.lines.find((l) => l.code === `ADDON_${code}`);
    const addonId = addonIds.get(code);
    if (line?.amountPaise === undefined || addonId === undefined) {
      throw new Error(`toAddonRows: add-on ${code} is missing from the quote or the catalogue`);
    }
    return { addonId, quantity, amountPaise: line.amountPaise };
  });
}

/**
 * booking_price_snapshots sequence 2+: ONLY the delta of one on-site charge (ADR-0013 D8/D9) on the
 * booking's own ruleset, with neutral emergency/surge/night/weekend factors (DOMAIN §5 rule 7).
 * `base_amount_paise` is the taxable value, so the snapshot CHECKs hold in either GST mode.
 */
export function toChargeSnapshotRow(
  charge: OnsiteCharge,
  basis: ChargeBasis,
  breakdown: Record<string, unknown>,
  sequence: number,
  computedAt: Date,
): SnapshotRow {
  if (sequence < 2) throw new RangeError('toChargeSnapshotRow: charges start at sequence 2');
  return {
    rulesetId: charge.rulesetId,
    rulesetVersion: charge.rulesetVersion,
    sequence,
    tier: basis.tier,
    cityTier: basis.cityTier,
    categoryCode: basis.categoryCode,
    hours: charge.hours,
    baseRatePerHourPaise: charge.baseRatePerHourPaise,
    categoryUpliftBps: charge.categoryUpliftBps,
    emergencyMultiplierBps: 10_000,
    surgeMultiplierBps: 10_000,
    nightMultiplierBps: 10_000,
    weekendMultiplierBps: 10_000,
    baseAmountPaise: charge.snapshotBasePaise,
    addonsAmountPaise: 0n,
    travelAmountPaise: 0n,
    discountAmountPaise: 0n,
    taxableAmountPaise: charge.taxablePaise,
    gstRateBps: charge.gst.rateBps,
    gstAmountPaise: charge.gstAmountPaise,
    totalAmountPaise: charge.totalPaise,
    pricesIncludeGst: charge.pricesIncludeGst,
    payoutShareBps: charge.payoutShareBps,
    expectedPayoutPaise: charge.expectedPayoutPaise,
    breakdown,
    promoCode: null,
    computedAt,
  };
}
