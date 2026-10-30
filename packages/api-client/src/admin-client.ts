import {
  AdminAlertPage,
  type AdminAttributeBreachBody,
  AdminBookingDetailWithAudit,
  AdminBookingPage,
  type AdminBookingQuery,
  AdminBreachDecisionResponse,
  AdminBreachPage,
  type AdminBreachQuery,
  AdminCityList,
  type AdminConfirmIncidentBody,
  AdminConfirmIncidentResponse,
  type AdminCreateStaffBody,
  AdminCreateStaffResponse,
  AdminDispatchDetail,
  AdminDispatchPage,
  type AdminGrantBody,
  AdminIncidentPage,
  type AdminListQuery,
  AdminLogoutResponse,
  type AdminQaDecisionBody,
  AdminQaDecisionResponse,
  AdminQaPage,
  AdminResetPasswordResponse,
  AdminStaffChangeResponse,
  AdminStaffPage,
  type AdminWaiveBreachBody,
  AdminAttributeBreachBody as AttributeBreachSchema,
  AdminBookingQuery as BookingQuerySchema,
  AdminBreachQuery as BreachQuerySchema,
  AdminConfirmIncidentBody as ConfirmIncidentSchema,
  AdminCreateStaffBody as CreateStaffSchema,
  AdminGrantBody as GrantSchema,
  AdminQaDecisionBody as QaDecisionSchema,
  StaffChangePasswordBody,
  StaffChangePasswordResponse,
  StaffLoginBody,
  StaffLoginChallenge,
  StaffProfile,
  StaffSessionResponse,
  StaffTotpBody,
  AdminWaiveBreachBody as WaiveBreachSchema,
} from '@clickco/contracts';
import type { z } from 'zod';
import { adminCareRoutes } from './admin-care-client.js';
import { adminRequests, checked, idSegment, listParams, withQuery } from './admin-http.js';
import { adminMoneyRoutes } from './admin-money-client.js';
import { adminOverviewRoutes } from './admin-overview-client.js';
import { adminPayoutsRoutes } from './admin-payouts-client.js';
import { adminPricingRoutes } from './admin-pricing-client.js';
import { adminSupplyRoutes } from './admin-supply-client.js';
import type { Idempotent } from './client.js';
import { createHttp, type HttpOptions } from './http.js';

/** Staff sessions refresh here (ADR-0025 D2), never at the client's or the Pro app's route. */
export const ADMIN_REFRESH_PATH = '/admin/auth/refresh';

/**
 * `GET /admin/bookings` query string. Statuses repeat (`status=A&status=B`); `needsAttention`
 * is only sent when on. The query is validated against the contract first.
 */
export function adminBookingSearch(query: AdminBookingQuery): string {
  const q = checked(BookingQuerySchema, query);
  const params = new URLSearchParams();
  for (const status of q.status ?? []) params.append('status', status);
  if (q.cityId) params.set('cityId', q.cityId);
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  if (q.q) params.set('q', q.q);
  if (q.needsAttention) params.set('needsAttention', 'true');
  if (q.cursor) params.set('cursor', q.cursor);
  params.set('limit', String(q.limit));
  return params.toString();
}

export type AdminApiClientOptions = Omit<HttpOptions, 'refreshPath'>;

/**
 * Typed `/admin/*` API for the staff panel (ADR-0025 D5). Every mutating admin POST carries an
 * Idempotency-Key — reuse one key for the retries of one decision. The server enforces roles and
 * cities (D3); the client only validates shapes.
 */
