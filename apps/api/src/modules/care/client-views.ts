import type {
  ClientQualityIssue,
  ClientTicket,
  ClientTicketMessage,
  ClientTicketReply,
  ClientTicketThread,
} from '@clickco/contracts';
import type { QualityRecord, TicketMessageRecord, TicketRecord } from './care.types';

/**
 * The client's view of their own tickets and quality issues (ADR-0027 D5). Never staff notes,
 * assignees or contact details: only what the client wrote about and where it stands.
 */
export const toClientTicket = (t: TicketRecord): ClientTicket => ({
  id: t.id,
  reference: t.reference,
  category: t.category,
  subject: t.subject,
  bookingId: t.bookingId,
  status: t.status,
  receivedAt: t.receivedAt.toISOString(),
  ackDueAt: t.ackDueAt.toISOString(),
  acknowledgedAt: t.acknowledgedAt?.toISOString() ?? null,
  resolveDueAt: t.resolveDueAt.toISOString(),
  resolvedAt: t.resolvedAt?.toISOString() ?? null,
  resolutionSummary: t.resolutionSummary,
});

/** One message as the client reads it: who wrote it by kind only, never a staff id or name. */
const toClientMessage = (m: TicketMessageRecord): ClientTicketMessage => ({
  id: m.id,
  authorKind: m.authorKind,
  body: m.body,
  createdAt: m.createdAt.toISOString(),
});

/**
 * A ticket with its conversation, oldest first. Internal notes are already left out by the query;
 * they are dropped here too, so a later query change cannot leak one.
 */
export const toClientTicketThread = (
  t: TicketRecord,
  messages: readonly TicketMessageRecord[],
): ClientTicketThread => ({
  ...toClientTicket(t),
  messages: messages.filter((m) => !m.isInternal && m.ticketId === t.id).map(toClientMessage),
});

/** The answer to a client's reply: only their own new message and where the ticket stands. */
export const toClientTicketReply = (r: {
  readonly ticketId: string;
  readonly status: ClientTicketReply['status'];
  readonly message: TicketMessageRecord;
}): ClientTicketReply => ({
  ticketId: r.ticketId,
  status: r.status,
  message: toClientMessage(r.message),
});

export const toClientQualityIssue = (q: QualityRecord): ClientQualityIssue => ({
  id: q.id,
  bookingId: q.bookingId,
  status: q.status,
  raisedAt: q.createdAt.toISOString(),
});
