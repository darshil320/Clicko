import type {
  AdminBookingPayment,
  AdminCreditItem,
  AdminCreditNote,
  AdminRefundItem,
  AdminReviewItem,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import type { AdminBookingFacts } from '../../bookings/bookings.types';
import { type CreditNoteRecord, paidWithLabel } from '../../payments/refunds.types';
import type { RefundableTarget } from '../../refunds/booking-money.reader';
import type { CreditRecord, RefundRecord } from '../../refunds/refunds.types';
import { reviewTitle } from '../../refunds/review-suggestions';
import type { ReviewContext } from '../../refunds/reviews.service';
import { isOwed } from '../../sla/sla.public';
import { actorOf } from './staff-names';

/** Wire mappers for the money desks. Money leaves as integer paise numbers (ADR-0007). */

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;
const paise = fromPaiseBigint;

export function toCreditNote(n: CreditNoteRecord): AdminCreditNote {
  return {
    id: n.id,
    number: n.number,
    invoiceNumber: n.invoiceNumber,
    taxablePaise: paise(n.taxablePaise),
    cgstPaise: paise(n.cgstPaise),
    sgstPaise: paise(n.sgstPaise),
    igstPaise: paise(n.igstPaise),
    totalPaise: paise(n.totalPaise),
    issuedAt: n.issuedAt.toISOString(),
    lateForGst: n.lateForGst,
  };
}

export interface RefundExtras {
  readonly booking: AdminBookingFacts;
  readonly cityName: string;
  readonly paidWith: string;
  readonly names: ReadonlyMap<string, string>;
  readonly notes: readonly CreditNoteRecord[];
  readonly canDecide: boolean;
  readonly blockedReason: string | null;
  readonly creditNoteLate: boolean;
  /** Approving takes the booking above the QM ceiling: a fresh authenticator code is needed. */
  readonly needsAuthenticatorCode: boolean;
}

export function toRefundItem(r: RefundRecord, x: RefundExtras): AdminRefundItem {
  const decider = r.approvedBy ?? r.rejectedBy;
  return {
    id: r.id,
    bookingId: r.bookingId,
    reference: x.booking.reference,
    cityName: x.cityName,
    clientName: x.booking.clientName,
    bookingTotalPaise: paise(x.booking.totalPaise),
    paymentId: r.paymentId,
    paidWith: x.paidWith,
    amountPaise: paise(r.amountPaise),
    status: r.status,
    reason: r.reasonCode,
    note: r.reasonNote,
    requestedBy: actorOf(r.requestedById, x.names),
    requestedAt: r.createdAt.toISOString(),
    decidedBy: decider ? actorOf(decider, x.names) : null,
    decidedAt: iso(r.approvedAt ?? r.rejectedAt),
    decisionNote: r.decisionNote,
    completedAt: iso(r.completedAt),
    failureReason: r.failureReason,
    creditNotes: x.notes.map(toCreditNote),
    canDecide: x.canDecide,
    blockedReason: x.blockedReason,
    creditNoteLate: x.creditNoteLate,
    needsAuthenticatorCode: x.needsAuthenticatorCode,
  };
}

export function toCreditItem(
  c: CreditRecord,
  booking: AdminBookingFacts | undefined,
  names: ReadonlyMap<string, string>,
): AdminCreditItem {
  return {
    id: c.id,
    bookingId: c.sourceBookingId,
    reference: booking?.reference ?? null,
    clientName: booking?.clientName ?? 'Client',
    amountPaise: paise(c.amountPaise),
    usedPaise: paise(c.consumedPaise),
    reason: c.reasonCode,
    note: c.reasonNote,
    issuedBy: actorOf(c.issuedBy, names),
    issuedAt: c.createdAt.toISOString(),
    expiresAt: c.expiresAt.toISOString(),
  };
}

export function toBookingPayment(t: RefundableTarget): AdminBookingPayment {
  return {
    id: t.id,
    purpose: t.purpose,
    paidWith: paidWithLabel(t.method, t.vpaOrLast4),
    capturedPaise: paise(t.capturedPaise),
    refundedPaise: paise(t.refundedPaise),
    refundablePaise: paise(t.refundablePaise),
    capturedAt: iso(t.capturedAt),
  };
}

export function toReviewItem(
  c: ReviewContext,
  cityName: string | null,
  names: ReadonlyMap<string, string>,
): AdminReviewItem {
  const s = c.suggestion;
  const b = c.breach;
  const res = c.resolution;
  return {
    eventId: c.review.eventId,
    reason: c.review.reason ?? c.review.type,
    title: reviewTitle(c.review.reason ?? c.review.type),
    raisedAt: c.review.occurredAt.toISOString(),
    bookingId: c.review.bookingId,
    reference: c.booking?.reference ?? null,
    cityName,
    clientName: c.booking?.clientName ?? null,
    bookingStatus: c.booking?.status ?? null,
    bookingTotalPaise: paise(c.booking?.totalPaise ?? 0n),
    paidPaise: paise(c.paidPaise > 0n ? c.paidPaise : 0n),
    refundablePaise: paise(c.refundablePaise),
    paymentId: c.paymentId,
    breach: b
      ? {
          id: b.id,
          band: b.band,
          delayMinutes: b.delayMinutes,
          remedyKind: b.remedyKind,
          remedyPaise: paise(b.remedyPaise),
          payoutDeductionBps: b.payoutDeductionBps,
          attributedTo: b.attributedTo,
          owed: isOwed(b),
          applied: b.appliedAt !== null,
        }
      : null,
    suggestion: {
      outcome: s.outcome,
      amountPaise: paise(s.amountPaise),
      creditPaise: paise(s.creditPaise),
      refundReason: s.refundReason,
      creditReason: s.creditReason,
      why: s.why,
    },
    resolution: res
      ? {
          outcome: res.outcome,
          amountPaise: res.amountPaise === null ? null : paise(res.amountPaise),
          note: res.note,
          resolvedBy: actorOf(res.resolvedBy, names),
          resolvedAt: res.resolvedAt.toISOString(),
          refundIds: c.refunds.map((r) => r.id),
          creditId: res.creditId,
        }
      : null,
  };
}
