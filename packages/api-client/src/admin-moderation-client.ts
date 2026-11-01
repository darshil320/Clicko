import {
  type AdminModerationDecisionBody,
  AdminModerationDetail,
  AdminModerationPage,
  type AdminModerationQuery,
  AdminModerationDecisionBody as DecisionSchema,
  AdminModerationQuery as QuerySchema,
} from '@clickco/contracts';
import { type AdminRequests, checked, idSegment, listParams } from './admin-http.js';
import type { Idempotent } from './client.js';

/**
 * ADR-0027 D4 — `/admin/moderation`: reports of reviews, clients and photographers. A decision
 * (HIDE, KEEP, WARN, DISMISS) carries an Idempotency-Key — one per decision, reused on a retry —
 * and closes every open report on the same target in the caller's cities.
 */
export function adminModerationRoutes(r: AdminRequests) {
  return {
    reports: {
      /** OPEN (default, oldest first), DECIDED or ALL (newest decision first). */
      list: async (query: AdminModerationQuery = {}) => {
        const q = checked(QuerySchema, query);
        const params = listParams({ cursor: q.cursor, limit: q.limit });
        params.set('status', q.status);
        return r.get('/admin/moderation/reports', AdminModerationPage, params);
      },
      /** The report with its target: the review, the person and their record. */
      get: (reportId: string) =>
        r.get(`/admin/moderation/reports/${idSegment(reportId)}`, AdminModerationDetail),
      decide: async (reportId: string, body: AdminModerationDecisionBody, idem: Idempotent) =>
        r.post(
          `/admin/moderation/reports/${idSegment(reportId)}/decide`,
          AdminModerationDetail,
          idem,
          checked(DecisionSchema, body),
        ),
    },
  };
}
