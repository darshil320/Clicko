import { z } from 'zod';
import { AdminListQuery, AdminPage } from './admin.js';
import { IsoDateTime, Uuid } from './common.js';
import { BookingStatus, type StaffRole } from './enums.js';
import { BasisPoints, MoneyPaise } from './money.js';

/**
 * ADR-0026 stream A — the money desks (Sprint 10): refunds with maker–checker, GST credit notes,
 * client credits, settling review items and SLA breach remedies. Owned by stream A only.
 * Money is integer paise (ADR-0007).
 */

const Note = z.string().trim().min(3, 'Add a short note (at least 3 characters)').max(1_000);
const OptionalNote = z.string().trim().max(1_000).optional();
const PositivePaise = MoneyPaise.min(1, 'Enter an amount above ₹0');

/**
 * Who may approve refunds, issue credits and settle review items (SUPER_ADMIN always may). The
 * server checks the finer rules per action: four-eyes, and the QM's ceiling (ADR-0005 OD-12).
 */
export const MONEY_APPROVER_ROLES = [
  'QUALITY_MANAGER',
  'FINANCE',
] as const satisfies readonly StaffRole[];

/** Who did something on the panel (a staff member), or the system. */
export const AdminActor = z.object({ id: Uuid.nullable(), name: z.string() });
export type AdminActor = z.infer<typeof AdminActor>;

// ── Refunds (D1) ────────────────────────────────────────────────────────────

/** schema refund_status. COMPLETED is ADR-0026's "processed". */
export const RefundStatus = z.enum([
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REJECTED',
]);
export type RefundStatus = z.infer<typeof RefundStatus>;

/** schema refunds.reason_code, plus UNFILLED and PAYMENT_ANOMALY for review items. */
export const RefundReason = z.enum([
  'CLIENT_CANCEL',
  'PRO_NO_SHOW',
  'UNFILLED',
  'EMERGENCY_UNFILLED',
  'SLA_BREACH',
  'DATA_LOSS',
  'QUALITY',
  'ACCESS_DENIED',
  'PAYMENT_ANOMALY',
  'GOODWILL',
]);
export type RefundReason = z.infer<typeof RefundReason>;

/**
 * The refund desk's tabs: AWAITING_APPROVAL = REQUESTED; IN_PROGRESS = APPROVED, PROCESSING or
 * FAILED (needs a retry); DONE = COMPLETED or REJECTED.
 */
export const AdminRefundStatusFilter = z.enum(['AWAITING_APPROVAL', 'IN_PROGRESS', 'DONE', 'ALL']);
export type AdminRefundStatusFilter = z.infer<typeof AdminRefundStatusFilter>;

export const AdminRefundQuery = AdminListQuery.extend({
  status: AdminRefundStatusFilter.default('AWAITING_APPROVAL'),
});
export type AdminRefundQuery = z.input<typeof AdminRefundQuery>;

/** A GST credit note (CGST s.34), `CN/2026-27/000041`, against one invoice. */
export const AdminCreditNote = z.object({
  id: Uuid,
  number: z.string(),
  invoiceNumber: z.string(),
  taxablePaise: MoneyPaise,
  cgstPaise: MoneyPaise,
  sgstPaise: MoneyPaise,
  igstPaise: MoneyPaise,
  totalPaise: MoneyPaise,
  issuedAt: IsoDateTime,
  /** Issued after the s.34(2) window: it cannot reduce output GST. */
  lateForGst: z.boolean(),
});
export type AdminCreditNote = z.infer<typeof AdminCreditNote>;

export const AdminRefundItem = z.object({
  id: Uuid,
  bookingId: Uuid,
  reference: z.string(),
  cityName: z.string(),
  clientName: z.string(),
  bookingTotalPaise: MoneyPaise,
  paymentId: Uuid,
  /** Where the money goes back, in words: "UPI · ananya@okicici", "Card ending 4242". */
  paidWith: z.string(),
  amountPaise: PositivePaise,
  status: RefundStatus,
  reason: RefundReason,
  note: z.string().nullable(),
  requestedBy: AdminActor,
  requestedAt: IsoDateTime,
  /** The approver or rejecter. */
  decidedBy: AdminActor.nullable(),
  decidedAt: IsoDateTime.nullable(),
  decisionNote: z.string().nullable(),
  completedAt: IsoDateTime.nullable(),
  failureReason: z.string().nullable(),
  creditNotes: z.array(AdminCreditNote),
  /** Whether the caller may approve (or reject) it now; why not, in plain words. */
  canDecide: z.boolean(),
  blockedReason: z.string().nullable(),
  /** Approving now would issue a credit note after the s.34(2) window (warn first). */
  creditNoteLate: z.boolean(),
});
export type AdminRefundItem = z.infer<typeof AdminRefundItem>;

