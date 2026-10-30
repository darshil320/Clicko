import {
  type AdminApproveClaimBody,
  type AdminAssessClaimBody,
  AdminClaimItem,
  AdminClaimPage,
  type AdminClaimQuery,
  type AdminCreateClaimBody,
  type AdminCreateTicketBody,
  type AdminOpenQualityBody,
  AdminQualityItem,
  AdminQualityPage,
  type AdminQualityQuery,
  type AdminRejectClaimBody,
  type AdminResolveQualityBody,
  type AdminResolveTicketBody,
  AdminTicketDetail,
  type AdminTicketMessageBody,
  AdminTicketPage,
  type AdminTicketQuery,
  AdminApproveClaimBody as ApproveClaimSchema,
  AdminAssessClaimBody as AssessClaimSchema,
  AdminClaimQuery as ClaimQuerySchema,
  AdminCreateClaimBody as CreateClaimSchema,
  AdminCreateTicketBody as CreateTicketSchema,
  AdminOpenQualityBody as OpenQualitySchema,
  AdminQualityQuery as QualityQuerySchema,
  AdminRejectClaimBody as RejectClaimSchema,
  AdminResolveQualityBody as ResolveQualitySchema,
  AdminResolveTicketBody as ResolveTicketSchema,
  AdminTicketMessageBody as TicketMessageSchema,
  AdminTicketQuery as TicketQuerySchema,
} from '@clickco/contracts';
import { type AdminRequests, checked, idSegment, listParams } from './admin-http.js';
import type { Idempotent } from './client.js';

/**
 * ADR-0026 stream C — `/admin/care`: the Quality Manager's queue, grievance tickets (SA-02) and
 * equipment claims (SA-01). Every POST carries an Idempotency-Key: one per decision, reused on a
 * retry. Money outcomes become review items on "To settle", never a payment from here.
 */
export function adminCareRoutes(r: AdminRequests) {
  return {
    quality: {
      /** OPEN (default, oldest first), RESOLVED or ALL. */
      list: async (query: AdminQualityQuery = {}) => {
        const q = checked(QualityQuerySchema, query);
        const params = listParams({ cursor: q.cursor, limit: q.limit });
        params.set('status', q.status);
        return r.get('/admin/care/quality', AdminQualityPage, params);
      },
      /** The client's complaint on a delivered booking. */
      open: async (body: AdminOpenQualityBody, idem: Idempotent) =>
        r.post('/admin/care/quality', AdminQualityItem, idem, checked(OpenQualitySchema, body)),
      take: (issueId: string, idem: Idempotent) =>
        r.post(`/admin/care/quality/${idSegment(issueId)}/take`, AdminQualityItem, idem),
      /** Closes the issue and the booking; a credit, refund or reshoot goes to "To settle". */
      resolve: async (issueId: string, body: AdminResolveQualityBody, idem: Idempotent) =>
        r.post(
          `/admin/care/quality/${idSegment(issueId)}/resolve`,
          AdminQualityItem,
          idem,
          checked(ResolveQualitySchema, body),
        ),
    },

    tickets: {
      /** OPEN (default), MINE, OVERDUE — nearest deadline first — or RESOLVED. */
      list: async (query: AdminTicketQuery = {}) => {
        const q = checked(TicketQuerySchema, query);
        const params = listParams({ cursor: q.cursor, limit: q.limit });
        params.set('view', q.view);
        return r.get('/admin/care/tickets', AdminTicketPage, params);
      },
      get: (ticketId: string) =>
        r.get(`/admin/care/tickets/${idSegment(ticketId)}`, AdminTicketDetail),
      create: async (body: AdminCreateTicketBody, idem: Idempotent) =>
        r.post('/admin/care/tickets', AdminTicketDetail, idem, checked(CreateTicketSchema, body)),
      /** REPLY to the customer, an internal NOTE, or what the CUSTOMER said. */
      message: async (ticketId: string, body: AdminTicketMessageBody, idem: Idempotent) =>
        r.post(
          `/admin/care/tickets/${idSegment(ticketId)}/messages`,
          AdminTicketDetail,
          idem,
          checked(TicketMessageSchema, body),
        ),
      acknowledge: (ticketId: string, idem: Idempotent) =>
        r.post(`/admin/care/tickets/${idSegment(ticketId)}/acknowledge`, AdminTicketDetail, idem),
      assignToMe: (ticketId: string, idem: Idempotent) =>
        r.post(`/admin/care/tickets/${idSegment(ticketId)}/assign-to-me`, AdminTicketDetail, idem),
      resolve: async (ticketId: string, body: AdminResolveTicketBody, idem: Idempotent) =>
        r.post(
          `/admin/care/tickets/${idSegment(ticketId)}/resolve`,
          AdminTicketDetail,
          idem,
          checked(ResolveTicketSchema, body),
        ),
    },

    claims: {
      /** OPEN (default, oldest first), DECIDED or ALL. */
      list: async (query: AdminClaimQuery = {}) => {
        const q = checked(ClaimQuerySchema, query);
        const params = listParams({ cursor: q.cursor, limit: q.limit });
        params.set('status', q.status);
        return r.get('/admin/care/claims', AdminClaimPage, params);
      },
      create: async (body: AdminCreateClaimBody, idem: Idempotent) =>
        r.post('/admin/care/claims', AdminClaimItem, idem, checked(CreateClaimSchema, body)),
      assess: async (claimId: string, body: AdminAssessClaimBody, idem: Idempotent) =>
        r.post(
          `/admin/care/claims/${idSegment(claimId)}/assess`,
          AdminClaimItem,
          idem,
          checked(AssessClaimSchema, body),
        ),
      /** Up to the ₹2,00,000 cap and the amount claimed; finance pays it from "To settle". */
      approve: async (claimId: string, body: AdminApproveClaimBody, idem: Idempotent) =>
        r.post(
          `/admin/care/claims/${idSegment(claimId)}/approve`,
          AdminClaimItem,
          idem,
          checked(ApproveClaimSchema, body),
        ),
      reject: async (claimId: string, body: AdminRejectClaimBody, idem: Idempotent) =>
        r.post(
          `/admin/care/claims/${idSegment(claimId)}/reject`,
          AdminClaimItem,
          idem,
          checked(RejectClaimSchema, body),
        ),
    },
  };
}
