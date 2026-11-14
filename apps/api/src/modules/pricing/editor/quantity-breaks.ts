import type { PricingAddonPriceRow } from '@clickco/contracts';

/**
 * Addendum 0021 / ADR-0034: within one add-on, tier and city tier, a higher quantity break may
 * never charge more per unit than a lower one (5 reels must not cost more than 4). Returns the
 * first offending row, or null. Pure.
 */
export function risingQuantityBreak(
  rows: readonly PricingAddonPriceRow[],
): PricingAddonPriceRow | null {
  const scope = (r: PricingAddonPriceRow) =>
    `${r.addonCode}:${r.tier ?? '-'}:${r.cityTier ?? '-'}:${r.isPerHour}`;
  const sorted = [...rows].sort((a, b) => a.minQuantity - b.minQuantity);
  return (
    sorted.find((r) =>
      sorted.some(
        (lower) =>
          scope(lower) === scope(r) &&
          lower.minQuantity < r.minQuantity &&
          lower.amountPaise < r.amountPaise,
      ),
    ) ?? null
  );
}
