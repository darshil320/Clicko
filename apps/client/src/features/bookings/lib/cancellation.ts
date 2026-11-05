import { isApiError } from '@clickco/api-client';
import type { CancellationBand, CancellationOutcome, CancellationQuote } from '@clickco/contracts';
import { userMessage } from '@/shared/errors';
import { formatDateTime } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';

/**
 * A client cancelling their own booking (ADR-0031). The API owns the T&C §3 ladder: the quote
 * (GET /bookings/:id/cancellation) says whether cancelling is possible and what comes back. This
 * only turns its answer, and the POST's refusals, into plain words. Pure, so it is tested.
 */

/** T&C §3.9: refunds reach the original payment method within 7–10 business days. */
export const REFUND_TIMING = 'within 7–10 working days';
const PAID_WITH = 'the card or UPI account you paid with';

/** Whether the booking detail offers "Cancel booking", says why not, or shows nothing. */
export type CancelEntry =
  | { readonly kind: 'offer' }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'hidden' };

/**
 * Offer it only when the quote says so. Two refusals deserve a word on the booking itself: the
 * payment is still settling (try again soon), and the start time has passed (a late photographer
 * is a no-show, refunded in full through support). Anything else needs no explaining.
 */
export function cancelEntry(quote: CancellationQuote | undefined): CancelEntry {
  if (!quote) return { kind: 'hidden' };
  if (quote.cancellable) return { kind: 'offer' };
  if (quote.blockedBy === 'PAYMENT_SETTLING' || quote.blockedBy === 'SHOOT_TIME_PASSED') {
    return { kind: 'note', text: quote.reason };
  }
  return { kind: 'hidden' };
}

export interface MoneyRow {
  readonly key: 'paid' | 'back' | 'kept' | 'held';
  readonly label: string;
  readonly value: string;
}

export interface QuoteCopy {
  /** The outcome in one plain sentence, with the amount. */
  readonly summary: string;
  /** Why, in the API's words (the band without amounts); null when the summary already says it. */
  readonly reason: string | null;
  /** Paid / comes back / not refunded / hold released. Empty when nothing changed hands. */
  readonly rows: readonly MoneyRow[];
  /** When this figure stops applying, if it can still get smaller. */
  readonly deadline: string | null;
}

/** Bands where nothing of the advance comes back have their own, shorter sentence. */
const NOTHING_BACK: Partial<Record<CancellationBand, string>> = {
  UNDER_24_HOURS: "This booking is less than 24 hours away, so the advance isn't refundable.",
  EMERGENCY_AFTER_ACCEPTANCE:
    "A photographer has already accepted this same-day booking, so the advance isn't refundable.",
};

function summaryOf(quote: CancellationQuote): { summary: string; ownsReason: boolean } {
  const { refundPaise, heldPaise, paidPaise, band } = quote;
  const back =
    refundPaise > 0
      ? `You'll get ${rupees(refundPaise)} back to ${PAID_WITH}, ${REFUND_TIMING}.`
      : null;
  const hold =
    heldPaise > 0
      ? `The ${rupees(heldPaise)} held for this booking is released, so you won't be charged it.`
      : null;
  if (back || hold) return { summary: [back, hold].filter(Boolean).join(' '), ownsReason: false };
  if (paidPaise === 0) {
    return {
      summary: 'Nothing has been charged yet, so you can cancel free of charge.',
      ownsReason: true,
    };
  }
  const banded = band ? NOTHING_BACK[band] : undefined;
  if (banded) return { summary: banded, ownsReason: true };
  return {
    summary: `If you cancel now, the ${rupees(paidPaise)} you paid isn't refundable.`,
    ownsReason: false,
  };
}

