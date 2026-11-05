import {
  BlockedPhotographer,
  BlockedPhotographerList,
  type BlockPhotographerBody,
  BookingDetail,
  BookingSummary,
  type CancelBookingBody,
  CancelBookingResponse,
  CancellationQuote,
  ClientBookingMoney,
  ClientQualityIssue,
  type ClientQualityIssueBody,
  ClientReview,
  ClientTicket,
  type ClientTicketBody,
  ClientTicketList,
  type CreateBookingBody,
  CreateBookingResponse,
  type JoinWaitlistBody,
  JoinWaitlistResponse,
  OtpCode,
  PayBookingResponse,
  PhoneE164,
  type QuoteRequestBody,
  QuoteResponse,
  type ReportBody,
  ReportReceipt,
  type RequestOtpBody,
  RequestOtpResponse,
  type ReviewBody,
  ServiceabilityResult,
  SessionUser,
  type SimulatePaymentBody,
  UnblockResponse,
  Uuid,
  type VerifyOtpBody,
  VerifyOtpResponse,
} from '@clickco/contracts';
import { z } from 'zod';
import { accountApi } from './account-client.js';
import { ApiError } from './errors.js';
import { createHttp, type HttpOptions } from './http.js';
import { notificationSettingsApi, startMaskedCall } from './notifications-client.js';

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
const MaybeReview = ClientReview.nullable();

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

    /** ADR-0030: Profile → "Delete account". */
    account: accountApi(http),

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
      /**
       * What cancelling now would return under the T&C §3 ladder (band, refund and what is kept,
       * in paise, and the reason in plain words), or why it cannot be cancelled now.
       */
      cancellationQuote: async (bookingId: string) =>
        http.request({
          method: 'GET',
          path: `/bookings/${uuidSegment(bookingId)}/cancellation`,
          schema: CancellationQuote,
          auth: true,
        }),
      /**
       * Cancels. Before payment no body is needed. Once anything was paid, send the quote's
       * `refundPaise` as `expectedRefundPaise`: a different figure under the lock is 409
       * CANCELLATION_TERMS_CHANGED (quote again); none at all is 422
       * CANCELLATION_CONFIRMATION_REQUIRED. 409 ALREADY_CANCELLED, CANCEL_NOT_AVAILABLE (the shoot
       * started or its time passed), CANCEL_PAYMENT_SETTLING (retry in a minute).
       */
      cancel: async (bookingId: string, { idempotencyKey }: Idempotent, body?: CancelBookingBody) =>
        http.request({
          method: 'POST',
          path: `/bookings/${uuidSegment(bookingId)}/cancel`,
          ...(body === undefined ? {} : { body }),
          schema: CancelBookingResponse,
          auth: true,
          idempotencyKey,
        }),
      /**
       * ADR-0027 D5: the refunds (once approved) and the credits on this booking of yours. Someone
       * else's booking is 404 BOOKING_NOT_FOUND, like a missing one.
       */
      money: async (bookingId: string) =>
        http.request({
          method: 'GET',
          path: `/bookings/${uuidSegment(bookingId)}/money`,
          schema: ClientBookingMoney,
          auth: true,
        }),
    },

    /**
     * ADR-0027 D5: customer care — support tickets (acknowledged in 48 h, resolved in 30 days)
     * and quality issues on a delivered booking. Writes take one Idempotency-Key per intent: a
     * retried tap replays the first answer instead of raising a second ticket.
     */
    care: {
      /** Your tickets, newest first, with both statutory deadlines. */
      tickets: () =>
        http.request({ method: 'GET', path: '/me/tickets', schema: ClientTicketList, auth: true }),
      /** 429 RATE_LIMITED after 5 in a day; 404 BOOKING_NOT_FOUND for a booking not yours. */
      raiseTicket: (body: ClientTicketBody, { idempotencyKey }: Idempotent) =>
        http.request({
          method: 'POST',
          path: '/me/tickets',
          body,
          schema: ClientTicket,
          auth: true,
          idempotencyKey,
        }),
      /**
       * Within 30 days of delivery, once per booking. 409 BOOKING_NOT_DELIVERED,
       * QUALITY_ISSUE_ALREADY_OPEN or QUALITY_WINDOW_CLOSED.
       */
      reportQualityIssue: async (
        bookingId: string,
        body: ClientQualityIssueBody,
        { idempotencyKey }: Idempotent,
      ) =>
        http.request({
          method: 'POST',
          path: `/bookings/${uuidSegment(bookingId)}/quality-issue`,
          body,
          schema: ClientQualityIssue,
          auth: true,
          idempotencyKey,
        }),
    },

    /** ADR-0027 D4: the client's rating of a delivered booking. */
    reviews: {
      /** The client's review of this booking; null before one is written. */
      mine: async (bookingId: string) =>
        http.request({
          method: 'GET',
          path: `/bookings/${uuidSegment(bookingId)}/review`,
          schema: MaybeReview,
          auth: true,
        }),
      /**
       * Writes the review, or edits it within 7 days of writing it (after that: 409
       * REVIEW_EDIT_WINDOW_CLOSED). Links, emails and phone numbers are removed from the comment.
       */
      save: async (bookingId: string, body: ReviewBody) =>
        http.request({
          method: 'POST',
          path: `/bookings/${uuidSegment(bookingId)}/review`,
          body,
          schema: ClientReview,
          auth: true,
        }),
    },

    /** ADR-0027 D4: report a review, or a photographer about a booking you shared. */
    reports: {
      create: (body: ReportBody) =>
        http.request({ method: 'POST', path: '/reports', body, schema: ReportReceipt, auth: true }),
    },

    /** ADR-0027 D4: photographers this client never wants offered their bookings again. */
    blocks: {
      list: () =>
        http.request({
          method: 'GET',
          path: '/me/blocks',
          schema: BlockedPhotographerList,
          auth: true,
        }),
      /** Idempotent: blocking twice is the same block. */
      block: (body: BlockPhotographerBody) =>
        http.request({
          method: 'POST',
          path: '/me/blocks',
          body,
          schema: BlockedPhotographer,
          auth: true,
        }),
      unblock: async (photographerId: string) =>
        http.request({
          method: 'POST',
          path: `/me/blocks/${uuidSegment(photographerId)}/unblock`,
          schema: UnblockResponse,
          auth: true,
        }),
    },

    /** ADR-0027 D2: this install's push token and the account's notification preferences. */
    notifications: notificationSettingsApi(http, '/me'),

    /** ADR-0027 D3: a masked call to the photographer assigned to this booking. */
    calls: {
      start: async (bookingId: string) =>
        startMaskedCall(http, `/bookings/${uuidSegment(bookingId)}/call`),
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
