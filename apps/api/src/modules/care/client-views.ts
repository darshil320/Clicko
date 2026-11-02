import type { ClientQualityIssue, ClientTicket } from '@clickco/contracts';
import type { QualityRecord, TicketRecord } from './care.types';

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

export const toClientQualityIssue = (q: QualityRecord): ClientQualityIssue => ({
  id: q.id,
  bookingId: q.bookingId,
  status: q.status,
  raisedAt: q.createdAt.toISOString(),
});
