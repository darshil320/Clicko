import {
  type CareReviewReason,
  type ClaimStatus,
  type EvidenceLinkInput,
  isClaimPending,
  type QualityOutcome,
  type TicketAuthor,
  type TicketStatus,
  ticketStatusAfter,
} from '@clickco/contracts';

/** Pure customer-care rules (ADR-0026 D6). No I/O. */

const REVIEW_REASON: Readonly<Record<QualityOutcome, CareReviewReason | null>> = {
  CREDIT: 'QUALITY_CREDIT_DUE',
  PARTIAL_REFUND: 'QUALITY_REFUND_DUE',
  RESHOOT: 'QUALITY_RESHOOT_DUE',
  NO_ACTION: null,
};

/** The `booking.needs_review` reason a QM decision raises (settled on "To settle"), if any. */
export const qualityReviewReason = (outcome: QualityOutcome): CareReviewReason | null =>
  REVIEW_REASON[outcome];

export type QualityAmountProblem = 'CREDIT_ABOVE_TOTAL' | 'REFUND_ABOVE_PAID';

/** A credit is at most the booking total; a refund at most what the client has paid. */
export function qualityAmountProblem(
  outcome: QualityOutcome,
  amountPaise: number,
  booking: { readonly totalPaise: bigint; readonly amountPaidPaise: bigint },
): QualityAmountProblem | null {
  const amount = BigInt(amountPaise);
  if (outcome === 'CREDIT' && amount > booking.totalPaise) return 'CREDIT_ABOVE_TOTAL';
  if (outcome === 'PARTIAL_REFUND' && amount > booking.amountPaidPaise) return 'REFUND_ABOVE_PAID';
  return null;
}

/** One stored entry of equipment_claims.evidence (jsonb). `addedBy` is a staff id. */
export type StoredEvidence =
  | {
      readonly kind: 'LINK';
      readonly url: string;
      readonly label: string;
      readonly addedAt: string;
      readonly addedBy: string | null;
    }
  | {
      readonly kind: 'NOTE';
      readonly text: string;
      readonly addedAt: string;
      readonly addedBy: string | null;
    };

/** New trail entries for an assessment: the note, then each link. */
export function evidenceEntries(
  input: { readonly note?: string; readonly links: readonly EvidenceLinkInput[] },
  staffId: string,
  at: Date,
): StoredEvidence[] {
  const addedAt = at.toISOString();
  return [
    ...(input.note ? [{ kind: 'NOTE' as const, text: input.note, addedAt, addedBy: staffId }] : []),
    ...input.links.map((l) => ({
      kind: 'LINK' as const,
      url: l.url,
      label: l.label,
      addedAt,
      addedBy: staffId,
    })),
  ];
}

export type ClaimApprovalProblem =
  | 'ALREADY_DECIDED'
  | 'ABOVE_CAP'
  | 'ABOVE_CLAIMED'
  | 'NO_EVIDENCE';

/**
 * T&C §8.2: a claim is supported by documentary evidence (at least one link — a note is not
 * evidence) and approved up to the per-incident cap and never above the amount claimed.
 */
export function claimApprovalProblem(
  claim: {
    readonly status: ClaimStatus;
    readonly claimedAmountPaise: bigint;
    readonly capPaise: bigint;
    readonly evidence: readonly StoredEvidence[];
  },
  amountPaise: number,
): ClaimApprovalProblem | null {
  if (!isClaimPending(claim.status)) return 'ALREADY_DECIDED';
  const amount = BigInt(amountPaise);
  if (amount > claim.capPaise) return 'ABOVE_CAP';
  if (amount > claim.claimedAmountPaise) return 'ABOVE_CLAIMED';
  if (!claim.evidence.some((e) => e.kind === 'LINK')) return 'NO_EVIDENCE';
  return null;
}

export interface MessageEffect {
  readonly status: TicketStatus;
  /** A reply to the customer is the first response: it acknowledges the ticket. */
  readonly acknowledges: boolean;
  readonly authorKind: TicketAuthor;
  readonly isInternal: boolean;
}

const ACTION = { REPLY: 'REPLY', NOTE: 'NOTE', CUSTOMER: 'LOG_CUSTOMER' } as const;

/** What appending a message does to a ticket; null when the ticket is done. */
export function ticketMessageEffect(
  status: TicketStatus,
  kind: 'REPLY' | 'NOTE' | 'CUSTOMER',
  acknowledged: boolean,
): MessageEffect | null {
  const next = ticketStatusAfter(status, ACTION[kind]);
  if (next === null) return null;
  return {
    status: next,
    acknowledges: kind === 'REPLY' && !acknowledged,
    authorKind: kind === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
    isInternal: kind === 'NOTE',
  };
}
