import { z } from 'zod';
import { AdminListQuery, AdminPage } from './admin.js';
import { IsoDateTime, PhoneE164, Uuid } from './common.js';
import { PlanTier, type StaffRole } from './enums.js';
import { MoneyPaise } from './money.js';

/**
 * ADR-0026 D6 (stream C) — customer care: the Quality Manager's queue (quality_escalations),
 * grievance tickets (SA-02: acknowledge in 48 h, resolve in 30 days — Consumer Protection
 * (E-Commerce) Rules 2020) and equipment claims (SA-01: capped at ₹2,00,000 per incident).
 * Money outcomes raise a review item that the "To settle" desk (D2) settles, so every rupee
 * passes through the same approvals.
 */

/** A booking reference as staff type it ("clk-1004" → "CLK-1004"). */
export const BookingReferenceInput = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CLK-\d{1,12}$/, 'Use the booking reference, like CLK-1004');

/** An https link to evidence (a repair quote, an invoice, photos). Shown as a link to staff. */
export const EvidenceUrl = z.url({ protocol: /^https$/ }).max(500);

// ── Who may do what (the API enforces; SUPER_ADMIN always may) ──────────────

export const CARE_ACTION_ROLES = {
  /** Open a quality issue on a DELIVERED booking, for the client. */
  openQuality: ['QUALITY_MANAGER', 'SUPPORT', 'CITY_MANAGER'],
  /** Pick up and decide a quality issue. */
  decideQuality: ['QUALITY_MANAGER'],
  /** Everything on the ticket desk. */
  workTickets: ['SUPPORT', 'CITY_MANAGER', 'QUALITY_MANAGER', 'OPS_AGENT'],
  /** Log a claim (a photographer reports damage) and add assessment notes or evidence. */
  workClaims: ['FINANCE', 'CITY_MANAGER', 'QUALITY_MANAGER'],
  /** Approve or reject a claim. Paying it is finance's review item. */
  decideClaims: ['FINANCE', 'CITY_MANAGER', 'QUALITY_MANAGER'],
} as const satisfies Readonly<Record<string, readonly StaffRole[]>>;
export type CareAction = keyof typeof CARE_ACTION_ROLES;

// ── Quality issues (quality_escalations) ────────────────────────────────────

export const QualityStatus = z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED']);
export type QualityStatus = z.infer<typeof QualityStatus>;

/** ADR-0026 D6 outcomes. CREDIT and PARTIAL_REFUND move money (through "To settle"). */
export const QualityOutcome = z.enum(['CREDIT', 'RESHOOT', 'PARTIAL_REFUND', 'NO_ACTION']);
export type QualityOutcome = z.infer<typeof QualityOutcome>;

export const QUALITY_MONEY_OUTCOMES = [
  'CREDIT',
  'PARTIAL_REFUND',
] as const satisfies readonly QualityOutcome[];

export const isMoneyOutcome = (o: QualityOutcome): boolean =>
  (QUALITY_MONEY_OUTCOMES as readonly QualityOutcome[]).includes(o);

export const AdminQualityFilter = z.enum(['OPEN', 'RESOLVED', 'ALL']);
export type AdminQualityFilter = z.infer<typeof AdminQualityFilter>;

export const AdminQualityQuery = AdminListQuery.extend({
  status: AdminQualityFilter.default('OPEN'),
});
export type AdminQualityQuery = z.input<typeof AdminQualityQuery>;

