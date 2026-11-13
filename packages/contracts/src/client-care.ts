import { z } from 'zod';
import { QualityStatus, TicketAuthor, TicketCategory, TicketStatus } from './admin-care.js';
import { IsoDateTime, Uuid } from './common.js';

/**
 * ADR-0027 D5 — the client's own entry points into customer care (SA-02, ADR-0026 D6): raise a
 * support ticket, see their tickets with the statutory clocks (acknowledge in 48 h, resolve in
 * 30 days, T&C §12), and report a quality issue on a delivered booking. Tickets are private, so
 * their text is length-limited, not rewritten.
 */

export const CLIENT_TICKET_MESSAGE_MIN = 10;
export const CLIENT_TICKET_MESSAGE_MAX = 2_000;
export const CLIENT_TICKET_REPLY_MIN = 1;
export const CLIENT_TICKET_REPLY_MAX = 2_000;
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

/**
 * One message of a ticket's conversation as the client sees it: their own words (CUSTOMER), a
 * reply from support (STAFF) or the resolution line (SYSTEM). Internal staff notes, who on staff
 * wrote a reply, and every id but the message's own never reach the app.
 */
export const ClientTicketMessage = z.object({
  id: Uuid,
  authorKind: TicketAuthor,
  body: z.string(),
  createdAt: IsoDateTime,
});
export type ClientTicketMessage = z.infer<typeof ClientTicketMessage>;

/** GET /me/tickets/:id — a ticket with its conversation, oldest message first. */
export const ClientTicketThread = ClientTicket.extend({
  messages: z.array(ClientTicketMessage),
});
export type ClientTicketThread = z.infer<typeof ClientTicketThread>;

/** GET /me/tickets — newest first, at most 50; the conversation comes from GET /me/tickets/:id. */
export const ClientTicketList = z.array(ClientTicket);
export type ClientTicketList = z.infer<typeof ClientTicketList>;

/**
 * POST /me/tickets/:id/messages — the client answers on their own ticket while it is open
 * (refused once resolved: 409 TICKET_CLOSED). It hands the ticket back to support
 * (AWAITING_CUSTOMER → IN_PROGRESS); the statutory deadlines run from receipt and do not move.
 */
export const ClientTicketReplyBody = z.object({
  message: z
    .string()
    .trim()
    .min(CLIENT_TICKET_REPLY_MIN, 'Write a message')
    .max(CLIENT_TICKET_REPLY_MAX),
});
export type ClientTicketReplyBody = z.infer<typeof ClientTicketReplyBody>;

/** POST /me/tickets/:id/messages answers with the message as stored and where the ticket stands. */
export const ClientTicketReply = z.object({
  ticketId: Uuid,
  status: TicketStatus,
  message: ClientTicketMessage,
});
export type ClientTicketReply = z.infer<typeof ClientTicketReply>;

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
