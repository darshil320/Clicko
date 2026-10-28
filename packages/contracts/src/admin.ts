import { z } from 'zod';
import { TokenPair } from './auth.js';
import { IsoDateTime, Uuid } from './common.js';
import { QaResult, QaStatus, SlaBreachView, SlaClockView } from './delivery.js';
import { DispatchDeskView } from './dispatch.js';
import { AssignmentStatus, BookingStatus, EmergencyBand, PlanTier, StaffRole } from './enums.js';
import { MoneyPaise } from './money.js';
import { AssignmentEventView } from './onsite.js';

/**
 * ADR-0025 — the staff admin panel, Sprint 9: staff sign-in with mandatory TOTP, role + city
 * scoped access, and the ops desks. Every mutating /admin route is audited (audit_logs).
 */

// ── Staff sign-in ───────────────────────────────────────────────────────────

export const StaffEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** POST /admin/auth/login — step 1. The same answer shape whatever is wrong (no enumeration). */
export const StaffLoginBody = z.object({
  email: StaffEmail,
  password: z.string().min(1).max(256),
});
export type StaffLoginBody = z.infer<typeof StaffLoginBody>;

/** Step 1 passed: prove the second factor (TOTP), enrolling it first if the account has none. */
export const StaffLoginChallenge = z.object({
  challengeId: Uuid,
  step: z.enum(['TOTP', 'ENROL_TOTP']),
  /** Only for ENROL_TOTP: the secret to add to an authenticator app, once. */
  enrolment: z
    .object({
      secret: z.string().regex(/^[A-Z2-7]+=*$/, 'must be base32'),
      otpauthUri: z.string().startsWith('otpauth://totp/'),
    })
    .nullable(),
  expiresAt: IsoDateTime,
});
export type StaffLoginChallenge = z.infer<typeof StaffLoginChallenge>;

/** POST /admin/auth/totp — step 2. */
export const StaffTotpBody = z.object({
  challengeId: Uuid,
  code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
});
export type StaffTotpBody = z.infer<typeof StaffTotpBody>;

export const StaffGrant = z.object({
  role: StaffRole,
  /** null = every city. CITY_MANAGER is always scoped. */
  cityId: Uuid.nullable(),
  cityName: z.string().nullable(),
});
export type StaffGrant = z.infer<typeof StaffGrant>;

export const StaffProfile = z.object({
  id: Uuid,
  email: z.string(),
  fullName: z.string(),
  grants: z.array(StaffGrant),
});
export type StaffProfile = z.infer<typeof StaffProfile>;

export const StaffSessionResponse = TokenPair.extend({ staff: StaffProfile });
export type StaffSessionResponse = z.infer<typeof StaffSessionResponse>;

// ── Lists ───────────────────────────────────────────────────────────────────

/** Opaque keyset cursor for every admin list. */
export const AdminCursor = z.string().max(512);

export const AdminPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: AdminCursor.nullable() });

// ── Booking board ───────────────────────────────────────────────────────────

/** GET /admin/bookings query. Dates are IST calendar days on the scheduled start. */
export const AdminBookingQuery = z.object({
  status: z.array(BookingStatus).optional(),
  cityId: Uuid.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Reference ("CLK-1004"), client phone or name. */
  q: z.string().trim().min(2).max(80).optional(),
  /** Only bookings with an open review or alert. */
  needsAttention: z.boolean().optional(),
  cursor: AdminCursor.optional(),
  limit: z.int().min(1).max(100).default(50),
});
export type AdminBookingQuery = z.input<typeof AdminBookingQuery>;

export const AdminBookingRow = z.object({
  id: Uuid,
  reference: z.string(),
  status: BookingStatus,
  cityId: Uuid,
  cityName: z.string(),
  categoryCode: z.string(),
  tier: PlanTier,
  emergencyBand: EmergencyBand,
  scheduledStart: IsoDateTime,
  scheduledHours: z.number().positive(),
  clientName: z.string(),
  photographerName: z.string().nullable(),
  totalPaise: MoneyPaise,
  amountPaidPaise: MoneyPaise,
  /** The earliest armed SLA due time, if any clock is running. */
  nextDueAt: IsoDateTime.nullable(),
  /** e.g. NEEDS_REVIEW, OPS_ALERT, SLA_BREACHED, INCIDENT_REPORTED. */
  flags: z.array(z.string()),
});
export type AdminBookingRow = z.infer<typeof AdminBookingRow>;

