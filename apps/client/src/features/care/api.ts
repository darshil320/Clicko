import type { ClientQualityIssueBody, ClientTicketBody } from '@clickco/contracts';
import { api } from '@/shared/api';

/** The caller's support tickets, newest first (ADR-0027 D5, SA-02). */
export const fetchTickets = () => api.care.tickets();

/** One Idempotency-Key per intent (the care key ring): a retried tap never raises two tickets. */
export const raiseTicket = (body: ClientTicketBody, idempotencyKey: string) =>
  api.care.raiseTicket(body, { idempotencyKey });

export const reportQualityIssue = (
  bookingId: string,
  body: ClientQualityIssueBody,
  idempotencyKey: string,
) => api.care.reportQualityIssue(bookingId, body, { idempotencyKey });