export function createAdminApiClient(options: AdminApiClientOptions) {
  const http = createHttp({ ...options, refreshPath: ADMIN_REFRESH_PATH });

  const list = <T>(path: string, schema: z.ZodType<T>, params: URLSearchParams) =>
    http.request({ method: 'GET', path: withQuery(path, params), schema, auth: true });

  const post = <T>(
    path: string,
    schema: z.ZodType<T>,
    { idempotencyKey }: Idempotent,
    body?: unknown,
  ) =>
    http.request({
      method: 'POST',
      path,
      schema,
      auth: true,
      idempotencyKey,
      ...(body === undefined ? {} : { body }),
    });

  const r = adminRequests(http);

  return {
    /** Sprint 10 desk areas (ADR-0026 D9), one file each. */
    money: adminMoneyRoutes(r),
    payouts: adminPayoutsRoutes(r),
    supply: adminSupplyRoutes(r),
    care: adminCareRoutes(r),
    pricing: adminPricingRoutes(r),
    overview: adminOverviewRoutes(r),

    auth: {
      /** Step 1: email + password → a TOTP (or enrolment) challenge. */
      login: async (body: StaffLoginBody) =>
        http.request({
          method: 'POST',
          path: '/admin/auth/login',
          body: checked(StaffLoginBody, body),
          schema: StaffLoginChallenge,
        }),
      /** Step 2: the authenticator code → the staff session. */
      totp: async (body: StaffTotpBody) =>
        http.request({
          method: 'POST',
          path: '/admin/auth/totp',
          body: checked(StaffTotpBody, body),
          schema: StaffSessionResponse,
        }),
      /**
       * ADR-0026 D7: the signed-in person changes their password (current + new + authenticator
       * code). Every session ends server-side; the new one in the answer replaces this tab's.
       * Not idempotent on purpose: the answer holds tokens, which must never be stored.
       */
      changePassword: async (body: StaffChangePasswordBody) => {
        const pair = await http.request({
          method: 'POST',
          path: '/admin/me/password',
          body: checked(StaffChangePasswordBody, body),
          schema: StaffChangePasswordResponse,
          auth: true,
        });
        options.tokens?.setTokens(pair);
        return pair;
      },
      /** Revokes the refresh token server-side. */
      logout: (refreshToken: string) =>
        http.request({
          method: 'POST',
          path: '/admin/auth/logout',
          body: { refreshToken },
          schema: AdminLogoutResponse,
        }),
    },

    me: () => http.request({ method: 'GET', path: '/admin/me', schema: StaffProfile, auth: true }),

    /** Cities the caller may work in (every city for an all-cities grant). */
    cities: () =>
      http.request({ method: 'GET', path: '/admin/cities', schema: AdminCityList, auth: true }),

    bookings: {
      list: async (query: AdminBookingQuery = {}) =>
        http.request({
          method: 'GET',
          path: `/admin/bookings?${adminBookingSearch(query)}`,
          schema: AdminBookingPage,
          auth: true,
        }),
      get: async (bookingId: string) =>
        http.request({
          method: 'GET',
          path: `/admin/bookings/${idSegment(bookingId)}`,
          schema: AdminBookingDetailWithAudit,
          auth: true,
        }),
    },

    qa: {
      /** The queue, oldest due first. */
      list: async (query: AdminListQuery = {}) => list('/admin/qa', AdminQaPage, listParams(query)),
      decide: async (bookingId: string, body: AdminQaDecisionBody, idem: Idempotent) =>
        post(
          `/admin/qa/${idSegment(bookingId)}`,
          AdminQaDecisionResponse,
          idem,
          checked(QaDecisionSchema, body),
        ),
    },

    incidents: {
      /** Reports not yet confirmed. */
      list: async (query: AdminListQuery = {}) =>
        list('/admin/incidents', AdminIncidentPage, listParams(query)),
      confirm: async (assignmentId: string, body: AdminConfirmIncidentBody, idem: Idempotent) =>
        post(
          `/admin/assignments/${idSegment(assignmentId)}/confirm-incident`,
          AdminConfirmIncidentResponse,
          idem,
          checked(ConfirmIncidentSchema, body),
        ),
    },

    dispatch: {
      /** DISPATCHING bookings with their wave, offers and deadline. */
      list: async (query: AdminListQuery = {}) =>
        list('/admin/dispatch', AdminDispatchPage, listParams(query)),
      get: async (bookingId: string) =>
        http.request({
          method: 'GET',
          path: `/admin/dispatch/${idSegment(bookingId)}`,
          schema: AdminDispatchDetail,
          auth: true,
        }),
    },

    breaches: {
      /** OPEN (default: neither waived nor applied), WAIVED or ALL. */
      list: async (query: AdminBreachQuery = {}) => {
        const q = checked(BreachQuerySchema, query);
        const params = listParams({ cursor: q.cursor, limit: q.limit });
        params.set('status', q.status);
        return list('/admin/breaches', AdminBreachPage, params);
      },
      attribute: async (breachId: string, body: AdminAttributeBreachBody, idem: Idempotent) =>
        post(
          `/admin/breaches/${idSegment(breachId)}/attribute`,
          AdminBreachDecisionResponse,
          idem,
          checked(AttributeBreachSchema, body),
        ),
      waive: async (breachId: string, body: AdminWaiveBreachBody, idem: Idempotent) =>
        post(
          `/admin/breaches/${idSegment(breachId)}/waive`,
          AdminBreachDecisionResponse,
          idem,
          checked(WaiveBreachSchema, body),
        ),
    },

    alerts: {
      /** ops.alert and *.needs_review events, newest first. */
      list: async (query: AdminListQuery = {}) =>
        list('/admin/alerts', AdminAlertPage, listParams(query)),
    },

    /** SUPER_ADMIN only. */
    staff: {
      list: async (query: AdminListQuery = {}) =>
        list('/admin/staff', AdminStaffPage, listParams(query)),
      /** The answer holds the temporary password, once. */
      create: async (body: AdminCreateStaffBody, idem: Idempotent) =>
        post('/admin/staff', AdminCreateStaffResponse, idem, checked(CreateStaffSchema, body)),
      grant: async (staffId: string, body: AdminGrantBody, idem: Idempotent) =>
        post(
          `/admin/staff/${idSegment(staffId)}/grants`,
          AdminStaffChangeResponse,
          idem,
          checked(GrantSchema, body),
        ),
      revokeGrant: async (staffId: string, grantId: string, idem: Idempotent) =>
        post(
          `/admin/staff/${idSegment(staffId)}/grants/${idSegment(grantId)}/revoke`,
          AdminStaffChangeResponse,
          idem,
        ),
      deactivate: async (staffId: string, idem: Idempotent) =>
        post(`/admin/staff/${idSegment(staffId)}/deactivate`, AdminStaffChangeResponse, idem),
      resetTotp: async (staffId: string, idem: Idempotent) =>
        post(`/admin/staff/${idSegment(staffId)}/reset-totp`, AdminStaffChangeResponse, idem),
      /**
       * ADR-0026 D7: a new temporary password (72 h), shown once; their sessions end. Not
       * idempotent on purpose: the answer holds the password, which must never be stored.
       */
      resetPassword: async (staffId: string) =>
        http.request({
          method: 'POST',
          path: `/admin/staff/${idSegment(staffId)}/reset-password`,
          schema: AdminResetPasswordResponse,
          auth: true,
        }),
    },
  };
}

export type AdminApiClient = ReturnType<typeof createAdminApiClient>;
