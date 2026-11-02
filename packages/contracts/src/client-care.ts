import { z } from 'zod';
import { QualityStatus, TicketCategory, TicketStatus } from './admin-care.js';
import { IsoDateTime, Uuid } from './common.js';

/**
 * ADR-0027 D5 — the client's own entry points into customer care (SA-02, ADR-0026 D6): raise a
 * support ticket, see their tickets with the statutory clocks (acknowledge in 48 h, resolve in
 * 30 days, T&C §12), and report a quality issue on a delivered booking. Tickets are private, so
 * their text is length-limited, not rewritten.
 */

export const CLIENT_TICKET_MESSAGE_MIN = 10;
export const CLIENT_TICKET_MESSAGE_MAX = 2_000;
export const CLIENT_QUALITY_COMPLAINT_MIN = 10;
export const CLIENT_QUALITY_COMPLAINT_MAX = 2_000;

/** POST /me/tickets — about one of the caller's bookings, or about nothing in particular. */
export const ClientTicketBody = z.object({
  bookingId: Uuid.optional(),
  category: TicketCategory,
  message: z
    .string()
    .trim()
    .min(CLIENT_TICKET_MESSAGE_MIN, 'Tell us what happened (10 or more characters)')
    .max(CLIENT_TICKET_MESSAGE_MAX),
});
export type ClientTicketBody = z.infer<typeof ClientTicketBody>;

/** One of the caller's tickets with both deadlines (staff notes never appear here). */
export const ClientTicket = z.object({
  id: Uuid,
  /** TKT-…: what to quote when calling support. */
  reference: z.string(),
  category: TicketCategory,
  subject: z.string(),
  bookingId: Uuid.nullable(),
  status: TicketStatus,
  receivedAt: IsoDateTime,
  /** 48 hours from receipt. */
  ackDueAt: IsoDateTime,
  acknowledgedAt: IsoDateTime.nullable(),
  /** 30 days from receipt. */
  resolveDueAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
  /** What support told the client when it was resolved. */
  resolutionSummary: z.string().nullable(),
});
export type ClientTicket = z.infer<typeof ClientTicket>;

/** GET /me/tickets — newest first, at most 50. */
export const ClientTicketList = z.array(ClientTicket);
export type ClientTicketList = z.infer<typeof ClientTicketList>;

/**
 * POST /bookings/:id/quality-issue — the caller's own DELIVERED booking only (the 30 days after
 * delivery, before it closes); one open issue per booking. The Quality Manager decides it.
 */
export const ClientQualityIssueBody = z.object({
  complaint: z
    .string()
    .trim()
    .min(CLIENT_QUALITY_COMPLAINT_MIN, 'Describe what is wrong (10 or more characters)')
    .max(CLIENT_QUALITY_COMPLAINT_MAX),
});
export type ClientQualityIssueBody = z.infer<typeof ClientQualityIssueBody>;

export const ClientQualityIssue = z.object({
  id: Uuid,
  bookingId: Uuid,
  status: QualityStatus,
  raisedAt: IsoDateTime,
});
export type ClientQualityIssue = z.infer<typeof ClientQualityIssue>;
