/**
 * Money primitives. All money is integer paise; all arithmetic is bigint.
 * See the clickco-money skill and docs/DECISIONS/0007-money-at-the-api-boundary.md.
 */

/**
 * The one rounding function in Clickco: numerator / denominator, rounded half-up
 * (never banker's). Defined for non-negative numerators only — a negative amount
 * at a rounding step is a bug upstream, so it fails loudly instead of rounding
 * toward the wrong side.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError(`roundHalfUp: denominator must be positive, got ${denominator}`);
  }
  if (numerator < 0n) {
    throw new RangeError(`roundHalfUp: numerator must be non-negative, got ${numerator}`);
  }
  return (numerator * 2n + denominator) / (2n * denominator);
}

/**
 * Advance half of a 50/50 split. The advance absorbs the odd paise so that
 * advance + (total - advance) === total, always (doc 05 §8).
 */
export function ceilHalf(totalPaise: bigint): bigint {
  if (totalPaise < 0n) {
    throw new RangeError(`ceilHalf: total must be non-negative, got ${totalPaise}`);
  }
  return (totalPaise + 1n) / 2n;
}

/** Widen a wire-format integer paise value into bigint for arithmetic. */
export function toPaiseBigint(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`toPaiseBigint: expected a safe integer of paise, got ${value}`);
  }
  return BigInt(value);
}

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Narrow a bigint paise value back to the wire format. Refuses any lossy narrowing. */
export function fromPaiseBigint(value: bigint): number {
  if (value < MIN_SAFE || value > MAX_SAFE) {
    throw new RangeError(`fromPaiseBigint: ${value} is outside the safe-integer range`);
  }
  return Number(value);
}

const INDIAN_GROUPING = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export interface FormatINROptions {
  /** Show the two paise digits (₹16,908.22). Default false: rounds half-up to the rupee. */
  readonly showPaise?: boolean;
}

/**
 * Display-only formatting with Indian lakh grouping (₹1,20,000). Call at the UI
 * edge only; never feed the result back into a calculation.
 */
export function formatINR(paise: bigint | number, options: FormatINROptions = {}): string {
  if (typeof paise === 'number' && !Number.isSafeInteger(paise)) {
    throw new TypeError(`formatINR: expected integer paise, got ${paise}`);
  }
  const value = typeof paise === 'bigint' ? paise : BigInt(paise);
  const sign = value < 0n ? '-' : '';
  const magnitude = value < 0n ? -value : value;

  if (options.showPaise) {
    const rupees = magnitude / 100n;
    const fraction = (magnitude % 100n).toString().padStart(2, '0');
    return `${sign}₹${INDIAN_GROUPING.format(rupees)}.${fraction}`;
  }
  return `${sign}₹${INDIAN_GROUPING.format(roundHalfUp(magnitude, 100n))}`;
}
