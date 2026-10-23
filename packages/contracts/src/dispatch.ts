import { z } from 'zod';
import { OtpCode, TokenPair } from './auth.js';
import { IsoDateTime, PhoneE164, Pincode, Uuid } from './common.js';
import {
  AssignmentStatus,
  BookingStatus,
  DispatchOutcome,
  EmergencyBand,
  PlanTier,
} from './enums.js';
import { Hours, MoneyPaise } from './money.js';

/**
 * The photographer side of dispatch (ADR-0010): PRO_LOGIN sessions, offers, assignments, and the
 * development-only dispatch desk view. A photographer never sees a client's phone (Invariant 11);
 * the exact address is revealed only after acceptance.
 */

// ── Pro sessions ────────────────────────────────────────────────────────────

/** POST /pro/auth/otp/request — the same response for every number (no enumeration). */
export const ProOtpRequestBody = z.object({ phone: PhoneE164 });
export type ProOtpRequestBody = z.infer<typeof ProOtpRequestBody>;

export const ProOtpVerifyBody = z.object({
  challengeId: Uuid,
  phone: PhoneE164,
  code: OtpCode,
  deviceId: z.string().min(1).max(128).optional(),
});
export type ProOtpVerifyBody = z.infer<typeof ProOtpVerifyBody>;

export const ProSessionPhotographer = z.object({
  id: Uuid,
  displayName: z.string().min(1),
  cityId: Uuid,
});
export type ProSessionPhotographer = z.infer<typeof ProSessionPhotographer>;

export const ProVerifyOtpResponse = TokenPair.extend({ photographer: ProSessionPhotographer });
export type ProVerifyOtpResponse = z.infer<typeof ProVerifyOtpResponse>;

// ── Offers and assignments ──────────────────────────────────────────────────

/** Where an offered shoot is, before acceptance: pincode and area only, never the address. */
export const OfferArea = z.object({
  pincode: Pincode,
  areaName: z.string().nullable(),
  cityName: z.string(),
});
export type OfferArea = z.infer<typeof OfferArea>;

/** GET /pro/offers item. `payoutPaise` is what this offer pays (snapshot expected payout). */
export const ProOffer = z.object({
  attemptId: Uuid,
  bookingId: Uuid,
  bookingReference: z.string(),
  categoryCode: z.string(),
  tier: PlanTier,
  scheduledStart: IsoDateTime,
  scheduledHours: Hours,
  emergencyBand: EmergencyBand,
  isBroadcast: z.boolean(),
  payoutPaise: MoneyPaise,
  /** Rounded to 0.5 km: enough to judge the trip, not to triangulate the venue. */
  distanceKm: z.number().min(0).multipleOf(0.5).nullable(),
  area: OfferArea,
  /** First name + last initial, e.g. "Ananya I." */
  clientDisplayName: z.string(),
  expiresAt: IsoDateTime,
});
export type ProOffer = z.infer<typeof ProOffer>;

/** POST /pro/offers/:attemptId/decline. */
export const DeclineOfferBody = z.object({ reason: z.string().trim().min(1).max(200).optional() });
export type DeclineOfferBody = z.infer<typeof DeclineOfferBody>;

export const DeclineOfferResponse = z.object({
  attemptId: Uuid,
  outcome: z.literal('DECLINED'),
});
export type DeclineOfferResponse = z.infer<typeof DeclineOfferResponse>;

/**
 * POST /pro/offers/:attemptId/accept. IDs only (ADR-0012): an idempotent replay can never re-reveal
 * an address after the assignment ends. Details come from GET /pro/assignments, which lists only
 * active assignments.
 */
export const AcceptOfferResponse = z.object({
  attemptId: Uuid,
  assignmentId: Uuid,
  bookingId: Uuid,
  status: z.literal('ASSIGNED'),
});
export type AcceptOfferResponse = z.infer<typeof AcceptOfferResponse>;

/** GET /pro/assignments item: the venue address (phone numbers masked) after acceptance. */
export const ProAssignment = z.object({
  assignmentId: Uuid,
  bookingId: Uuid,
  bookingReference: z.string(),
  status: AssignmentStatus,
  categoryCode: z.string(),
  tier: PlanTier,
  scheduledStart: IsoDateTime,
  scheduledHours: Hours,
  payoutPaise: MoneyPaise,
  venue: z.object({
    address: z.string(),
    landmark: z.string().nullable(),
    pincode: Pincode,
    areaName: z.string().nullable(),
    cityName: z.string(),
  }),
  clientDisplayName: z.string(),
  specialRequirements: z.string().nullable(),
  acceptedAt: IsoDateTime,
});
export type ProAssignment = z.infer<typeof ProAssignment>;

/** POST /pro/assignments/:assignmentId/cancel — the booking goes back to dispatch (ADR-0011). */
export const CancelAssignmentBody = z.object({ reason: z.string().trim().min(3).max(500) });
export type CancelAssignmentBody = z.infer<typeof CancelAssignmentBody>;

export const CancelAssignmentResponse = z.object({
  assignmentId: Uuid,
  status: z.literal('RELEASED'),
});
export type CancelAssignmentResponse = z.infer<typeof CancelAssignmentResponse>;

// ── Dispatch desk (development only: GET /dev/dispatch/bookings/:id) ───────

export const DispatchAttemptView = z.object({
  attemptId: Uuid,
  photographerId: Uuid,
  photographerName: z.string(),
  rankScore: z.number().nullable(),
  distanceKm: z.number().nullable(),
  offeredPayoutPaise: MoneyPaise,
  notifiedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  respondedAt: IsoDateTime.nullable(),
  outcome: DispatchOutcome,
  declineReason: z.string().nullable(),
});
export type DispatchAttemptView = z.infer<typeof DispatchAttemptView>;

export const DispatchRoundView = z.object({
  roundId: Uuid,
  wave: z.int().min(1),
  radiusKm: z.number().min(0),
  candidateCount: z.int().min(0),
  windowSeconds: z.int().min(1),
  isBroadcast: z.boolean(),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  outcome: z.enum(['FILLED', 'EXHAUSTED', 'CANCELLED']).nullable(),
  attempts: z.array(DispatchAttemptView),
});
export type DispatchRoundView = z.infer<typeof DispatchRoundView>;

export const DispatchAssignmentView = z.object({
  assignmentId: Uuid,
  photographerId: Uuid,
  photographerName: z.string(),
  status: AssignmentStatus,
  blockedFrom: IsoDateTime,
  blockedUntil: IsoDateTime,
  acceptedAt: IsoDateTime,
  releasedAt: IsoDateTime.nullable(),
  releaseReason: z.string().nullable(),
});
export type DispatchAssignmentView = z.infer<typeof DispatchAssignmentView>;

export const DispatchDeskView = z.object({
  bookingId: Uuid,
  bookingStatus: BookingStatus,
  rounds: z.array(DispatchRoundView),
  assignments: z.array(DispatchAssignmentView),
});
export type DispatchDeskView = z.infer<typeof DispatchDeskView>;