export const AdminBookingPage = AdminPage(AdminBookingRow);
export type AdminBookingPage = z.infer<typeof AdminBookingPage>;

export const AdminStatusEvent = z.object({
  fromStatus: BookingStatus.nullable(),
  toStatus: BookingStatus,
  actorKind: z.string(),
  reason: z.string().nullable(),
  occurredAt: IsoDateTime,
});
export type AdminStatusEvent = z.infer<typeof AdminStatusEvent>;

export const AdminPaymentRow = z.object({
  id: Uuid,
  kind: z.string(),
  status: z.string(),
  amountPaise: MoneyPaise,
  createdAt: IsoDateTime,
});
export type AdminPaymentRow = z.infer<typeof AdminPaymentRow>;

/** An ops alert or review flag raised for a booking (from domain_events). */
export const AdminAlert = z.object({
  eventId: z.string(),
  type: z.string(),
  reason: z.string().nullable(),
  bookingId: Uuid.nullable(),
  bookingReference: z.string().nullable(),
  summary: z.string(),
  occurredAt: IsoDateTime,
});
export type AdminAlert = z.infer<typeof AdminAlert>;

/** GET /admin/bookings/:bookingId */
export const AdminBookingDetail = AdminBookingRow.extend({
  venue: z.object({
    address: z.string(),
    landmark: z.string().nullable(),
    pincode: z.string(),
  }),
  client: z.object({ name: z.string(), phone: z.string() }),
  advancePaise: MoneyPaise,
  balancePaise: MoneyPaise,
  timeline: z.array(AdminStatusEvent),
  payments: z.array(AdminPaymentRow),
  assignment: z
    .object({
      assignmentId: Uuid,
      photographerId: Uuid,
      photographerName: z.string(),
      photographerPhone: z.string(),
      status: AssignmentStatus,
      acceptedAt: IsoDateTime,
      checkedInAt: IsoDateTime.nullable(),
      checkedOutAt: IsoDateTime.nullable(),
      events: z.array(AssignmentEventView),
    })
    .nullable(),
  qaStatus: QaStatus.nullable(),
  slaClocks: z.array(SlaClockView),
  breaches: z.array(SlaBreachView.extend({ id: Uuid })),
  alerts: z.array(AdminAlert),
});
export type AdminBookingDetail = z.infer<typeof AdminBookingDetail>;

// ── QA desk (replaces POST /dev/deliveries/:id/qa) ──────────────────────────

export const AdminQaItem = z.object({
  bookingId: Uuid,
  reference: z.string(),
  cityName: z.string(),
  categoryCode: z.string(),
  tier: PlanTier,
  photographerName: z.string(),
  checkedOutAt: IsoDateTime.nullable(),
  declaredFrameCount: z.int().min(0).nullable(),
  counts: z.object({ raw: z.int().min(0), jpeg: z.int().min(0), video: z.int().min(0) }),
  /** The production clock's due time — QA eats into it. */
  dueAt: IsoDateTime.nullable(),
});
export type AdminQaItem = z.infer<typeof AdminQaItem>;

/** POST /admin/qa/:bookingId — a FAIL needs a note for the photographer and the audit log. */
export const AdminQaDecisionBody = z
  .object({ result: QaResult, note: z.string().trim().max(1_000).optional() })
  .refine((b) => b.result === 'PASS' || (b.note?.length ?? 0) >= 3, {
    message: 'Say why it failed',
    path: ['note'],
  });
export type AdminQaDecisionBody = z.infer<typeof AdminQaDecisionBody>;

// ── Incident desk (replaces POST /dev/assignments/:id/confirm-incident) ─────

export const AdminIncidentKind = z.enum(['ACCESS_DENIED', 'UNSAFE_SITE', 'CLIENT_ABSENT']);
export type AdminIncidentKind = z.infer<typeof AdminIncidentKind>;

