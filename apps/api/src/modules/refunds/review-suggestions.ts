/**
 * ADR-0026 D2: what a review item most likely needs, and its name in plain words. Pure; the
 * desk shows the suggestion, staff decide. Bigint paise only.
 */
import { roundHalfUp } from '@clickco/utils';
import { rupees } from './refund-rules';
import { type CreditReasonCode, MONEY_DESK_CONFIG, type RefundReasonCode } from './refunds.config';

export type ReviewOutcome = 'REFUND_REQUESTED' | 'CREDIT_ISSUED' | 'CHARGE_RAISED' | 'NO_ACTION';

export interface ReviewFacts {
  /** `booking.needs_review` or `payment.needs_review`. */
  readonly type: string;
  readonly reason: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly bookingTotalPaise: bigint;
  /** Captured on the booking minus refunds (done or in flight). */
  readonly netPaidPaise: bigint;
  /** What can still go back: the flagged payment's, or the whole booking's. */
  readonly refundablePaise: bigint;
  /** What the client still owes (the booking's balance when unpaid). */
  readonly balanceDuePaise: bigint;
  readonly breach: {
    readonly remedyKind: 'CREDIT' | 'PARTIAL_REFUND' | 'FULL_REFUND';
    readonly remedyPaise: bigint;
    readonly owed: boolean;
  } | null;
}

export interface Suggestion {
  readonly outcome: ReviewOutcome;
  readonly amountPaise: bigint;
  /** A credit on top of a refund (the ₹500 no-show apology). */
  readonly creditPaise: bigint;
  readonly refundReason: RefundReasonCode | null;
  readonly creditReason: CreditReasonCode | null;
  readonly why: string;
}

const none = (why: string): Suggestion => ({
  outcome: 'NO_ACTION',
  amountPaise: 0n,
  creditPaise: 0n,
  refundReason: null,
  creditReason: null,
  why,
});

function refund(
  f: ReviewFacts,
  wanted: bigint,
  refundReason: RefundReasonCode,
  why: string,
  creditPaise = 0n,
): Suggestion {
  const amountPaise = wanted < f.refundablePaise ? wanted : f.refundablePaise;
  if (amountPaise <= 0n) return none('Nothing is left to refund on this payment.');
  return {
    outcome: 'REFUND_REQUESTED',
    amountPaise,
    creditPaise,
    refundReason,
    creditReason: null,
    why,
  };
}

const credit = (amountPaise: bigint, creditReason: CreditReasonCode, why: string): Suggestion => ({
  outcome: 'CREDIT_ISSUED',
  amountPaise,
  creditPaise: 0n,
  refundReason: null,
  creditReason,
  why,
});

const charge = (amountPaise: bigint, why: string): Suggestion => ({
  outcome: 'CHARGE_RAISED',
  amountPaise,
  creditPaise: 0n,
  refundReason: null,
  creditReason: null,
  why,
});

const share = (total: bigint, bps: bigint): bigint => roundHalfUp(total * bps, 10_000n);

const amountIn = (details: Readonly<Record<string, unknown>>, fallback: bigint): bigint => {
  const raw = details.amount_paise;
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? BigInt(raw) : fallback;
};

const bpsIn = (details: Readonly<Record<string, unknown>>, key: string, fallback: bigint) => {
  const raw = details[key];
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? BigInt(raw) : fallback;
};

/** Money that reached Clickco where it should not have: give it back. */
const MISPLACED_CAPTURE = [
  'CAPTURED_AFTER_RELEASE',
  'CAPTURED_AT_RELEASE',
  'SECOND_CAPTURE_ON_',
  'BALANCE_CAPTURED_WHILE_',
  'HELD_PAYMENT_CAPTURED_WHILE_',
  'LATE_CAPTURE',
  'CAPTURED_AFTER_QUOTE',
];

function breachSuggestion(f: ReviewFacts): Suggestion {
  const b = f.breach;
  if (!b?.owed) {
    return none(
      'Nothing is owed: the delay was waived or put down to the client or force majeure.',
    );
  }
  if (b.remedyKind === 'CREDIT') {
    return credit(
      b.remedyPaise,
      'SLA_BREACH',
      'Late delivery: the breach table gives a service credit.',
    );
  }
  return refund(f, b.remedyPaise, 'SLA_BREACH', 'Late delivery: the breach table gives a refund.');
}

function accessDenied(f: ReviewFacts): Suggestion {
  const due = share(f.bookingTotalPaise, MONEY_DESK_CONFIG.accessDeniedChargeBps);
  const why = `Venue access denied: 50% (${rupees(due)}) is chargeable (T&C §7.2).`;
  if (f.netPaidPaise > due)
    return refund(f, f.netPaidPaise - due, 'ACCESS_DENIED', `${why} Refund the rest.`);
  if (f.netPaidPaise < due)
    return charge(due - f.netPaidPaise, `${why} The client owes the difference.`);
  return none(`${why} What was paid covers it exactly.`);
}

