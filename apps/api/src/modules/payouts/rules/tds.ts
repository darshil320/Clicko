/**
 * TDS on photographer payouts (ADR-0026 D3), pure. Until the CA rules: s.194C, 1 % individuals and
 * HUFs, 2 % everyone else, 20 % without a valid PAN (s.206AA). Nothing is deducted while a single
 * payment is ≤ ₹30,000 and the financial year's total is ≤ ₹1,00,000; once the year's total
 * crosses ₹1,00,000, TDS applies to the whole year's amount not yet taxed, recovered on that
 * payout. The numbers live in TdsRules (payouts.config.ts).
 */
import { roundHalfUp } from '@clickco/utils';
import type { TdsRules } from '../payouts.config';
import { financialYearOf } from './ist-calendar';

const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const BPS = 10_000n;

export interface PanFacts {
  readonly pan: string | null;
  /** Ops checked the PAN card (photographers.pan_verified_at). */
  readonly verified: boolean;
}

export function hasValidPan(p: PanFacts): boolean {
  return p.verified && p.pan !== null && PAN_FORMAT.test(p.pan);
}

export type TdsBasis = 'INDIVIDUAL' | 'OTHER' | 'NO_PAN';

/** The PAN's 4th character is the holder's status: P individual, H HUF, C company, F firm … */
export function tdsRateFor(p: PanFacts, rules: TdsRules): { rateBps: number; basis: TdsBasis } {
  if (!hasValidPan(p) || p.pan === null) return { rateBps: rules.noPanRateBps, basis: 'NO_PAN' };
  return rules.individualPanTypes.includes(p.pan.charAt(3))
    ? { rateBps: rules.individualRateBps, basis: 'INDIVIDUAL' }
    : { rateBps: rules.otherRateBps, basis: 'OTHER' };
}

/** The photographer's financial year so far, before this payout. */
export interface TdsYearToDate {
  /** Every payout credited this year. */
  readonly grossPaise: bigint;
  /** The part of it TDS has already been taken on. */
  readonly coveredPaise: bigint;
}

export interface TdsAssessment {
  /** null (and rate 0) when no TDS applies to this payout. */
  readonly section: string | null;
  readonly rateBps: number;
  readonly tdsPaise: bigint;
  /** The amount this TDS covers (this payout, plus the year's untaxed amount on a catch-up). */
  readonly basePaise: bigint;
}

const NONE: TdsAssessment = { section: null, rateBps: 0, tdsPaise: 0n, basePaise: 0n };

function roundTo(numerator: bigint, denominator: bigint, unit: bigint): bigint {
  return roundHalfUp(numerator, denominator * unit) * unit;
}

/**
 * TDS on one payout. Never more than the payout itself: a catch-up that does not fit takes the
 * whole payout and leaves the rest of the year's base uncovered, so the next payout picks it up.
 */
export function assessTds(
  grossPaise: bigint,
  ytd: TdsYearToDate,
  pan: PanFacts,
  rules: TdsRules,
): TdsAssessment {
  if (grossPaise < 0n) throw new RangeError('assessTds: negative payout');
  const yearTotal = ytd.grossPaise + grossPaise;
  const base =
    yearTotal > rules.yearlyLimitPaise
      ? yearTotal - ytd.coveredPaise
      : grossPaise > rules.singlePaymentLimitPaise
        ? grossPaise
        : 0n;
  if (base <= 0n) return NONE;
  const { rateBps } = tdsRateFor(pan, rules);
  const assessed = roundTo(base * BigInt(rateBps), BPS, rules.roundToPaise);
  if (assessed === 0n) return NONE;
  if (assessed <= grossPaise) {
    return { section: rules.section, rateBps, tdsPaise: assessed, basePaise: base };
  }
  return {
    section: rules.section,
    rateBps,
    tdsPaise: grossPaise,
    basePaise: (base * grossPaise) / assessed,
  };
}

export interface CreditedPayout {
  readonly grossPaise: bigint;
  /** payouts.tds_base_paise */
  readonly basePaise: bigint;
  readonly creditedAt: Date;
}

/** Sums the payouts credited in the financial year (IST) that contains `at`. */
export function yearToDate(credited: readonly CreditedPayout[], at: Date): TdsYearToDate {
  const fy = financialYearOf(at);
  return credited
    .filter((c) => c.creditedAt >= fy.start && c.creditedAt < fy.end)
    .reduce(
      (sum, c) => ({
        grossPaise: sum.grossPaise + c.grossPaise,
        coveredPaise: sum.coveredPaise + c.basePaise,
      }),
      { grossPaise: 0n, coveredPaise: 0n },
    );
}
