import { z } from 'zod';
import { IsoDateTime, Pincode, Uuid } from './common.js';
import { AssignmentStatus, BookingStatus, PlanTier } from './enums.js';
import { Hours, MoneyPaise } from './money.js';

/**
 * On-site operations (ADR-0013): en-route, geofenced check-in/out, extensions, waiting time,
 * incidents, earnings. Money is integer paise (ADR-0007). Every POST from the Pro app may be
 * replayed by its offline queue: send `deviceTs` so a replay is recognised (ADR-0013 D4).
 */

// ── Shared pieces ───────────────────────────────────────────────────────────

/** An `assignment_events.id` (bigserial) as a decimal string. */
export const AssignmentEventId = z.string().regex(/^[1-9]\d{0,17}$/, 'must be an event id');
export type AssignmentEventId = z.infer<typeof AssignmentEventId>;

const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);
/** Reported GPS accuracy (radius, metres). The server refuses check-ins worse than 100 m. */
const AccuracyM = z.number().positive().max(10_000);

/** A device location fix. `offline` = queued on the device while it had no network (G-19). */
export const GeoFixBody = z.object({
  lat: Latitude,
  lng: Longitude,
  accuracyM: AccuracyM,
  /** The device's own clock when the event happened. */
  deviceTs: IsoDateTime.optional(),
  offline: z.boolean().default(false),
});
export type GeoFixBody = z.input<typeof GeoFixBody>;
export type GeoFix = z.output<typeof GeoFixBody>;

export const GeofenceBasis = z.enum(['VENUE', 'PINCODE_CENTROID', 'CITY_CENTRE']);
export type GeofenceBasis = z.infer<typeof GeofenceBasis>;

const Note = z.string().trim().min(3).max(1000);

// ── En-route, check-in, start, check-out ────────────────────────────────────

/** POST /pro/assignments/:assignmentId/en-route */
export const EnRouteResponse = z.object({
  assignmentId: Uuid,
  bookingId: Uuid,
  bookingStatus: z.literal('EN_ROUTE'),
});
export type EnRouteResponse = z.infer<typeof EnRouteResponse>;

/** POST /pro/assignments/:assignmentId/check-in */
export const CheckInBody = GeoFixBody;
export type CheckInBody = GeoFixBody;

export const CheckInResponse = z.object({
  assignmentId: Uuid,
  bookingId: Uuid,
  bookingStatus: z.literal('CHECKED_IN'),
  checkedInAt: IsoDateTime,
  distanceM: z.number().min(0),
  accuracyM: z.number().positive(),
  geofenceBasis: GeofenceBasis,
  /** false = accepted against a fallback point beyond 150 m (ops reviews it). */
  geofenceVerified: z.boolean(),
  offline: z.boolean(),
  /** max(check-in, scheduled start) — T&C §2.6 / ADR-0013 D6. */
  billingStartsAt: IsoDateTime,
  /** true = this exact event was already recorded; nothing was written. */
  replayed: z.boolean(),
});
export type CheckInResponse = z.infer<typeof CheckInResponse>;

/** POST /pro/assignments/:assignmentId/start */
export const StartShootResponse = z.object({
  assignmentId: Uuid,
  bookingId: Uuid,
  bookingStatus: z.literal('IN_PROGRESS'),
});
export type StartShootResponse = z.infer<typeof StartShootResponse>;

/** POST /pro/assignments/:assignmentId/check-out */
export const CheckOutBody = GeoFixBody.extend({
  declaredFrameCount: z.int().min(0).max(100_000),
});
export type CheckOutBody = z.input<typeof CheckOutBody>;

export const CheckOutResponse = z.object({
  assignmentId: Uuid,
  bookingId: Uuid,
  bookingStatus: z.literal('CHECKED_OUT'),
  checkedOutAt: IsoDateTime,
  /** SLA T0 = the check-out (DOMAIN Invariant 2). */
  slaT0: IsoDateTime,
  deliveryDueAt: IsoDateTime,
  distanceM: z.number().min(0),
  geofenceBasis: GeofenceBasis,
  geofenceVerified: z.boolean(),
  declaredFrameCount: z.int().min(0),
  replayed: z.boolean(),
});
export type CheckOutResponse = z.infer<typeof CheckOutResponse>;

// ── Extensions (G-16) ───────────────────────────────────────────────────────

/** POST /pro/assignments/:assignmentId/extensions — one-hour blocks only. */
export const RequestExtensionBody = z.object({
  hours: z.literal(1),
  deviceTs: IsoDateTime.optional(),
});
export type RequestExtensionBody = z.infer<typeof RequestExtensionBody>;

/** An on-site charge with its GST (exactly one of CGST+SGST or IGST is non-zero). */
export const OnsiteChargeAmounts = z.object({
  taxablePaise: MoneyPaise,
  gstPaise: MoneyPaise,
  cgstPaise: MoneyPaise,
  sgstPaise: MoneyPaise,
  igstPaise: MoneyPaise,
  totalPaise: MoneyPaise,
});
export type OnsiteChargeAmounts = z.infer<typeof OnsiteChargeAmounts>;