export function suggestOutcome(f: ReviewFacts): Suggestion {
  const r = f.reason;
  if (r === 'REFUND_DUE_UNFILLED') {
    return refund(
      f,
      amountIn(f.details, f.refundablePaise),
      'UNFILLED',
      'No photographer could be found: refund everything paid (T&C §3.5, §3.7).',
    );
  }
  if (r === 'REFUND_DUE_NO_SHOW') {
    return refund(
      f,
      amountIn(f.details, f.refundablePaise),
      'PRO_NO_SHOW',
      'The photographer did not come and nobody replaced them: full refund plus a ₹500 credit (T&C §3.6).',
      MONEY_DESK_CONFIG.noShowCreditPaise,
    );
  }
  if (r === 'LATE_REPLACEMENT_CREDIT_25') {
    const bps = bpsIn(f.details, 'credit_bps', MONEY_DESK_CONFIG.lateReplacementCreditBps);
    return credit(
      share(f.bookingTotalPaise, bps),
      'LATE_REPLACEMENT',
      'A replacement photographer arrived late: 25% of the booking as a credit (T&C §3.6).',
    );
  }
  if (r === 'ACCESS_DENIED_CHARGE_50') return accessDenied(f);
  if (r === 'UNSAFE_SITE_PARTIAL_CHARGE') {
    return none(
      'Unsafe site: billed in full with no refund for the part not shot (T&C §8.3). Choose a refund only as goodwill.',
    );
  }
  if (r === 'CLIENT_NON_ATTENDANCE') {
    return f.balanceDuePaise > 0n
      ? charge(
          f.balanceDuePaise,
          "The client didn't attend: the booking counts as completed and the balance is due (T&C §3.8).",
        )
      : none(
          "The client didn't attend: the booking counts as completed and is fully paid (T&C §3.8).",
        );
  }
  if (r === 'SLA_BREACH_REMEDY') return breachSuggestion(f);
  if (MISPLACED_CAPTURE.some((p) => r.startsWith(p))) {
    return refund(
      f,
      amountIn(f.details, f.refundablePaise),
      'PAYMENT_ANOMALY',
      'Money was taken that should not have been: give it back.',
    );
  }
  if (r.startsWith('AMOUNT_MISMATCH') || r === 'REFUND_AMOUNT_MISMATCH') {
    return none('The gateway amount differs from the order: reconcile it with the gateway first.');
  }
  if (r.startsWith('AUTHORISED_WHILE_')) {
    return none(
      'A payment was authorised on a booking that no longer needs it: the hold is released, not refunded.',
    );
  }
  return none('Look at the booking and decide; no money moves unless you choose to.');
}

const TITLES: ReadonlyArray<readonly [string, string]> = [
  ['REFUND_DUE_UNFILLED', 'No photographer found'],
  ['REFUND_DUE_NO_SHOW', 'Photographer did not show up'],
  ['LATE_REPLACEMENT_CREDIT_25', 'Replacement arrived late'],
  ['ACCESS_DENIED_CHARGE_50', 'Venue access denied'],
  ['UNSAFE_SITE_PARTIAL_CHARGE', 'Shoot stopped: unsafe site'],
  ['CLIENT_NON_ATTENDANCE', "Client didn't attend"],
  ['OFFLINE_CHECK_IN_TIME', 'Offline check-in time to verify'],
  ['SLA_BREACH_REMEDY', 'Photos delivered late'],
  ['CAPTURED_AFTER_RELEASE', 'Charged after the hold was released'],
  ['CAPTURED_AT_RELEASE', 'Charged while releasing the hold'],
  ['SECOND_CAPTURE_ON_', 'Client charged twice'],
  ['BALANCE_CAPTURED_WHILE_', 'Balance paid at the wrong time'],
  ['HELD_PAYMENT_CAPTURED_WHILE_', 'Held payment charged at the wrong time'],
  ['AMOUNT_MISMATCH', 'Payment amount does not match'],
  ['AUTHORISED_WHILE_', 'Payment authorised at the wrong time'],
  ['CAPTURE_DECLINED_AFTER_START', 'Payment declined after the shoot started'],
  ['MALFORMED', 'Unreadable gateway message'],
  ['REFUND_AMOUNT_MISMATCH', 'Bank refunded a different amount'],
];

/** The review's reason as a heading: known reasons by name, anything else humanised. */
export function reviewTitle(reason: string): string {
  const known = TITLES.find(([prefix]) => reason.startsWith(prefix));
  if (known) return known[1];
  const words =
    reason
      .split(':')[0]
      ?.toLowerCase()
      .split(/[_\s]+/)
      .filter(Boolean)
      .join(' ') ?? '';
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Needs a decision';
}