export const AdminQualityItem = z.object({
  id: Uuid,
  bookingId: Uuid,
  reference: z.string(),
  cityName: z.string(),
  clientName: z.string(),
  photographerName: z.string().nullable(),
  categoryCode: z.string(),
  tier: PlanTier,
  complaint: z.string(),
  status: QualityStatus,
  raisedByKind: z.enum(['USER', 'STAFF', 'SYSTEM']),
  raisedByName: z.string().nullable(),
  assignedQmId: Uuid.nullable(),
  assignedQmName: z.string().nullable(),
  outcome: QualityOutcome.nullable(),
  /** The credit or partial refund decided (0 otherwise). */
  remedyPaise: MoneyPaise,
  resolutionNote: z.string().nullable(),
  bookingTotalPaise: MoneyPaise,
  amountPaidPaise: MoneyPaise,
  createdAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
});
export type AdminQualityItem = z.infer<typeof AdminQualityItem>;

export const AdminQualityPage = AdminPage(AdminQualityItem);
export type AdminQualityPage = z.infer<typeof AdminQualityPage>;

/** POST /admin/care/quality — the client's complaint, logged by staff on their behalf. */
export const AdminOpenQualityBody = z.object({
  bookingReference: BookingReferenceInput,
  complaint: z.string().trim().min(10, 'Describe what is wrong (10+ characters)').max(2_000),
});
export type AdminOpenQualityBody = z.infer<typeof AdminOpenQualityBody>;

/**
 * POST /admin/care/quality/:id/resolve — closes the issue and the booking. CREDIT and
 * PARTIAL_REFUND carry an amount; the others carry none.
 */
export const AdminResolveQualityBody = z
  .object({
    outcome: QualityOutcome,
    amountPaise: MoneyPaise.optional(),
    note: z.string().trim().min(3, 'Add a short note for the record').max(2_000),
  })
  .refine((b) => !isMoneyOutcome(b.outcome) || (b.amountPaise ?? 0) > 0, {
    message: 'Enter the amount',
    path: ['amountPaise'],
  })
  .refine((b) => isMoneyOutcome(b.outcome) || b.amountPaise === undefined, {
    message: 'Only a credit or a partial refund has an amount',
    path: ['amountPaise'],
  });
export type AdminResolveQualityBody = z.infer<typeof AdminResolveQualityBody>;

// ── Support tickets (support_tickets + ticket_messages) ─────────────────────

export const TicketStatus = z.enum([
  'OPEN',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'AWAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const TicketCategory = z.enum([
  'GRIEVANCE',
  'DATA_DELETION',
  'CONSENT_WITHDRAWAL',
  'BILLING',
  'QUALITY',
  'CONDUCT',
  'APP_ISSUE',
  'OTHER',
]);
export type TicketCategory = z.infer<typeof TicketCategory>;

export const TicketRaisedBy = z.enum(['USER', 'PHOTOGRAPHER', 'PUBLIC']);
export type TicketRaisedBy = z.infer<typeof TicketRaisedBy>;

export const TicketAuthor = z.enum(['CUSTOMER', 'STAFF', 'SYSTEM']);
export type TicketAuthor = z.infer<typeof TicketAuthor>;

export const TICKET_DONE_STATUSES = [
  'RESOLVED',
  'CLOSED',
] as const satisfies readonly TicketStatus[];

export const isTicketDone = (s: TicketStatus): boolean =>
  (TICKET_DONE_STATUSES as readonly TicketStatus[]).includes(s);

/** T&C §12: acknowledge within 48 hours, resolve within 30 days of receipt. */
export const GRIEVANCE_ACK_HOURS = 48;
export const GRIEVANCE_RESOLVE_DAYS = 30;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A deadline turns amber this close to its due time. */
export const ACK_DUE_SOON_MS = 12 * HOUR_MS;
export const RESOLVE_DUE_SOON_MS = 3 * DAY_MS;

export function ticketDeadlines(receivedAt: Date): { ackDueAt: Date; resolveDueAt: Date } {
  const t = receivedAt.getTime();
  return {
    ackDueAt: new Date(t + GRIEVANCE_ACK_HOURS * HOUR_MS),
    resolveDueAt: new Date(t + GRIEVANCE_RESOLVE_DAYS * DAY_MS),
  };
}

