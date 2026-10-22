/** doc 05 §3 step 11 (GST, place of supply) and §8 (advance split). */
import type { EmergencyBand } from '@clickco/contracts';
import { ceilHalf, roundHalfUp } from '@clickco/utils';
import { BPS_SCALE } from './constants';
import {
  CLICKCO_GST_STATE_CODE,
  type GstBreakdown,
  type ResolvedVenue,
  type Ruleset,
} from './types';

export interface Taxed {
  readonly taxablePaise: bigint;
  readonly gstAmountPaise: bigint;
  readonly totalPaise: bigint;
  readonly gst: GstBreakdown;
}

type Split = Pick<GstBreakdown, 'cgstPaise' | 'sgstPaise' | 'igstPaise'>;

/** Same state as Clickco → CGST + SGST (CGST takes the odd paise); otherwise IGST. */
function splitByPlaceOfSupply(gstPaise: bigint, venueStateCode: string): Split {
  if (venueStateCode !== CLICKCO_GST_STATE_CODE) {
    return { cgstPaise: 0n, sgstPaise: 0n, igstPaise: gstPaise };
  }
  const cgstPaise = roundHalfUp(gstPaise, 2n);
  return { cgstPaise, sgstPaise: gstPaise - cgstPaise, igstPaise: 0n };
}

/**
 * Exclusive: GST on top of the net amount. Inclusive: the net amount is the total and
 * taxable is back-derived; GST is derived by subtraction so nothing is rounded twice.
 */
export function applyGst(netPaise: bigint, ruleset: Ruleset, venue: ResolvedVenue): Taxed {
  const rateBps = BigInt(ruleset.gstRateBps);
  const taxablePaise = ruleset.pricesIncludeGst
    ? roundHalfUp(netPaise * BPS_SCALE, BPS_SCALE + rateBps)
    : netPaise;
  const gstAmountPaise = ruleset.pricesIncludeGst
    ? netPaise - taxablePaise
    : roundHalfUp(taxablePaise * rateBps, BPS_SCALE);
  return {
    taxablePaise,
    gstAmountPaise,
    totalPaise: taxablePaise + gstAmountPaise,
    gst: {
      rateBps: ruleset.gstRateBps,
      sac: ruleset.sacCode,
      placeOfSupply: venue.gstStateCode,
      ...splitByPlaceOfSupply(gstAmountPaise, venue.gstStateCode),
    },
  };
}

const FIFTY_FIFTY_BANDS: readonly EmergencyBand[] = ['NONE', 'NEXT_DAY'];

/** NONE/NEXT_DAY: 50/50 with the advance absorbing the odd paise. Every other band: 100% upfront. */
export function splitAdvance(
  band: EmergencyBand,
  totalPaise: bigint,
): { readonly advancePaise: bigint; readonly balancePaise: bigint } {
  const advancePaise = FIFTY_FIFTY_BANDS.includes(band) ? ceilHalf(totalPaise) : totalPaise;
  return { advancePaise, balancePaise: totalPaise - advancePaise };
}
