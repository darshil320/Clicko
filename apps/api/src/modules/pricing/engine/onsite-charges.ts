/**
 * On-site charges on an existing booking (ADR-0013 D8/D9): a one-hour extension and chargeable
 * waiting time. Pure, bigint paise, bps. doc 05 §5 `extension_rates`: base hourly × category uplift
 * ONLY — never surge, emergency, night or weekend (DOMAIN §5 rule 7). One half-up rounding per
 * line, then GST exactly as the quote does (doc 05 step 11), at the booking's place of supply.
 */
import type { CityTier, PlanTier } from '@clickco/contracts';
import { fromPaiseBigint, roundHalfUp } from '@clickco/utils';
import { lineJson } from './breakdown';
import { BPS_SCALE, NEUTRAL_BPS } from './constants';
import { resolveUpliftBps } from './factors';
import { applyGstAt } from './gst';
import { categoryName, rupees, TIER_LABEL } from './lines';
import type { ExtensionRateRule, GstBreakdown, QuoteLine, Ruleset } from './types';

const MINUTES_PER_HOUR = 60n;

/** What snapshot sequence 1 froze about the booking (the charge is priced against it). */
export interface OnsiteChargeBasis {
  readonly tier: PlanTier;
  readonly cityTier: CityTier;
  readonly categoryCode: string;
  /** GST state code of the venue (snapshot 1 breakdown.gst.placeOfSupply). */
  readonly placeOfSupply: string;
  /** Snapshot 1 payout_share_bps (doc 05 step 12, applied to this line). */
  readonly payoutShareBps: number;
}

export type OnsiteChargeKind = 'EXTENSION' | 'WAITING';

export interface OnsiteCharge {
  readonly kind: OnsiteChargeKind;
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  /** Whole extension hours (0 for waiting). */
  readonly hours: number;
  /** Chargeable minutes (60 per extension hour). */
  readonly minutes: number;
  /** The rule's hourly before the category uplift (snapshot base_rate_per_hour_paise). */
  readonly baseRatePerHourPaise: bigint;
  readonly categoryUpliftBps: number;
  /** Display rate: hourly × uplift, rounded once. */
  readonly ratePerHourPaise: bigint;
  /** The line amount the client sees (before GST when exclusive, the gross when inclusive). */
  readonly netPaise: bigint;
  /** Snapshot base_amount_paise: equals taxable so the snapshot's CHECKs hold in both GST modes. */
  readonly snapshotBasePaise: bigint;
  readonly taxablePaise: bigint;
  readonly gstAmountPaise: bigint;
  readonly totalPaise: bigint;
  readonly gst: GstBreakdown;
  readonly pricesIncludeGst: boolean;
  readonly payoutShareBps: number;
  readonly expectedPayoutPaise: bigint;
  readonly lines: readonly QuoteLine[];
}