function rowsOf(quote: CancellationQuote): MoneyRow[] {
  const rows: MoneyRow[] = [];
  if (quote.paidPaise > 0) {
    rows.push({ key: 'paid', label: 'You paid', value: rupees(quote.paidPaise) });
    rows.push({ key: 'back', label: 'Comes back to you', value: rupees(quote.refundPaise) });
    if (quote.keptPaise > 0) {
      rows.push({ key: 'kept', label: 'Not refunded', value: rupees(quote.keptPaise) });
    }
  }
  if (quote.heldPaise > 0) {
    rows.push({ key: 'held', label: 'Hold released', value: rupees(quote.heldPaise) });
  }
  return rows;
}

/** The confirm sheet's words for a cancellable quote. */
export function quoteCopy(quote: CancellationQuote): QuoteCopy {
  const { summary, ownsReason } = summaryOf(quote);
  const deadline =
    quote.changesAt && quote.refundPaise > 0
      ? `This amount applies if you cancel before ${formatDateTime(quote.changesAt)}. After that, less comes back.`
      : null;
  return { summary, reason: ownsReason ? null : quote.reason, rows: rowsOf(quote), deadline };
}

/** What the success state says once the booking is cancelled. */
export function outcomeCopy(outcome: CancellationOutcome): string {
  const parts: string[] = [];
  if (outcome.refundPaise > 0) {
    parts.push(
      `${rupees(outcome.refundPaise)} is on its way back to ${PAID_WITH}. It reaches you ${REFUND_TIMING}.`,
    );
  }
  if (outcome.heldPaise > 0) {
    parts.push(`The ${rupees(outcome.heldPaise)} hold is released, so you won't be charged it.`);
  }
  if (parts.length > 0) return parts.join(' ');
  return outcome.keptPaise > 0
    ? 'No refund was due under the cancellation terms.'
    : 'Nothing was charged, so there is nothing to refund.';
}

/**
 * What to do after a refused cancel:
 *  - requote: the terms moved; fetch the quote again and let the client confirm the new figure.
 *  - refresh: the booking moved on (already cancelled, shoot started); refresh it, nothing to retry.
 *  - retry: worth trying again as it is (same key: the API replays, never acts twice).
 *  - final: retrying cannot help.
 */
export type CancelNext = 'requote' | 'refresh' | 'retry' | 'final';

/** A rate limit is a client error that waiting fixes. */
const TOO_MANY_REQUESTS = 429;

export interface CancelFailure {
  readonly message: string;
  readonly next: CancelNext;
}

const REFUSALS: Readonly<Record<string, CancelFailure>> = {
  CANCELLATION_TERMS_CHANGED: {
    message:
      'The refund changed while you were deciding. Check the new amount below and confirm again if you still want to cancel.',
    next: 'requote',
  },
  CANCELLATION_CONFIRMATION_REQUIRED: {
    message: 'Check the amount below and confirm again if you still want to cancel.',
    next: 'requote',
  },
  ALREADY_CANCELLED: { message: 'This booking is already cancelled.', next: 'refresh' },
  CANCEL_NOT_AVAILABLE: {
    message:
      "This booking can't be cancelled in the app any more: the shoot has started or its start time has passed. If your photographer hasn't arrived, get help: a no-show is refunded in full.",
    next: 'refresh',
  },
  CANCEL_PAYMENT_SETTLING: {
    message:
      'A photographer has just accepted and your payment is being confirmed. Try again in a minute.',
    next: 'retry',
  },
  IDEMPOTENCY_REQUEST_IN_PROGRESS: {
    message: "We're still working on your cancellation. Give it a moment, then try again.",
    next: 'retry',
  },
  BOOKING_NOT_FOUND: { message: "We can't find this booking on your account.", next: 'final' },
};

/** A refused or failed POST /bookings/:id/cancel, in the client's words, with the next step. */
export function cancelFailure(error: unknown): CancelFailure {
  if (isApiError(error) && error.kind === 'HTTP') {
    const known = REFUSALS[error.code];
    if (known) return known;
    if (error.isClientError && error.status !== TOO_MANY_REQUESTS) {
      return { message: userMessage(error), next: 'final' };
    }
  }
  return { message: userMessage(error), next: 'retry' };
}
