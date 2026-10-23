import { PriceQuote } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { toBreakdownJson } from './engine';
import type { Quote } from './engine/types';

/**
 * Engine Quote → the PriceQuote wire shape (doc 05 §7 breakdown + booking-flow flags). Used by the
 * public preview and by POST /bookings so both render the same thing. Parsed, not cast: a response
 * that breaks the shared contract is a server bug, caught here.
 */
export function toPriceQuote(q: Quote): PriceQuote {
  return PriceQuote.parse({
    kind: 'QUOTE',
    ...toBreakdownJson(q),
    tier: q.tier,
    cityTier: q.cityTier,
    categoryCode: q.categoryCode,
    hours: q.hours,
    emergencyBand: q.emergencyBand,
    isGuaranteed: q.isGuaranteed,
    captureOnAcceptOnly: q.captureOnAcceptOnly,
    isPeakSeason: q.isPeakSeason,
    travelZone: q.travelZone,
    airspaceCheckRequired: q.airspaceCheckRequired,
    discountPaise: fromPaiseBigint(q.discountAmountPaise),
    quoteExpiresAt: q.quoteExpiresAt.toISOString(),
  });
}
