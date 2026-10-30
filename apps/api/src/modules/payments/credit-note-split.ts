/**
 * ADR-0026 D1, CGST Act s.34: the tax split of a credit note. Pure, bigint paise only.
 * A credit note takes `amount` out of what is still left on its invoice (the invoice's components
 * minus every earlier credit note), in that remainder's proportion, by the largest-remainder
 * method over taxable / intra-state GST / IGST; the intra-state GST is then halved so CGST equals
 * SGST, its odd paisa (if any) going to taxable (domain review, 30 Oct).
 * The parts always sum to `amount`, never exceed what is left, and crediting everything that is
 * left reproduces it exactly — so a booking's credit notes can never out-credit its invoice.
 */
import type { InvoiceSplit } from './invoice-split';

export interface CreditNoteSplitInput {
  readonly amountPaise: bigint;
  /** The invoice's components minus every credit note already issued against it. */
  readonly remaining: InvoiceSplit;
}

/** Largest-remainder shares of `amount` over `weights` (sum = amount; each ≤ its weight). */
function apportion(amountPaise: bigint, weights: readonly bigint[]): bigint[] {
  const total = weights.reduce((a, b) => a + b, 0n);
  const floors = weights.map((w) => (amountPaise * w) / total);
  const missing = Number(amountPaise - floors.reduce((a, b) => a + b, 0n));
  const bumped = new Set(
    weights
      .map((w, i) => ({ i, rem: (amountPaise * w) % total }))
      .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1))
      .slice(0, missing)
      .map((r) => r.i),
  );
  return floors.map((f, i) => (bumped.has(i) ? f + 1n : f));
}

export function splitCreditNote(input: CreditNoteSplitInput): InvoiceSplit {
  const { amountPaise, remaining: r } = input;
  const left = [r.taxablePaise, r.cgstPaise, r.sgstPaise, r.igstPaise];
  const total = left.reduce((a, b) => a + b, 0n);
  if (left.some((c) => c < 0n) || total !== r.totalPaise) {
    throw new RangeError('splitCreditNote: the remaining invoice amounts are inconsistent');
  }
  if (amountPaise <= 0n || amountPaise > total) {
    throw new RangeError(`splitCreditNote: ${amountPaise} is not within (0, ${total}]`);
  }
  // Everything that is left: exactly what is left (the invoice's own CGST/SGST split).
  if (amountPaise === total) return { ...r };
  const [taxable, gst, igst] = apportion(amountPaise, [
    r.taxablePaise,
    r.cgstPaise + r.sgstPaise,
    r.igstPaise,
  ]) as [bigint, bigint, bigint];
  // CGST = SGST always; an odd paisa of the intra-state GST goes to taxable when it has room.
  const half = gst / 2n;
  const odd = gst - 2n * half;
  const toTaxable = odd > 0n && taxable < r.taxablePaise ? odd : 0n;
  const rest = odd - toTaxable;
  const toCgst = rest > 0n && r.cgstPaise > half ? rest : 0n;
  return {
    taxablePaise: taxable + toTaxable,
    cgstPaise: half + toCgst,
    sgstPaise: half + rest - toCgst,
    igstPaise: igst,
    totalPaise: amountPaise,
  };
}