/**
 * Where one statutory clock stands: MET / MET_LATE once done (on time or not), otherwise
 * ON_TRACK, DUE_SOON (within `soonMs` — amber) or OVERDUE (red). Due exactly now is DUE_SOON.
 */
export const DeadlineState = z.enum(['MET', 'MET_LATE', 'ON_TRACK', 'DUE_SOON', 'OVERDUE']);
export type DeadlineState = z.infer<typeof DeadlineState>;

const ms = (v: string | Date | number): number =>
  typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : v.getTime();

export function deadlineState(
  dueAt: string | Date,
  doneAt: string | Date | null,
  now: string | Date | number,
  soonMs: number,
): DeadlineState {
  const due = ms(dueAt);
  if (doneAt !== null) return ms(doneAt) <= due ? 'MET' : 'MET_LATE';
  const left = due - ms(now);
  if (left < 0) return 'OVERDUE';
  return left <= soonMs ? 'DUE_SOON' : 'ON_TRACK';
}

/** The clock that matters now: acknowledgement until acknowledged, then resolution. */
export function ticketClock(
  t: {
    readonly ackDueAt: string;
    readonly acknowledgedAt: string | null;
    readonly resolveDueAt: string;
    readonly resolvedAt: string | null;
  },
  now: string | Date | number,
): { readonly kind: 'ACK' | 'RESOLVE'; readonly dueAt: string; readonly state: DeadlineState } {
  if (t.acknowledgedAt === null && t.resolvedAt === null) {
    return {
      kind: 'ACK',
      dueAt: t.ackDueAt,
      state: deadlineState(t.ackDueAt, null, now, ACK_DUE_SOON_MS),
    };
  }
  return {
    kind: 'RESOLVE',
    dueAt: t.resolveDueAt,
    state: deadlineState(t.resolveDueAt, t.resolvedAt, now, RESOLVE_DUE_SOON_MS),
  };
}

export const TicketAction = z.enum(['ACKNOWLEDGE', 'REPLY', 'NOTE', 'LOG_CUSTOMER', 'RESOLVE']);
export type TicketAction = z.infer<typeof TicketAction>;

/**
 * The status a ticket moves to on an action, or null when the action is not allowed. A reply to
 * the customer counts as the acknowledgement (first response); notes never change the status;
 * a customer message reopens the conversation; nothing happens to a resolved ticket here.
 */
export function ticketStatusAfter(status: TicketStatus, action: TicketAction): TicketStatus | null {
  if (isTicketDone(status)) return null;
  switch (action) {
    case 'ACKNOWLEDGE':
      return status === 'OPEN' ? 'ACKNOWLEDGED' : null;
    case 'REPLY':
      return 'AWAITING_CUSTOMER';
    case 'NOTE':
      return status;
    case 'LOG_CUSTOMER':
      return status === 'OPEN' ? 'OPEN' : 'IN_PROGRESS';
    case 'RESOLVE':
      return 'RESOLVED';
  }
}

export const AdminTicketView = z.enum(['OPEN', 'MINE', 'OVERDUE', 'RESOLVED']);
export type AdminTicketView = z.infer<typeof AdminTicketView>;

export const AdminTicketQuery = AdminListQuery.extend({ view: AdminTicketView.default('OPEN') });
export type AdminTicketQuery = z.input<typeof AdminTicketQuery>;

