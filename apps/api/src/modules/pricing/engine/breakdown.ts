import { fromPaiseBigint } from '@clickco/utils';
import type { Quote, QuoteLine } from './types';

/** Optional keys are omitted (not set to undefined) so the JSON round-trips deep-equal. */
export function lineJson(line: QuoteLine): Record<string, unknown> {
  return {
    code: line.code,
    label: line.label,
    ...(line.detail === undefined ? {} : { detail: line.detail }),
    ...(line.amountPaise === undefined ? {} : { amountPaise: fromPaiseBigint(line.amountPaise) }),
    ...(line.isFactor === true ? { isFactor: true } : {}),
    ...(line.factorBps === undefined ? {} : { factorBps: line.factorBps }),
  };
}

/** doc 05 §7 — JSON written to booking_price_snapshots.breakdown. Amounts as JS integers (safe: < ₹100 crore). */
export function toBreakdownJson(quote: Quote): Record<string, unknown> {
  const { gst, factors } = quote;
  return {
    currency: 'INR',
    pricesIncludeGst: quote.pricesIncludeGst,
    lines: quote.lines.map(lineJson),
    subtotalPaise: fromPaiseBigint(quote.subtotalPaise),
    gst: {
      rateBps: gst.rateBps,
      sac: gst.sac,
      placeOfSupply: gst.placeOfSupply,
      cgstPaise: fromPaiseBigint(gst.cgstPaise),
      sgstPaise: fromPaiseBigint(gst.sgstPaise),
      igstPaise: fromPaiseBigint(gst.igstPaise),
    },
    totalPaise: fromPaiseBigint(quote.totalPaise),
    advancePaise: fromPaiseBigint(quote.advancePaise),
    balancePaise: fromPaiseBigint(quote.balancePaise),
    factorsApplied: {
      categoryUpliftBps: factors.categoryUpliftBps,
      emergencyBps: factors.emergencyBps,
      surgeBps: factors.surgeBps,
      nightBps: factors.nightBps,
      weekendBps: factors.weekendBps,
    },
    rulesetVersion: quote.rulesetVersion,
    computedAt: quote.computedAt.toISOString(),
  };
}