function assertWholeNonNegative(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a whole non-negative number, got ${value}`);
  }
}

function rateRule(ruleset: Ruleset, basis: OnsiteChargeBasis): ExtensionRateRule {
  const rule = ruleset.extensionRates.find(
    (r) => r.tier === basis.tier && r.cityTier === basis.cityTier,
  );
  if (!rule) {
    throw new Error(`No extension rate for ${basis.tier} in ${basis.cityTier} cities`);
  }
  return rule;
}

function upliftOf(ruleset: Ruleset, basis: OnsiteChargeBasis): number {
  const bps = resolveUpliftBps(ruleset.categoryUplifts, basis.categoryCode, basis.tier);
  if (bps === undefined) throw new Error(`Category ${basis.categoryCode} is not priced`);
  return bps;
}

function assemble(
  ruleset: Ruleset,
  basis: OnsiteChargeBasis,
  parts: {
    readonly kind: OnsiteChargeKind;
    readonly hours: number;
    readonly minutes: number;
    readonly baseRatePerHourPaise: bigint;
    readonly categoryUpliftBps: number;
    readonly netPaise: bigint;
    readonly line: QuoteLine;
  },
): OnsiteCharge {
  const taxed = applyGstAt(parts.netPaise, ruleset, basis.placeOfSupply);
  return {
    kind: parts.kind,
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.version,
    hours: parts.hours,
    minutes: parts.minutes,
    baseRatePerHourPaise: parts.baseRatePerHourPaise,
    categoryUpliftBps: parts.categoryUpliftBps,
    ratePerHourPaise: roundHalfUp(
      parts.baseRatePerHourPaise * BigInt(parts.categoryUpliftBps),
      BPS_SCALE,
    ),
    netPaise: parts.netPaise,
    snapshotBasePaise: taxed.taxablePaise,
    taxablePaise: taxed.taxablePaise,
    gstAmountPaise: taxed.gstAmountPaise,
    totalPaise: taxed.totalPaise,
    gst: taxed.gst,
    pricesIncludeGst: ruleset.pricesIncludeGst,
    payoutShareBps: basis.payoutShareBps,
    // doc 05 step 12 on this line (no travel component).
    expectedPayoutPaise: roundHalfUp(parts.netPaise * BigInt(basis.payoutShareBps), BPS_SCALE),
    lines: [parts.line],
  };
}

const subject = (basis: OnsiteChargeBasis): string =>
  `${TIER_LABEL[basis.tier]} · ${categoryName(basis.categoryCode)}`;

/** `hours` whole extension hours (G-16: 1 h blocks) at hourly × uplift — one rounding. */
export function extensionCharge(
  ruleset: Ruleset,
  basis: OnsiteChargeBasis,
  hours: number,
): OnsiteCharge {
  if (!Number.isInteger(hours) || hours < 1) {
    throw new RangeError(`extensionCharge: hours must be a whole number ≥ 1, got ${hours}`);
  }
  const rule = rateRule(ruleset, basis);
  const upliftBps = upliftOf(ruleset, basis);
  const rate = roundHalfUp(rule.hourlyPaise * BigInt(upliftBps), BPS_SCALE);
  const netPaise = rate * BigInt(hours);
  return assemble(ruleset, basis, {
    kind: 'EXTENSION',
    hours,
    minutes: hours * 60,
    baseRatePerHourPaise: rule.hourlyPaise,
    categoryUpliftBps: upliftBps,
    netPaise,
    line: {
      code: 'EXTENSION',
      label: `Extension · ${subject(basis)} · ${hours} hour${hours === 1 ? '' : 's'}`,
      detail: `${rupees(rate)}/hr × ${hours} hr${hours === 1 ? '' : 's'}`,
      amountPaise: netPaise,
    },
  });
}

/** T&C §2.6: minutes beyond the grace, counting at most `capMinutes` of waiting. */
export function chargeableWaitingMinutes(
  waitedMinutes: number,
  graceMinutes: number,
  capMinutes: number,
): number {
  assertWholeNonNegative(waitedMinutes, 'waitedMinutes');
  assertWholeNonNegative(graceMinutes, 'graceMinutes');
  assertWholeNonNegative(capMinutes, 'capMinutes');
  return Math.max(0, Math.min(waitedMinutes, capMinutes) - graceMinutes);
}

/**
 * Waiting at the ruleset's waiting hourly (60% of the extension hourly at launch) × uplift, pro
 * rata per minute. ONE rounding on the line: hourly × uplift × minutes / (10000 × 60).
 */
export function waitingCharge(
  ruleset: Ruleset,
  basis: OnsiteChargeBasis,
  chargeableMinutes: number,
): OnsiteCharge {
  assertWholeNonNegative(chargeableMinutes, 'chargeableMinutes');
  const rule = rateRule(ruleset, basis);
  const upliftBps = upliftOf(ruleset, basis);
  const netPaise = roundHalfUp(
    rule.waitingHourlyPaise * BigInt(upliftBps) * BigInt(chargeableMinutes),
    BPS_SCALE * MINUTES_PER_HOUR,
  );
  const rate = roundHalfUp(rule.waitingHourlyPaise * BigInt(upliftBps), BPS_SCALE);
  return assemble(ruleset, basis, {
    kind: 'WAITING',
    hours: 0,
    minutes: chargeableMinutes,
    baseRatePerHourPaise: rule.waitingHourlyPaise,
    categoryUpliftBps: upliftBps,
    netPaise,
    line: {
      code: 'WAITING',
      label: `Waiting time · ${subject(basis)}`,
      detail: `${rupees(rate)}/hr × ${chargeableMinutes} min`,
      amountPaise: netPaise,
    },
  });
}

/** The grace a ruleset grants for this tier/city tier (T&C §2.6; 15 at launch). */
export function waitingGraceMinutes(ruleset: Ruleset, basis: OnsiteChargeBasis): number {
  return rateRule(ruleset, basis).waitingGraceMinutes;
}

/**
 * booking_price_snapshots.breakdown for a sequence 2+ charge: the doc 05 §7 shape with the kind,
 * neutral emergency/surge/night/weekend factors, and the assignment event it settles.
 */
export function onsiteChargeBreakdown(
  charge: OnsiteCharge,
  meta: { readonly computedAt: Date; readonly assignmentEventId: string },
): Record<string, unknown> {
  const { gst } = charge;
  return {
    currency: 'INR',
    kind: charge.kind,
    pricesIncludeGst: charge.pricesIncludeGst,
    lines: charge.lines.map(lineJson),
    minutes: charge.minutes,
    subtotalPaise: fromPaiseBigint(charge.netPaise),
    gst: {
      rateBps: gst.rateBps,
      sac: gst.sac,
      placeOfSupply: gst.placeOfSupply,
      cgstPaise: fromPaiseBigint(gst.cgstPaise),
      sgstPaise: fromPaiseBigint(gst.sgstPaise),
      igstPaise: fromPaiseBigint(gst.igstPaise),
    },
    totalPaise: fromPaiseBigint(charge.totalPaise),
    factorsApplied: {
      categoryUpliftBps: charge.categoryUpliftBps,
      emergencyBps: NEUTRAL_BPS,
      surgeBps: NEUTRAL_BPS,
      nightBps: NEUTRAL_BPS,
      weekendBps: NEUTRAL_BPS,
    },
    rulesetVersion: charge.rulesetVersion,
    assignmentEventId: meta.assignmentEventId,
    computedAt: meta.computedAt.toISOString(),
  };
}
