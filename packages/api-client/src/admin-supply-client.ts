import {
  AdminApplicationBoard,
  AdminApplicationCard,
  AdminApplicationDetail,
  type AdminApplicationQuery,
  type AdminCreateApplicantBody,
  AdminDocumentLink,
  type AdminKycDecisionBody,
  AdminKycDecisionResponse,
  AdminKycPage,
  type AdminListQuery,
  type AdminMoveApplicationBody,
  AdminPenalty,
  AdminPhotographerPage,
  AdminPhotographerProfile,
  type AdminPhotographerQuery,
  type AdminPhotographerStatusBody,
  type AdminWaivePenaltyBody,
  AdminApplicationQuery as ApplicationQuerySchema,
  AdminCreateApplicantBody as CreateApplicantSchema,
  AdminKycDecisionBody as KycDecisionSchema,
  AdminMoveApplicationBody as MoveSchema,
  AdminPhotographerQuery as PhotographerQuerySchema,
  AdminPhotographerStatusBody as StatusSchema,
  AdminWaivePenaltyBody as WaiveSchema,
} from '@clickco/contracts';
import { type AdminRequests, checked, idSegment, invalid, listParams } from './admin-http.js';
import type { Idempotent } from './client.js';

/** Clickco's own KYC view path (audit M2); anything else is refused before it leaves. */
const KYC_VIEW_PATH = /^\/admin\/supply\/kyc\/view\/[A-Za-z0-9_-]{43}$/;

/**
 * ADR-0026 stream C — `/admin/supply`: the onboarding kanban, the KYC queue, the photographer
 * directory, penalty waivers and status changes. Every POST carries an Idempotency-Key (one per
 * decision, reused on retry) — except a KYC document link, which is a fresh audited view each time.
 */
export function adminSupplyRoutes(r: AdminRequests) {
  return {
    applications: {
      /** Every stage as a kanban column, longest-waiting first. */
      board: async (query: AdminApplicationQuery = {}) => {
        const q = checked(ApplicationQuerySchema, query);
        const params = new URLSearchParams();
        if (q.cityId) params.set('cityId', q.cityId);
        if (q.q) params.set('q', q.q);
        return r.get('/admin/supply/applications', AdminApplicationBoard, params);
      },
      get: (applicationId: string) =>
        r.get(`/admin/supply/applications/${idSegment(applicationId)}`, AdminApplicationDetail),
      /** Every move needs a reason; approving or rejecting is a city manager's call. */
      move: async (applicationId: string, body: AdminMoveApplicationBody, idem: Idempotent) =>
        r.post(
          `/admin/supply/applications/${idSegment(applicationId)}/move`,
          AdminApplicationCard,
          idem,
          checked(MoveSchema, body),
        ),
      /** A walk-in, referral or outreach applicant. */
      create: async (body: AdminCreateApplicantBody, idem: Idempotent) =>
        r.post(
          '/admin/supply/applicants',
          AdminApplicationCard,
          idem,
          checked(CreateApplicantSchema, body),
        ),
    },

    kyc: {
      /** Pending documents, oldest first. */
      list: async (query: AdminListQuery = {}) =>
        r.get('/admin/supply/kyc', AdminKycPage, listParams(query)),
      /**
       * A single-use, 5-minute Clickco path for this staff member (audit M2: never a provider
       * URL); every call is an audited view. Open it at once with `openDocument`.
       */
      viewLink: (documentId: string, idem: Idempotent) =>
        r.post(`/admin/supply/kyc/${idSegment(documentId)}/view-link`, AdminDocumentLink, idem),
      /** The document's bytes through the staff session (consumes the path; audited per open). */
      openDocument: async (path: string) => {
        if (!KYC_VIEW_PATH.test(path)) throw invalid('INVALID_INPUT', 'Not a document link');
        return r.getBytes(path);
      },
      decide: async (documentId: string, body: AdminKycDecisionBody, idem: Idempotent) =>
        r.post(
          `/admin/supply/kyc/${idSegment(documentId)}/decide`,
          AdminKycDecisionResponse,
          idem,
          checked(KycDecisionSchema, body),
        ),
    },

    photographers: {
      /** Alphabetical; search by name or phone, filter by city and status. */
      list: async (query: AdminPhotographerQuery = {}) => {
        const q = checked(PhotographerQuerySchema, query);
        const params = listParams({ cursor: q.cursor, limit: q.limit });
        if (q.q) params.set('q', q.q);
        if (q.cityId) params.set('cityId', q.cityId);
        if (q.status) params.set('status', q.status);
        return r.get('/admin/supply/photographers', AdminPhotographerPage, params);
      },
      get: (photographerId: string) =>
        r.get(`/admin/supply/photographers/${idSegment(photographerId)}`, AdminPhotographerProfile),
      /** Pause, reactivate, suspend or offboard, with a reason. */
      changeStatus: async (
        photographerId: string,
        body: AdminPhotographerStatusBody,
        idem: Idempotent,
      ) =>
        r.post(
          `/admin/supply/photographers/${idSegment(photographerId)}/status`,
          AdminPhotographerProfile,
          idem,
          checked(StatusSchema, body),
        ),
    },

    penalties: {
      waive: async (penaltyId: string, body: AdminWaivePenaltyBody, idem: Idempotent) =>
        r.post(
          `/admin/supply/penalties/${idSegment(penaltyId)}/waive`,
          AdminPenalty,
          idem,
          checked(WaiveSchema, body),
        ),
    },
  };
}
