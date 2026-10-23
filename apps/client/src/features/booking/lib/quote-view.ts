import type { AddonCode, PriceQuote, QuoteResponse } from '@clickco/contracts';
import { ceilHalf, roundHalfUp, toPaiseBigint } from '@clickco/utils';
import { rupees } from '@/shared/format/money';

/**
 * Turns the API's PriceQuote into display rows. Every amount stays integer paise until
 * formatINR at the edge; sums are bigint. Nothing here prices anything — it only reads.
 */

export { rupees };

const BPS_PER_UNIT = 10_000n;

/** Basis points as a trimmed decimal: 11500 → "1.15", 12000 → "1.2", 10000 → "1". */
function bpsDecimal(bps: number, scale: bigint): string {
  const value = BigInt(bps);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(scale.toString().length - 1, '0');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed === '' ? whole.toString() : `${whole}.${trimmed}`;
}

/** 1800 → "18%", 1250 → "12.5%" */
export const percentFromBps = (bps: number): string => `${bpsDecimal(bps, 100n)}%`;

/** 11500 → "1.15×" */
export const multiplierFromBps = (bps: number): string => `${bpsDecimal(bps, BPS_PER_UNIT)}×`;

export interface LineView {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly amount: string;
}

export interface QuoteView {
  readonly lines: readonly LineView[];
  /** Multipliers already inside the base line, e.g. "Food category 1.15×". */
  readonly factors: readonly string[];
  readonly subtotal: string;
  readonly discount: string | null;
  readonly gst: { readonly label: string; readonly amount: string };
  readonly total: string;
  readonly payNow: {
    readonly label: string;
    readonly amount: string;
    readonly note: string | null;
  };
  readonly balance: string | null;
}

function payNowLabel(q: PriceQuote): { label: string; note: string | null } {
  if (q.captureOnAcceptOnly) {
    return {
      label: 'Authorise now',
      note: 'Held on your card and charged only when a photographer accepts.',
    };
  }
  if (q.balancePaise === 0) return { label: 'Pay now (full amount)', note: null };
  const half = ceilHalf(toPaiseBigint(q.totalPaise));
  return {
    label: toPaiseBigint(q.advancePaise) === half ? 'Pay now (50%)' : 'Pay now',
    note: null,
  };
}

export function quoteView(q: PriceQuote): QuoteView {
  const gstPaise =
    toPaiseBigint(q.gst.cgstPaise) +
    toPaiseBigint(q.gst.sgstPaise) +
    toPaiseBigint(q.gst.igstPaise);
  const pay = payNowLabel(q);
  return {
    lines: q.lines
      .filter((line) => line.amountPaise !== undefined && line.code !== 'DISCOUNT')
      .map((line) => ({
        key: line.code,
        label: line.label,
        ...(line.detail ? { detail: line.detail } : {}),
        amount: rupees(line.amountPaise ?? 0),
      })),
    factors: q.lines
      .filter((line) => line.isFactor && line.factorBps !== undefined)
      .map((line) => `${line.label} ${multiplierFromBps(line.factorBps ?? 0)}`),
    subtotal: rupees(q.subtotalPaise),
    discount: q.discountPaise > 0 ? `-${rupees(q.discountPaise)}` : null,
    gst: { label: `GST ${percentFromBps(q.gst.rateBps)}`, amount: rupees(gstPaise) },
    total: rupees(q.totalPaise),
    payNow: { label: pay.label, amount: rupees(q.advancePaise), note: pay.note },
    balance: q.balancePaise > 0 ? rupees(q.balancePaise) : null,
  };
}

/** Each add-on's price, read from an add-on probe quote's ADDON_<code> lines. */
export function addonPrices(q: QuoteResponse | undefined): Partial<Record<AddonCode, number>> {
  if (q?.kind !== 'QUOTE') return {};
  return Object.fromEntries(
    q.lines.flatMap((line) =>
      line.code.startsWith('ADDON_') && line.amountPaise !== undefined
        ? [[line.code.slice('ADDON_'.length), line.amountPaise]]
        : [],
    ),
  ) as Partial<Record<AddonCode, number>>;
}

/** Pre-GST price for "from ₹X / 2 hrs"; null for a quote-only tier. */
export function fromPricePaise(q: QuoteResponse | undefined): number | null {
  return q?.kind === 'QUOTE' ? q.subtotalPaise : null;
}

/** The base line's hourly rate (the extension rate for an uplift-free reference quote). */
export function hourlyRatePaise(q: PriceQuote): bigint | null {
  const base = q.lines.find((line) => line.code === 'BASE')?.amountPaise;
  if (base === undefined) return null;
  const halfHours = BigInt(q.hours * 2);
  return roundHalfUp(toPaiseBigint(base) * 2n, halfHours);
}