export const AdminRefundPage = AdminPage(AdminRefundItem);
export type AdminRefundPage = z.infer<typeof AdminRefundPage>;

/** POST /admin/bookings/:bookingId/refunds — ask for a refund (someone else approves it). */
export const AdminRequestRefundBody = z.object({
  amountPaise: PositivePaise,
  reason: RefundReason,
  note: Note,
  /** Refund this payment only; otherwise the newest payments first. */
  paymentId: Uuid.optional(),
});
export type AdminRequestRefundBody = z.infer<typeof AdminRequestRefundBody>;

/** One row per payment the refund goes back to (usually one). */
export const AdminRequestRefundResponse = z.object({ refunds: z.array(AdminRefundItem).min(1) });
export type AdminRequestRefundResponse = z.infer<typeof AdminRequestRefundResponse>;

/** POST /admin/refunds/:refundId/approve — approve and send to the gateway. */
export const AdminApproveRefundBody = z.object({ note: OptionalNote });
export type AdminApproveRefundBody = z.infer<typeof AdminApproveRefundBody>;

/** POST /admin/refunds/:refundId/reject — a rejection always says why. */
export const AdminRejectRefundBody = z.object({ note: Note });
export type AdminRejectRefundBody = z.infer<typeof AdminRejectRefundBody>;

export const AdminRefundDecisionResponse = AdminRefundItem;
export type AdminRefundDecisionResponse = AdminRefundItem;

// ── Credits (D2) ────────────────────────────────────────────────────────────

export const CreditReason = z.enum([
  'SLA_BREACH',
  'LATE_REPLACEMENT',
  'PRO_NO_SHOW',
  'QUALITY',
  'GOODWILL',
]);
export type CreditReason = z.infer<typeof CreditReason>;

export const AdminCreditItem = z.object({
  id: Uuid,
  bookingId: Uuid.nullable(),
  reference: z.string().nullable(),
  clientName: z.string(),
  amountPaise: PositivePaise,
  usedPaise: MoneyPaise,
  reason: CreditReason,
  note: z.string().nullable(),
  issuedBy: AdminActor,
  issuedAt: IsoDateTime,
  /** Valid 12 months, to the end of that IST day. */
  expiresAt: IsoDateTime,
});
export type AdminCreditItem = z.infer<typeof AdminCreditItem>;

/** POST /admin/bookings/:bookingId/credits — QM within the ceiling, finance any amount. */
export const AdminIssueCreditBody = z.object({
  amountPaise: PositivePaise,
  reason: CreditReason,
  note: Note,
});
export type AdminIssueCreditBody = z.infer<typeof AdminIssueCreditBody>;

export const AdminCreditQuery = AdminListQuery.extend({ bookingId: Uuid.optional() });
export type AdminCreditQuery = z.input<typeof AdminCreditQuery>;

export const AdminCreditPage = AdminPage(AdminCreditItem);
export type AdminCreditPage = z.infer<typeof AdminCreditPage>;

export const AdminIssueCreditResponse = AdminCreditItem;
export type AdminIssueCreditResponse = AdminCreditItem;

// ── A booking's money, for the refund and credit sheets ─────────────────────

export const AdminBookingPayment = z.object({
  id: Uuid,
  /** ADVANCE | BALANCE | FULL … */
  purpose: z.string(),
  paidWith: z.string(),
  capturedPaise: MoneyPaise,
  refundedPaise: MoneyPaise,
  /** captured − refunded − refunds still in flight. */
  refundablePaise: MoneyPaise,
  capturedAt: IsoDateTime.nullable(),
});
export type AdminBookingPayment = z.infer<typeof AdminBookingPayment>;

/** GET /admin/bookings/:bookingId/money */
export const AdminBookingMoney = z.object({
  bookingId: Uuid,
  reference: z.string(),
  clientName: z.string(),
  totalPaise: MoneyPaise,
  paidPaise: MoneyPaise,
  refundedPaise: MoneyPaise,
  inFlightPaise: MoneyPaise,
  refundablePaise: MoneyPaise,
  creditedPaise: MoneyPaise,
  /** The Quality Manager's ceiling on this booking (ADR-0005 OD-12). */
  qmLimitPaise: MoneyPaise,
  payments: z.array(AdminBookingPayment),
  refunds: z.array(AdminRefundItem),
  credits: z.array(AdminCreditItem),
});
export type AdminBookingMoney = z.infer<typeof AdminBookingMoney>;

