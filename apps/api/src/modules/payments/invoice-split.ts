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

export interface RemainderInput {
  /** Every price snapshot of the booking added up (quote + extensions + waiting). */
  readonly snapshot: { readonly taxablePaise: bigint; readonly totalPaise: bigint };
  readonly placeOfSupply: string;
  /** The invoices already issued for the booking (not cancelled). */
  readonly prior: readonly InvoiceSplit[];
}

/**
 * ADR-0016 D3: the balance invoice is what is left — the whole booking's split (taxable exact,
 * GST split like the engine) minus every prior invoice, component by component. The invoices of a
 * booking therefore always sum to its snapshots to the paisa.
 */
export function remainderInvoice(input: RemainderInput): InvoiceSplit {
  const whole = splitInvoice({
    amountPaise: input.snapshot.totalPaise,
    snapshot: input.snapshot,
    placeOfSupply: input.placeOfSupply,
  });
  const sum = (pick: (s: InvoiceSplit) => bigint) =>
    input.prior.reduce((acc, s) => acc + pick(s), 0n);
  const rest: InvoiceSplit = {
    taxablePaise: whole.taxablePaise - sum((s) => s.taxablePaise),
    cgstPaise: whole.cgstPaise - sum((s) => s.cgstPaise),
    sgstPaise: whole.sgstPaise - sum((s) => s.sgstPaise),
    igstPaise: whole.igstPaise - sum((s) => s.igstPaise),
    totalPaise: whole.totalPaise - sum((s) => s.totalPaise),
  };
  const parts = [rest.taxablePaise, rest.cgstPaise, rest.sgstPaise, rest.igstPaise];
  if (rest.totalPaise <= 0n || parts.some((p) => p < 0n)) {
    throw new RangeError(
      `remainderInvoice: nothing (or less than nothing) left: ${rest.totalPaise}`,
    );
  }
  return rest;
}
