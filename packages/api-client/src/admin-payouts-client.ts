import {
  type AdminCreatePayoutBatchBody,
  type AdminMarkPayoutFailedBody,
  type AdminMarkPayoutsPaidBody,
  AdminPayoutBatchDetail,
  AdminPayoutBatchDiscarded,
  AdminPayoutBatchPage,
  type AdminPayoutBatchQuery,
  AdminPayoutFile,
  AdminPayoutsDue,
  type AdminRetryPayoutBody,
  type AdminTdsQuery,
  AdminTdsSummary,
  AdminCreatePayoutBatchBody as CreateBatchSchema,
  AdminMarkPayoutFailedBody as MarkFailedSchema,
  AdminMarkPayoutsPaidBody as MarkPaidSchema,
  AdminRetryPayoutBody as RetrySchema,
  TdsMonth,
  AdminTdsQuery as TdsQuerySchema,
} from '@clickco/contracts';
import { type AdminRequests, checked, idSegment, listParams } from './admin-http.js';
import type { Idempotent } from './client.js';

/**
 * ADR-0026 stream B — `/admin/payouts`: Due, batches (draft → export → paid), the bank file,
 * statements and the TDS report. Files come back as CSV text inside the JSON envelope
 * (`AdminPayoutFile`); the panel turns them into a download. FINANCE / SUPER_ADMIN only.
 */
export function adminPayoutsRoutes(r: AdminRequests) {
  const batch = (batchId: string) => `/admin/payouts/batches/${idSegment(batchId)}`;
  return {
    /** Everything due now, what a batch would take, and who is blocked on bank details. */
    due: async () => r.get('/admin/payouts/due', AdminPayoutsDue),
    batches: {
      list: async (query: AdminPayoutBatchQuery = {}) =>
        r.get('/admin/payouts/batches', AdminPayoutBatchPage, listParams(query)),
      get: async (batchId: string) => r.get(batch(batchId), AdminPayoutBatchDetail),
      /** A draft of everything due now (one draft at a time). */
      create: async (body: AdminCreatePayoutBatchBody, idem: Idempotent) =>
        r.post(
          '/admin/payouts/batches',
          AdminPayoutBatchDetail,
          idem,
          checked(CreateBatchSchema, body),
        ),
      discard: async (batchId: string, idem: Idempotent) =>
        r.post(`${batch(batchId)}/discard`, AdminPayoutBatchDiscarded, idem),
      /** Locks the amounts and books them; the bank file can then be downloaded. */
      export: async (batchId: string, idem: Idempotent) =>
        r.post(`${batch(batchId)}/export`, AdminPayoutBatchDetail, idem),
      markPaid: async (batchId: string, body: AdminMarkPayoutsPaidBody, idem: Idempotent) =>
        r.post(
          `${batch(batchId)}/mark-paid`,
          AdminPayoutBatchDetail,
          idem,
          checked(MarkPaidSchema, body),
        ),
      markFailed: async (batchId: string, body: AdminMarkPayoutFailedBody, idem: Idempotent) =>
        r.post(
          `${batch(batchId)}/mark-failed`,
          AdminPayoutBatchDetail,
          idem,
          checked(MarkFailedSchema, body),
        ),
      retry: async (batchId: string, body: AdminRetryPayoutBody, idem: Idempotent) =>
        r.post(`${batch(batchId)}/retry`, AdminPayoutBatchDetail, idem, checked(RetrySchema, body)),
      /**
       * The next bulk-NEFT file: every transfer not yet in one (audited). Each transfer goes into
       * exactly one file; a repeat answers 409 NOTHING_NEW, never a second file. The server does
       * not store this answer (it holds account numbers), so the key only labels the attempt.
       */
      createBankFile: async (batchId: string, idem: Idempotent) =>
        r.post(`${batch(batchId)}/bank-file`, AdminPayoutFile, idem),
      /** Self-billed payout statement, one photographer (audited). */
      statement: async (batchId: string, photographerId: string) =>
        r.get(`${batch(batchId)}/statements/${idSegment(photographerId)}`, AdminPayoutFile),
    },
    tds: {
      summary: async (query: AdminTdsQuery = {}) => {
        const q = checked(TdsQuerySchema, query);
        const params = new URLSearchParams();
        if (q.fy) params.set('fy', q.fy);
        return r.get('/admin/payouts/tds', AdminTdsSummary, params);
      },
      /** Every payout credited in the month, for the CA (audited). */
      report: async (month: string) =>
        r.get(`/admin/payouts/tds/${checked(TdsMonth, month)}/report`, AdminPayoutFile),
    },
  };
}