// ── Review items (D2) ───────────────────────────────────────────────────────

export const ReviewOutcome = z.enum([
  'REFUND_REQUESTED',
  'CREDIT_ISSUED',
  'CHARGE_RAISED',
  'NO_ACTION',
]);
export type ReviewOutcome = z.infer<typeof ReviewOutcome>;

export const AdminReviewStatusFilter = z.enum(['OPEN', 'SETTLED', 'ALL']);
export type AdminReviewStatusFilter = z.infer<typeof AdminReviewStatusFilter>;

export const AdminReviewQuery = AdminListQuery.extend({
  status: AdminReviewStatusFilter.default('OPEN'),
});
export type AdminReviewQuery = z.input<typeof AdminReviewQuery>;

export const AdminReviewSuggestion = z.object({
  outcome: ReviewOutcome,
  amountPaise: MoneyPaise,
  /** A credit on top of a refund (the ₹500 no-show apology), else 0. */
  creditPaise: MoneyPaise,
  refundReason: RefundReason.nullable(),
  creditReason: CreditReason.nullable(),
  /** Why, in plain words. */
  why: z.string(),
});
export type AdminReviewSuggestion = z.infer<typeof AdminReviewSuggestion>;

export const AdminReviewBreach = z.object({
  id: Uuid,
  band: z.string(),
  delayMinutes: z.int().min(0),
  remedyKind: z.enum(['CREDIT', 'PARTIAL_REFUND', 'FULL_REFUND']),
  remedyPaise: MoneyPaise,
  payoutDeductionBps: BasisPoints,
  attributedTo: z.string(),
  /** Still owed (not applied, not waived, put down to the photographer or Clickco). */
  owed: z.boolean(),
  applied: z.boolean(),
});
export type AdminReviewBreach = z.infer<typeof AdminReviewBreach>;

export const AdminReviewResolution = z.object({
  outcome: ReviewOutcome,
  amountPaise: MoneyPaise.nullable(),
  note: z.string(),
  resolvedBy: AdminActor,
  resolvedAt: IsoDateTime,
  refundIds: z.array(Uuid),
  creditId: Uuid.nullable(),
});
export type AdminReviewResolution = z.infer<typeof AdminReviewResolution>;

export const AdminReviewItem = z.object({
  eventId: Uuid,
  /** The reason code (kept for search and support); show `title`. */
  reason: z.string(),
  title: z.string(),
  raisedAt: IsoDateTime,
  bookingId: Uuid.nullable(),
  reference: z.string().nullable(),
  cityName: z.string().nullable(),
  clientName: z.string().nullable(),
  bookingStatus: BookingStatus.nullable(),
  bookingTotalPaise: MoneyPaise,
  paidPaise: MoneyPaise,
  refundablePaise: MoneyPaise,
  /** The payment the review is about (payment reviews). */
  paymentId: Uuid.nullable(),
  breach: AdminReviewBreach.nullable(),
  suggestion: AdminReviewSuggestion,
  resolution: AdminReviewResolution.nullable(),
});
export type AdminReviewItem = z.infer<typeof AdminReviewItem>;

export const AdminReviewPage = AdminPage(AdminReviewItem);
export type AdminReviewPage = z.infer<typeof AdminReviewPage>;

/**
 * POST /admin/reviews/:eventId/settle — exactly once. A refund outcome raises refund requests
 * (approved on the refund desk); a credit is issued at once; a charge is recorded only. For a late
 * delivery the breach table fixes the outcome and amount, and applying it records the payout cut.
 */
export const AdminSettleReviewBody = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('REFUND_REQUESTED'),
    amountPaise: PositivePaise,
    refundReason: RefundReason,
    /** Also issue this credit (the ₹500 no-show apology). */
    creditPaise: MoneyPaise.optional(),
    note: Note,
  }),
  z.object({
    outcome: z.literal('CREDIT_ISSUED'),
    amountPaise: PositivePaise,
    creditReason: CreditReason,
    note: Note,
  }),
  z.object({ outcome: z.literal('CHARGE_RAISED'), amountPaise: PositivePaise, note: Note }),
  z.object({ outcome: z.literal('NO_ACTION'), note: Note }),
]);
export type AdminSettleReviewBody = z.infer<typeof AdminSettleReviewBody>;

export const AdminSettleReviewResponse = AdminReviewItem;
export type AdminSettleReviewResponse = AdminReviewItem;
