import {
  type AdminApproveRefundBody,
  AdminBookingMoney,
  AdminCreditPage,
  type AdminCreditQuery,
  type AdminIssueCreditBody,
  AdminIssueCreditResponse,
  AdminRefundDecisionResponse,
  AdminRefundPage,
  type AdminRefundQuery,
  type AdminRejectRefundBody,
  type AdminRequestRefundBody,
  AdminRequestRefundResponse,
  AdminReviewPage,
  type AdminReviewQuery,
  type AdminSettleReviewBody,
  AdminSettleReviewResponse,
  AdminApproveRefundBody as ApproveSchema,
  AdminCreditQuery as CreditQuerySchema,
  AdminIssueCreditBody as IssueCreditSchema,
  AdminRefundQuery as RefundQuerySchema,
  AdminRejectRefundBody as RejectSchema,
  AdminRequestRefundBody as RequestRefundSchema,
  AdminReviewQuery as ReviewQuerySchema,
  AdminSettleReviewBody as SettleSchema,
} from '@clickco/contracts';
import { type AdminRequests, checked, idSegment, listParams } from './admin-http.js';
import type { Idempotent } from './client.js';

/**
 * ADR-0026 stream A — `/admin` money routes: refunds (maker–checker), credits, a booking's money,
 * and the "To settle" review items. Every POST carries an Idempotency-Key: keep one key per
 * decision and reuse it on a retry, so a money action never runs twice. Owned by stream A only.
 */
export function adminMoneyRoutes(r: AdminRequests) {
  return {
    /** A booking's payments, refunds, credits and the QM's limit on it. */
    bookingMoney: (bookingId: string) =>
      r.get(`/admin/bookings/${idSegment(bookingId)}/money`, AdminBookingMoney),

    refunds: {
      /** AWAITING_APPROVAL (default, oldest first), IN_PROGRESS, DONE or ALL. */
      list: async (query: AdminRefundQuery = {}) => {
        const q = checked(RefundQuerySchema, query);
        const params = listParams({ cursor: q.cursor, limit: q.limit });
        params.set('status', q.status);
        return r.get('/admin/refunds', AdminRefundPage, params);
      },
      /** Ask for a refund; someone else approves it. One row per payment it goes back to. */
      request: async (bookingId: string, body: AdminRequestRefundBody, idem: Idempotent) =>
        r.post(
          `/admin/bookings/${idSegment(bookingId)}/refunds`,
          AdminRequestRefundResponse,
          idem,
          checked(RequestRefundSchema, body),
        ),
      /** Approve and send to the gateway (never your own request). */
      approve: async (refundId: string, body: AdminApproveRefundBody, idem: Idempotent) =>
        r.post(
          `/admin/refunds/${idSegment(refundId)}/approve`,
          AdminRefundDecisionResponse,
          idem,
          checked(ApproveSchema, body),
        ),
      reject: async (refundId: string, body: AdminRejectRefundBody, idem: Idempotent) =>
        r.post(
          `/admin/refunds/${idSegment(refundId)}/reject`,
          AdminRefundDecisionResponse,
          idem,
          checked(RejectSchema, body),
        ),
      /** A failed refund: try again. One still processing: ask the gateway again. */
      retry: async (refundId: string, idem: Idempotent) =>
        r.post(`/admin/refunds/${idSegment(refundId)}/retry`, AdminRefundDecisionResponse, idem),
    },

    credits: {
      list: async (query: AdminCreditQuery = {}) => {
        const q = checked(CreditQuerySchema, query);
        const params = listParams({ cursor: q.cursor, limit: q.limit });
        if (q.bookingId) params.set('bookingId', idSegment(q.bookingId));
        return r.get('/admin/credits', AdminCreditPage, params);
      },
      issue: async (bookingId: string, body: AdminIssueCreditBody, idem: Idempotent) =>
        r.post(
          `/admin/bookings/${idSegment(bookingId)}/credits`,
          AdminIssueCreditResponse,
          idem,
          checked(IssueCreditSchema, body),
        ),
    },

    reviews: {
      /** OPEN (default), SETTLED or ALL; newest first. */
      list: async (query: AdminReviewQuery = {}) => {
        const q = checked(ReviewQuerySchema, query);
        const params = listParams({ cursor: q.cursor, limit: q.limit });
        params.set('status', q.status);
        return r.get('/admin/reviews', AdminReviewPage, params);
      },
      /** Exactly once per item. */
      settle: async (eventId: string, body: AdminSettleReviewBody, idem: Idempotent) =>
        r.post(
          `/admin/reviews/${idSegment(eventId)}/settle`,
          AdminSettleReviewResponse,
          idem,
          checked(SettleSchema, body),
        ),
    },
  };
}