export const ExtensionStatus = z.enum(['PENDING', 'APPROVED', 'DECLINED', 'EXPIRED']);
export type ExtensionStatus = z.infer<typeof ExtensionStatus>;

export const ExtensionRequestView = z.object({
  eventId: AssignmentEventId,
  assignmentId: Uuid,
  bookingId: Uuid,
  hours: z.literal(1),
  /** Base hourly × category uplift — never surge or emergency (doc 05 §5). */
  hourlyRatePaise: MoneyPaise,
  charge: OnsiteChargeAmounts,
  status: ExtensionStatus,
  requestedAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type ExtensionRequestView = z.infer<typeof ExtensionRequestView>;

/** POST /bookings/:bookingId/extensions/:eventId/approve | decline (the client). */
export const ExtensionDecisionResponse = z.object({
  eventId: AssignmentEventId,
  bookingId: Uuid,
  status: z.enum(['APPROVED', 'DECLINED']),
  /** The new booking_price_snapshots sequence (approve only). */
  snapshotSequence: z.int().min(2).nullable(),
  totalPaise: MoneyPaise,
  balancePaise: MoneyPaise,
});
export type ExtensionDecisionResponse = z.infer<typeof ExtensionDecisionResponse>;

// ── Waiting time (T&C §2.6) ─────────────────────────────────────────────────

/** POST /pro/assignments/:assignmentId/waiting — once per assignment. */
export const LogWaitingBody = z.object({
  minutes: z.int().min(1).max(240),
  note: Note,
  lat: Latitude,
  lng: Longitude,
  deviceTs: IsoDateTime.optional(),
});
export type LogWaitingBody = z.infer<typeof LogWaitingBody>;

export const WaitingLogResponse = z.object({
  eventId: AssignmentEventId,
  minutes: z.int().min(1),
  /** After the grace period and the 60-minute cap. */
  chargeableMinutes: z.int().min(0),
  charge: OnsiteChargeAmounts,
  snapshotSequence: z.int().min(2).nullable(),
  /** More than 60 minutes were claimed: only 60 count, and ops is alerted (T&C §3.8). */
  capped: z.boolean(),
  replayed: z.boolean(),
});
export type WaitingLogResponse = z.infer<typeof WaitingLogResponse>;

// ── Incidents (T&C §7.2, §8.3, §3.8) ────────────────────────────────────────

/** POST …/access-denied and …/unsafe — never refused for a poor GPS fix. */
export const IncidentBody = z.object({
  note: Note,
  lat: Latitude,
  lng: Longitude,
  accuracyM: AccuracyM.optional(),
  deviceTs: IsoDateTime.optional(),
});
export type IncidentBody = z.infer<typeof IncidentBody>;

export const IncidentKind = z.enum(['ACCESS_DENIED', 'UNSAFE_SITE']);
export type IncidentKind = z.infer<typeof IncidentKind>;

export const IncidentReportResponse = z.object({
  eventId: AssignmentEventId,
  assignmentId: Uuid,
  bookingId: Uuid,
  kind: IncidentKind,
  reportedAt: IsoDateTime,
  replayed: z.boolean(),
});
export type IncidentReportResponse = z.infer<typeof IncidentReportResponse>;

/** POST …/client-absent — the client is not there 60 min after the start (geofenced). */
export const ClientAbsentBody = GeoFixBody.extend({ note: Note });
export type ClientAbsentBody = z.input<typeof ClientAbsentBody>;

export const ClientAbsentResponse = CheckOutResponse.extend({ eventId: AssignmentEventId });
export type ClientAbsentResponse = z.infer<typeof ClientAbsentResponse>;

// ── Assignment detail and earnings (Pro app) ────────────────────────────────

export const AssignmentEventKind = z.enum([
  'EXTENSION_REQUESTED',
  'EXTENSION_APPROVED',
  'EXTENSION_DECLINED',
  'WAITING_LOGGED',
  'NOTE',
  'PROOF_UPLOADED',
  'UNSAFE_REPORTED',
  'ACCESS_DENIED_REPORTED',
  'CLIENT_ABSENT_REPORTED',
  'NO_SHOW_SUSPECTED',
  'GEOFENCE_UNVERIFIED',
]);
export type AssignmentEventKind = z.infer<typeof AssignmentEventKind>;

export const AssignmentEventView = z.object({
  eventId: AssignmentEventId,
  kind: AssignmentEventKind,
  minutes: z.int().nullable(),
  amountPaise: MoneyPaise.nullable(),
  note: z.string().nullable(),
  actorKind: z.enum(['SYSTEM', 'USER', 'PHOTOGRAPHER', 'STAFF']),
  occurredAt: IsoDateTime,
});
export type AssignmentEventView = z.infer<typeof AssignmentEventView>;

export const OnsiteFixView = z.object({
  at: IsoDateTime,
  accuracyM: z.number().positive().nullable(),
  offline: z.boolean(),
});
export type OnsiteFixView = z.infer<typeof OnsiteFixView>;

/** GET /pro/assignments/:assignmentId — the address is null once the job is COMPLETED. */
export const ProAssignmentDetail = z.object({
  assignmentId: Uuid,
  bookingId: Uuid,
  bookingReference: z.string(),
  bookingStatus: BookingStatus,
  status: AssignmentStatus,
  categoryCode: z.string(),
  tier: PlanTier,
  scheduledStart: IsoDateTime,
  scheduledHours: Hours,
  payoutPaise: MoneyPaise,
  venue: z.object({
    address: z.string().nullable(),
    landmark: z.string().nullable(),
    pincode: Pincode,
    areaName: z.string().nullable(),
    cityName: z.string(),
  }),
  clientDisplayName: z.string(),
  specialRequirements: z.string().nullable(),
  acceptedAt: IsoDateTime,
  checkIn: OnsiteFixView.extend({ distanceM: z.number().min(0).nullable() }).nullable(),
  checkOut: OnsiteFixView.extend({ declaredFrameCount: z.int().min(0).nullable() }).nullable(),
  billingStartsAt: IsoDateTime.nullable(),
  earliestCheckOutAt: IsoDateTime.nullable(),
  approvedExtensionHours: z.int().min(0),
  pendingExtension: ExtensionRequestView.nullable(),
  events: z.array(AssignmentEventView),
});
export type ProAssignmentDetail = z.infer<typeof ProAssignmentDetail>;

export const EarningsJob = z.object({
  assignmentId: Uuid,
  bookingId: Uuid,
  bookingReference: z.string(),
  categoryCode: z.string(),
  scheduledStart: IsoDateTime,
  checkedOutAt: IsoDateTime,
  /** The accepted offer (a no-show incentive included). */
  basePayoutPaise: MoneyPaise,
  /** Extension and waiting payout shares. */
  extrasPayoutPaise: MoneyPaise,
  totalPayoutPaise: MoneyPaise,
});
export type EarningsJob = z.infer<typeof EarningsJob>;

/** GET /pro/earnings — expected gross payouts; payout batches and TDS arrive in S8. */
export const ProEarnings = z.object({
  basis: z.literal('EXPECTED'),
  asOf: IsoDateTime,
  todayPaise: MoneyPaise,
  weekPaise: MoneyPaise,
  monthPaise: MoneyPaise,
  pendingPayoutPaise: MoneyPaise,
  jobs: z.array(EarningsJob),
});
export type ProEarnings = z.infer<typeof ProEarnings>;

// ── The client's view (optional fields on BookingDetail) ────────────────────

export const BookingPendingExtension = z.object({
  eventId: AssignmentEventId,
  hours: z.literal(1),
  hourlyRatePaise: MoneyPaise,
  charge: OnsiteChargeAmounts,
  requestedAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type BookingPendingExtension = z.infer<typeof BookingPendingExtension>;

/** An approved extension or a waiting charge: one booking_price_snapshots sequence 2+. */
export const BookingCharge = z.object({
  kind: z.enum(['EXTENSION', 'WAITING']),
  snapshotSequence: z.int().min(2),
  /** Chargeable minutes (60 per extension hour). */
  minutes: z.int().min(0),
  charge: OnsiteChargeAmounts,
  chargedAt: IsoDateTime,
});
export type BookingCharge = z.infer<typeof BookingCharge>;

// ── Dev console (development only) ──────────────────────────────────────────

/** GET /dev/assignments/:assignmentId */
export const DevAssignmentView = z.object({
  assignmentId: Uuid,
  bookingId: Uuid,
  bookingStatus: BookingStatus,
  photographerId: Uuid,
  status: AssignmentStatus,
  isReplacement: z.boolean(),
  blockedFrom: IsoDateTime,
  blockedUntil: IsoDateTime,
  acceptedAt: IsoDateTime,
  checkIn: OnsiteFixView.extend({ distanceM: z.number().min(0).nullable() }).nullable(),
  checkOut: OnsiteFixView.extend({ declaredFrameCount: z.int().min(0).nullable() }).nullable(),
  events: z.array(AssignmentEventView),
});
export type DevAssignmentView = z.infer<typeof DevAssignmentView>;

/** POST /dev/assignments/:assignmentId/confirm-incident — staff confirmation lands in S9. */
export const ConfirmIncidentBody = z.object({ kind: IncidentKind });
export type ConfirmIncidentBody = z.infer<typeof ConfirmIncidentBody>;

export const ConfirmIncidentResponse = z.object({
  assignmentId: Uuid,
  bookingId: Uuid,
  bookingStatus: z.enum(['ACCESS_DENIED', 'UNSAFE_SITE']),
});
export type ConfirmIncidentResponse = z.infer<typeof ConfirmIncidentResponse>;