export const AdminIncidentItem = z.object({
  eventId: z.string(),
  kind: AdminIncidentKind,
  assignmentId: Uuid,
  bookingId: Uuid,
  reference: z.string(),
  bookingStatus: BookingStatus,
  cityName: z.string(),
  photographerName: z.string(),
  note: z.string().nullable(),
  reportedAt: IsoDateTime,
});
export type AdminIncidentItem = z.infer<typeof AdminIncidentItem>;

/** POST /admin/assignments/:assignmentId/confirm-incident (ACCESS_DENIED | UNSAFE_SITE). */
export const AdminConfirmIncidentBody = z.object({
  kind: z.enum(['ACCESS_DENIED', 'UNSAFE_SITE']),
  note: z.string().trim().min(3).max(1_000),
});
export type AdminConfirmIncidentBody = z.infer<typeof AdminConfirmIncidentBody>;

// ── Dispatch desk ───────────────────────────────────────────────────────────

export const AdminDispatchItem = z.object({
  bookingId: Uuid,
  reference: z.string(),
  cityName: z.string(),
  categoryCode: z.string(),
  tier: PlanTier,
  emergencyBand: EmergencyBand,
  scheduledStart: IsoDateTime,
  wave: z.int().min(0),
  /** true when every wave has run out (dispatch.exhausted). */
  exhausted: z.boolean(),
  pendingOffers: z.int().min(0),
  /** start − 90 min: the unfilled deadline (ADR-0012 D1). */
  deadlineAt: IsoDateTime,
});
export type AdminDispatchItem = z.infer<typeof AdminDispatchItem>;

/** GET /admin/dispatch/:bookingId reuses the dev desk's view. */
export const AdminDispatchDetail = DispatchDeskView;
export type AdminDispatchDetail = DispatchDeskView;

// ── SLA breach board ────────────────────────────────────────────────────────

export const BreachAttribution = z.enum(['PHOTOGRAPHER', 'CLICKCO', 'CLIENT', 'FORCE_MAJEURE']);
export type BreachAttribution = z.infer<typeof BreachAttribution>;

export const AdminBreachItem = SlaBreachView.extend({
  id: Uuid,
  bookingId: Uuid,
  reference: z.string(),
  cityName: z.string(),
  photographerName: z.string().nullable(),
  waived: z.boolean(),
  waiveReason: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type AdminBreachItem = z.infer<typeof AdminBreachItem>;

/** POST /admin/breaches/:breachId/attribute — who caused the delay (ADR-0016). */
export const AdminAttributeBreachBody = z.object({
  attributedTo: BreachAttribution,
  note: z.string().trim().min(3).max(1_000),
});
export type AdminAttributeBreachBody = z.infer<typeof AdminAttributeBreachBody>;

/** POST /admin/breaches/:breachId/waive — no remedy will be applied (applying money is S10). */
export const AdminWaiveBreachBody = z.object({ reason: z.string().trim().min(3).max(1_000) });
export type AdminWaiveBreachBody = z.infer<typeof AdminWaiveBreachBody>;

// ── Staff management (SUPER_ADMIN) ──────────────────────────────────────────

export const AdminStaffRow = z.object({
  id: Uuid,
  email: z.string(),
  fullName: z.string(),
  isActive: z.boolean(),
  totpEnrolled: z.boolean(),
  lastLoginAt: IsoDateTime.nullable(),
  grants: z.array(StaffGrant),
});
export type AdminStaffRow = z.infer<typeof AdminStaffRow>;

export const AdminCreateStaffBody = z.object({
  email: StaffEmail,
  fullName: z.string().trim().min(2).max(120),
  grants: z
    .array(z.object({ role: StaffRole, cityId: Uuid.nullable() }))
    .min(1)
    .refine((gs) => gs.every((g) => g.role !== 'CITY_MANAGER' || g.cityId !== null), {
      message: 'A city manager needs a city',
    }),
});
export type AdminCreateStaffBody = z.infer<typeof AdminCreateStaffBody>;

/** The temporary password is shown once; the person sets up TOTP at first sign-in. */
export const AdminCreateStaffResponse = z.object({
  staff: AdminStaffRow,
  temporaryPassword: z.string().min(16),
});
export type AdminCreateStaffResponse = z.infer<typeof AdminCreateStaffResponse>;