export const AdminTicketItem = z.object({
  id: Uuid,
  reference: z.string(),
  subject: z.string(),
  category: TicketCategory,
  isGrievance: z.boolean(),
  status: TicketStatus,
  raisedByKind: TicketRaisedBy,
  contactName: z.string(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  bookingId: Uuid.nullable(),
  bookingReference: z.string().nullable(),
  assignedToId: Uuid.nullable(),
  assignedToName: z.string().nullable(),
  receivedAt: IsoDateTime,
  ackDueAt: IsoDateTime,
  acknowledgedAt: IsoDateTime.nullable(),
  resolveDueAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
  lastMessageAt: IsoDateTime.nullable(),
  messageCount: z.int().min(0),
});
export type AdminTicketItem = z.infer<typeof AdminTicketItem>;

export const AdminTicketPage = AdminPage(AdminTicketItem);
export type AdminTicketPage = z.infer<typeof AdminTicketPage>;

export const AdminTicketMessage = z.object({
  id: Uuid,
  authorKind: TicketAuthor,
  authorName: z.string().nullable(),
  body: z.string(),
  isInternal: z.boolean(),
  createdAt: IsoDateTime,
});
export type AdminTicketMessage = z.infer<typeof AdminTicketMessage>;

export const AdminTicketDetail = AdminTicketItem.extend({
  resolutionSummary: z.string().nullable(),
  /** Oldest first: the conversation as it happened (append-only). */
  messages: z.array(AdminTicketMessage),
});
export type AdminTicketDetail = z.infer<typeof AdminTicketDetail>;

const MessageText = z.string().trim().min(1, 'Write a message').max(4_000);

/** POST /admin/care/tickets — staff log a ticket for a client or photographer (until S11). */
export const AdminCreateTicketBody = z
  .object({
    raisedBy: TicketRaisedBy,
    contactName: z.string().trim().min(2, 'Enter their name').max(120),
    contactPhone: PhoneE164.optional(),
    contactEmail: z.email().max(254).optional(),
    bookingReference: BookingReferenceInput.optional(),
    category: TicketCategory,
    subject: z.string().trim().min(3, 'Add a subject').max(200),
    /** What the customer said, in their words. */
    message: MessageText,
  })
  .refine((b) => b.contactPhone !== undefined || b.contactEmail !== undefined, {
    message: 'Add a phone number or an email',
    path: ['contactPhone'],
  });
export type AdminCreateTicketBody = z.infer<typeof AdminCreateTicketBody>;

/**
 * POST /admin/care/tickets/:id/messages — REPLY to the customer, an internal NOTE, or log what
 * the CUSTOMER said on a call or by email.
 */
export const AdminTicketMessageBody = z.object({
  kind: z.enum(['REPLY', 'NOTE', 'CUSTOMER']),
  body: MessageText,
});
export type AdminTicketMessageBody = z.infer<typeof AdminTicketMessageBody>;

/** POST /admin/care/tickets/:id/resolve — what was done, in plain words. */
export const AdminResolveTicketBody = z.object({
  summary: z.string().trim().min(3, 'Say how it was resolved').max(2_000),
});
export type AdminResolveTicketBody = z.infer<typeof AdminResolveTicketBody>;

// ── Equipment claims (equipment_claims) ─────────────────────────────────────

/** OD-08 / ADR-0005: ₹2,00,000 per incident (equipment_claims.cap_paise default). */
export const EQUIPMENT_CLAIM_CAP_PAISE = 20_000_000;

export const ClaimStatus = z.enum([
  'OPEN',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'RECOVERED',
  'WRITTEN_OFF',
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const CLAIM_PENDING_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
] as const satisfies readonly ClaimStatus[];

export const isClaimPending = (s: ClaimStatus): boolean =>
  (CLAIM_PENDING_STATUSES as readonly ClaimStatus[]).includes(s);

/** T&C §8.2: caused by the client, their guests, or unsafe venue conditions. */
export const ClaimCause = z.enum(['CLIENT', 'GUEST', 'VENUE_CONDITION']);
export type ClaimCause = z.infer<typeof ClaimCause>;

export const EvidenceLinkInput = z.object({
  url: EvidenceUrl,
  label: z.string().trim().min(2, 'Name the document').max(120),
});
export type EvidenceLinkInput = z.infer<typeof EvidenceLinkInput>;

/** One entry of a claim's assessment trail: an evidence link or a note. */
export const ClaimEvidence = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('LINK'),
    url: z.string(),
    label: z.string(),
    addedAt: IsoDateTime,
    addedByName: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('NOTE'),
    text: z.string(),
    addedAt: IsoDateTime,
    addedByName: z.string().nullable(),
  }),
]);
export type ClaimEvidence = z.infer<typeof ClaimEvidence>;

