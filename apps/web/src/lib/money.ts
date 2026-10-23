/**
 * Money helpers for the marketing site. Money is integer paise (bigint) everywhere
 * (clickco-money skill, doc 05 §1, §4). Mirrors @clickco/utils, which apps/web does not
 * depend on; no Intl, so output is identical in Node at build time and in every browser.
 */

/** Half-up integer division: the single rounding rule from doc 05 §4. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  return (numerator * 2n + denominator) / (2n * denominator);
}

/** "1200000" → "12,00,000" (Indian lakh/crore grouping). */
export function groupIndian(digits: string): string {
  if (!/^\d+$/.test(digits)) throw new RangeError(`not a digit string: ${digits}`);
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${digits.slice(-3)}`;
}

/** 850000n → "₹8,500"; 474950n → "₹4,749.50". Paise are shown only when non-zero. */
export function formatRupees(paise: bigint): string {
  const sign = paise < 0n ? '-' : '';
  const abs = paise < 0n ? -paise : paise;
  const whole = groupIndian((abs / 100n).toString());
  const fraction = abs % 100n;
  const tail = fraction === 0n ? '' : `.${fraction.toString().padStart(2, '0')}`;
  return `${sign}₹${whole}${tail}`;
}

/** 402500n → "4025.00" — the decimal-string form schema.org offers expect. */
export function decimalRupees(paise: bigint): string {
  if (paise < 0n) throw new RangeError('negative amounts are not offered');
  return `${(paise / 100n).toString()}.${(paise % 100n).toString().padStart(2, '0')}`;
}

/** Rupees as written in the rate card (₹1,750) → paise. */
export function rupeesToPaise(rupees: number): bigint {
  if (!Number.isSafeInteger(rupees)) throw new RangeError('rupees must be a whole number');
  return BigInt(rupees) * 100n;
}
