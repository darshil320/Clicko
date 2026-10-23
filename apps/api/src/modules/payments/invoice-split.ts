/**
 * ADR-0009: the tax split of a partial (advance) invoice. Pure, bigint paise only.
 * taxable = roundHalfUp(amount × snapshot.taxable / snapshot.total); GST = amount − taxable.
 * GST then splits like the engine (doc 05 step 11): intra-state CGST = roundHalfUp(gst / 2),
 * SGST = remainder; inter-state is all IGST. Paying the whole total reproduces the snapshot exactly,
 * and the balance invoice (S8) takes exact remainders, so the two always sum to the snapshot.
 */
import { roundHalfUp } from '@clickco/utils';
import { CLICKCO_GST_STATE_CODE } from '../pricing/engine/types';

export interface InvoiceSplitInput {
  readonly amountPaise: bigint;
  readonly snapshot: { readonly taxablePaise: bigint; readonly totalPaise: bigint };
  /** 2-digit GST state code of the venue. */
  readonly placeOfSupply: string;
}

export interface InvoiceSplit {
  readonly taxablePaise: bigint;
  readonly cgstPaise: bigint;
  readonly sgstPaise: bigint;
  readonly igstPaise: bigint;
  readonly totalPaise: bigint;
}

export function splitInvoice(input: InvoiceSplitInput): InvoiceSplit {
  const { amountPaise, snapshot, placeOfSupply } = input;
  if (snapshot.totalPaise <= 0n) {
    throw new RangeError('splitInvoice: the snapshot total must be positive');
  }
  if (amountPaise <= 0n || amountPaise > snapshot.totalPaise) {
    throw new RangeError(`splitInvoice: ${amountPaise} is not within (0, ${snapshot.totalPaise}]`);
  }
  const taxablePaise = roundHalfUp(amountPaise * snapshot.taxablePaise, snapshot.totalPaise);
  const gstPaise = amountPaise - taxablePaise;
  if (placeOfSupply !== CLICKCO_GST_STATE_CODE) {
    return {
      taxablePaise,
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: gstPaise,
      totalPaise: amountPaise,
    };
  }
  const cgstPaise = roundHalfUp(gstPaise, 2n);
  return {
    taxablePaise,
    cgstPaise,
    sgstPaise: gstPaise - cgstPaise,
    igstPaise: 0n,
    totalPaise: amountPaise,
  };
}
