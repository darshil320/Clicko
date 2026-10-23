import {
  BookingDetail,
  BookingSummary,
  type CreateBookingBody,
  CreateBookingResponse,
  type JoinWaitlistBody,
  JoinWaitlistResponse,
  OtpCode,
  PayBookingResponse,
  PhoneE164,
  type QuoteRequestBody,
  QuoteResponse,
  type RequestOtpBody,
  RequestOtpResponse,
  ServiceabilityResult,
  SessionUser,
  type SimulatePaymentBody,
  Uuid,
  type VerifyOtpBody,
  VerifyOtpResponse,
} from '@clickco/contracts';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { createHttp, type HttpOptions } from './http.js';

/** GET /me — the session user without the sign-in-only `isNew` flag. */
export const MeResponse = SessionUser.omit({ isNew: true });
export type MeResponse = z.infer<typeof MeResponse>;

/** Development only: GET /dev/otp/:phone (404 outside NODE_ENV=development). */
export const DevOtpResponse = z.object({ phone: PhoneE164, code: OtpCode });
export type DevOtpResponse = z.infer<typeof DevOtpResponse>;

/** Development only: POST /dev/payments/:paymentId/simulate. */
export const SimulatePaymentResponse = z.object({
  paymentId: z.uuid(),
  event: z.string(),
  eventId: z.string(),
  outcome: z.string(),
});
export type SimulatePaymentResponse = z.infer<typeof SimulatePaymentResponse>;
export type SimulatedOutcome = z.infer<typeof SimulatePaymentBody>['outcome'];

const LoggedOut = z.object({ loggedOut: z.literal(true) });
const BookingList = z.array(BookingSummary);

export interface Idempotent {
  /** One key per user intent; pass the same key again when retrying that intent. */
  readonly idempotencyKey: string;
}

const segment = (value: string): string => encodeURIComponent(value);

/** Booking and payment ids are UUIDs; anything else (e.g. ".." from a deep link) never reaches a path. */
function uuidSegment(value: string): string {
  if (!Uuid.safeParse(value).success) {
    throw new ApiError({
      kind: 'HTTP',
      status: 0,
      code: 'INVALID_ID',
      message: 'That booking link is not valid',
    });
  }
  return value;
}

export type ApiClientOptions = HttpOptions;

/** Typed Clickco API. Framework-agnostic: no React, no storage — the app injects both. */
export function createApiClient(options: ApiClientOptions) {
  const http = createHttp(options);

  return {
    auth: {
      requestOtp: (body: RequestOtpBody) =>
        http.request({
          method: 'POST',
          path: '/auth/otp/request',
          body,
          schema: RequestOtpResponse,
        }),
      verifyOtp: (body: VerifyOtpBody) =>
        http.request({ method: 'POST', path: '/auth/otp/verify', body, schema: VerifyOtpResponse }),
      logout: (refreshToken: string) =>
        http.request({
          method: 'POST',
          path: '/auth/logout',
          body: { refreshToken },
          schema: LoggedOut,
        }),
    },

    me: () => http.request({ method: 'GET', path: '/me', schema: MeResponse, auth: true }),

    serviceability: {
      check: (pincode: string) =>
        http.request({
          method: 'GET',
          path: `/serviceability/${segment(pincode)}`,
          schema: ServiceabilityResult,
        }),
      joinWaitlist: (body: JoinWaitlistBody) =>
        http.request({ method: 'POST', path: '/waitlist', body, schema: JoinWaitlistResponse }),
    },

    pricing: {
      quote: (body: QuoteRequestBody) =>
        http.request({ method: 'POST', path: '/pricing/quote', body, schema: QuoteResponse }),
    },

    bookings: {
      create: (body: CreateBookingBody, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: '/bookings',
          body,
          schema: CreateBookingResponse,
          auth: true,
          idempotencyKey,
        }),
      list: () =>
        http.request({ method: 'GET', path: '/bookings', schema: BookingList, auth: true }),
      get: async (bookingId: string) =>
        http.request({
          method: 'GET',
          path: `/bookings/${uuidSegment(bookingId)}`,
          schema: BookingDetail,
          auth: true,
        }),
      pay: async (bookingId: string, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: `/bookings/${uuidSegment(bookingId)}/pay`,
          schema: PayBookingResponse,
          auth: true,
          idempotencyKey,
        }),
      cancel: async (bookingId: string, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: `/bookings/${uuidSegment(bookingId)}/cancel`,
          schema: BookingSummary,
          auth: true,
          idempotencyKey,
        }),
    },

    /** Development-only endpoints. They answer 404 against any non-development API. */
    dev: {
      latestOtp: (phone: string) =>
        http.request({ method: 'GET', path: `/dev/otp/${segment(phone)}`, schema: DevOtpResponse }),
      simulatePayment: async (paymentId: string, outcome: SimulatedOutcome) =>
        http.request({
          method: 'POST',
          path: `/dev/payments/${uuidSegment(paymentId)}/simulate`,
          body: { outcome },
          schema: SimulatePaymentResponse,
        }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