export const AdminClaimFilter = z.enum(['OPEN', 'DECIDED', 'ALL']);
export type AdminClaimFilter = z.infer<typeof AdminClaimFilter>;

export const AdminClaimQuery = AdminListQuery.extend({ status: AdminClaimFilter.default('OPEN') });
export type AdminClaimQuery = z.input<typeof AdminClaimQuery>;

export const AdminClaimItem = z.object({
  id: Uuid,
  bookingId: Uuid,
  bookingReference: z.string(),
  cityName: z.string(),
  clientName: z.string(),
  photographerId: Uuid,
  photographerName: z.string(),
  cause: ClaimCause,
  description: z.string(),
  incidentAt: IsoDateTime,
  reportedAt: IsoDateTime,
  claimedAmountPaise: MoneyPaise,
  capPaise: MoneyPaise,
  approvedAmountPaise: MoneyPaise.nullable(),
  status: ClaimStatus,
  evidence: z.array(ClaimEvidence),
  reviewedByName: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  resolvedAt: IsoDateTime.nullable(),
});
export type AdminClaimItem = z.infer<typeof AdminClaimItem>;

export const AdminClaimPage = AdminPage(AdminClaimItem);
export type AdminClaimPage = z.infer<typeof AdminClaimPage>;

const EvidenceLinks = z.array(EvidenceLinkInput).max(10);

/** POST /admin/care/claims — the photographer's report, logged by staff. */
export const AdminCreateClaimBody = z.object({
  bookingReference: BookingReferenceInput,
  incidentAt: IsoDateTime,
  cause: ClaimCause,
  description: z.string().trim().min(10, 'Describe the damage (10+ characters)').max(4_000),
  claimedAmountPaise: MoneyPaise.min(1, 'Enter the amount claimed'),
  links: EvidenceLinks.default([]),
});
export type AdminCreateClaimBody = z.input<typeof AdminCreateClaimBody>;

/** POST /admin/care/claims/:id/assess — a note, evidence links, or both. */
export const AdminAssessClaimBody = z
  .object({
    note: z.string().trim().min(3).max(2_000).optional(),
    links: EvidenceLinks.default([]),
  })
  .refine((b) => b.note !== undefined || b.links.length > 0, {
    message: 'Add a note or a link',
    path: ['note'],
  });
export type AdminAssessClaimBody = z.input<typeof AdminAssessClaimBody>;

/** POST /admin/care/claims/:id/approve — never above the cap or the amount claimed. */
export const AdminApproveClaimBody = z.object({
  amountPaise: MoneyPaise.min(1, 'Enter the amount').max(
    EQUIPMENT_CLAIM_CAP_PAISE,
    'The cap is ₹2,00,000 per incident',
  ),
  note: z.string().trim().min(3, 'Add a short note for finance').max(2_000),
});
export type AdminApproveClaimBody = z.infer<typeof AdminApproveClaimBody>;

/** POST /admin/care/claims/:id/reject */
export const AdminRejectClaimBody = z.object({
  reason: z.string().trim().min(3, 'Say why').max(2_000),
});
export type AdminRejectClaimBody = z.infer<typeof AdminRejectClaimBody>;

/** Review reasons this desk raises (`booking.needs_review`), settled on "To settle" (D2). */
export const CARE_REVIEW_REASONS = [
  'QUALITY_CREDIT_DUE',
  'QUALITY_REFUND_DUE',
  'QUALITY_RESHOOT_DUE',
  'EQUIPMENT_CLAIM_APPROVED',
] as const;
export type CareReviewReason = (typeof CARE_REVIEW_REASONS)[number];
