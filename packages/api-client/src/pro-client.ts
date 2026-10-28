import {
  AcceptOfferResponse,
  CancelAssignmentResponse,
  type CheckInBody,
  CheckInResponse,
  type CheckOutBody,
  CheckOutResponse,
  type ClientAbsentBody,
  ClientAbsentResponse,
  type DeclineOfferBody,
  DeclineOfferResponse,
  EnRouteResponse,
  ExtensionRequestView,
  type IncidentBody,
  IncidentReportResponse,
  type LogWaitingBody,
  ProAssignment,
  ProAssignmentDetail,
  ProEarnings,
  ProOffer,
  type ProOtpVerifyBody,
  ProUploadJob,
  ProVerifyOtpResponse,
  RequestOtpResponse,
  StartShootResponse,
  Uuid,
  WaitingLogResponse,
} from '@clickco/contracts';
import { z } from 'zod';
import { DevOtpResponse, type Idempotent } from './client.js';
import { ApiError } from './errors.js';
import { createHttp, type HttpOptions } from './http.js';

/** The Pro app refreshes its photographer session here, not at the client's /auth/refresh. */
export const PRO_REFRESH_PATH = '/pro/auth/refresh';

const LoggedOut = z.object({ loggedOut: z.literal(true) });
const OfferList = z.array(ProOffer);
const AssignmentList = z.array(ProAssignment);
const UploadJobList = z.array(ProUploadJob);

/** Offer, assignment and booking ids are UUIDs; anything else never reaches a path. */
function idSegment(value: string): string {
  if (!Uuid.safeParse(value).success) {
    throw new ApiError({
      kind: 'HTTP',
      status: 0,
      code: 'INVALID_ID',
      message: 'That job link is not valid',
    });
  }
  return value;
}

export type ProApiClientOptions = Omit<HttpOptions, 'refreshPath'>;

/**
 * Typed `/pro/*` API for the Clickco Pro app (ADR-0024 D2). Every on-site POST is @Idempotent on
 * the server (10 min) and, with `deviceTs`, safe to replay from the offline queue later (ADR-0013 D4).
 */
export function createProApiClient(options: ProApiClientOptions) {
  const http = createHttp({ ...options, refreshPath: PRO_REFRESH_PATH });
  const onsite = (assignmentId: string, action: string) =>
    `/pro/assignments/${idSegment(assignmentId)}/${action}`;

  return {
    auth: {
      requestOtp: (phone: string) =>
        http.request({
          method: 'POST',
          path: '/pro/auth/otp/request',
          body: { phone },
          schema: RequestOtpResponse,
        }),
      verifyOtp: (body: ProOtpVerifyBody) =>
        http.request({
          method: 'POST',
          path: '/pro/auth/otp/verify',
          body,
          schema: ProVerifyOtpResponse,
        }),
      logout: (refreshToken: string) =>
        http.request({
          method: 'POST',
          path: '/pro/auth/logout',
          body: { refreshToken },
          schema: LoggedOut,
        }),
    },

    offers: {
      list: () =>
        http.request({ method: 'GET', path: '/pro/offers', schema: OfferList, auth: true }),
      accept: async (attemptId: string, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: `/pro/offers/${idSegment(attemptId)}/accept`,
          schema: AcceptOfferResponse,
          auth: true,
          idempotencyKey,
        }),
      decline: async (attemptId: string, body: DeclineOfferBody) =>
        http.request({
          method: 'POST',
          path: `/pro/offers/${idSegment(attemptId)}/decline`,
          body,
          schema: DeclineOfferResponse,
          auth: true,
        }),
    },

    assignments: {
      /** Active assignments only, with the venue address. */
      list: () =>
        http.request({
          method: 'GET',
          path: '/pro/assignments',
          schema: AssignmentList,
          auth: true,
        }),
      get: async (assignmentId: string) =>
        http.request({
          method: 'GET',
          path: `/pro/assignments/${idSegment(assignmentId)}`,
          schema: ProAssignmentDetail,
          auth: true,
        }),
      cancel: async (assignmentId: string, reason: string, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'cancel'),
          body: { reason },
          schema: CancelAssignmentResponse,
          auth: true,
          idempotencyKey,
        }),
    },

    /** On-site actions (ADR-0013). Send `deviceTs` so an offline replay is recognised. */
    onsite: {
      enRoute: async (assignmentId: string, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'en-route'),
          schema: EnRouteResponse,
          auth: true,
          idempotencyKey,
        }),
      checkIn: async (assignmentId: string, body: CheckInBody, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'check-in'),
          body,
          schema: CheckInResponse,
          auth: true,
          idempotencyKey,
        }),
      start: async (assignmentId: string, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'start'),
          schema: StartShootResponse,
          auth: true,
          idempotencyKey,
        }),
      checkOut: async (assignmentId: string, body: CheckOutBody, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'check-out'),
          body,
          schema: CheckOutResponse,
          auth: true,
          idempotencyKey,
        }),
      requestExtension: async (
        assignmentId: string,
        deviceTs: string | undefined,
        { idempotencyKey }: Idempotent,
      ) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'extensions'),
          body: { hours: 1, deviceTs },
          schema: ExtensionRequestView,
          auth: true,
          idempotencyKey,
        }),
      logWaiting: async (
        assignmentId: string,
        body: LogWaitingBody,
        { idempotencyKey }: Idempotent,
      ) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'waiting'),
          body,
          schema: WaitingLogResponse,
          auth: true,
          idempotencyKey,
        }),
      reportAccessDenied: async (
        assignmentId: string,
        body: IncidentBody,
        { idempotencyKey }: Idempotent,
      ) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'access-denied'),
          body,
          schema: IncidentReportResponse,
          auth: true,
          idempotencyKey,
        }),
      reportUnsafe: async (
        assignmentId: string,
        body: IncidentBody,
        { idempotencyKey }: Idempotent,
      ) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'unsafe'),
          body,
          schema: IncidentReportResponse,
          auth: true,
          idempotencyKey,
        }),
      reportClientAbsent: async (
        assignmentId: string,
        body: ClientAbsentBody,
        { idempotencyKey }: Idempotent,
      ) =>
        http.request({
          method: 'POST',
          path: onsite(assignmentId, 'client-absent'),
          body,
          schema: ClientAbsentResponse,
          auth: true,
          idempotencyKey,
        }),
    },

    earnings: () =>
      http.request({ method: 'GET', path: '/pro/earnings', schema: ProEarnings, auth: true }),

    /** Shoots waiting for their upload (done from a computer, through the web portal). */
    uploadJobs: () =>
      http.request({ method: 'GET', path: '/pro/upload-jobs', schema: UploadJobList, auth: true }),

    /** Development-only endpoints. They answer 404 against any non-development API. */
    dev: {
      latestOtp: (phone: string) =>
        http.request({
          method: 'GET',
          path: `/dev/otp/${encodeURIComponent(phone)}`,
          schema: DevOtpResponse,
        }),
    },
  };
}

export type ProApiClient = ReturnType<typeof createProApiClient>;
