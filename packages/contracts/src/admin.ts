import { z } from 'zod';
import { StepUpCode } from './admin-pricing.js';
import { TokenPair } from './auth.js';
import { IsoDateTime, Uuid } from './common.js';
import { DeliveryView, QaResult, QaStatus, SlaBreachView, SlaClockView } from './delivery.js';
import { DispatchDeskView } from './dispatch.js';
import {
  AreaStatus,
  AssignmentStatus,
  BookingStatus,
  EmergencyBand,
  PlanTier,
  StaffRole,
} from './enums.js';
import { MoneyPaise } from './money.js';
import { AssignmentEventView, ConfirmIncidentResponse } from './onsite.js';

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

// ── Staff passwords (ADR-0026 D7) ───────────────────────────────────────────

/** ADR-0026 D7 numbers in one place. */
export const STAFF_PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
  /** A temporary password (new account, reset) stops working after 72 hours. */
  temporaryTtlHours: 72,
} as const;

/** A password a person chooses: 12–128 characters (NIST 800-63B length, no composition rules). */
export const StaffNewPassword = z
  .string()
  .min(
    STAFF_PASSWORD_POLICY.minLength,
    `Use at least ${STAFF_PASSWORD_POLICY.minLength} characters`,
  )
  .max(
    STAFF_PASSWORD_POLICY.maxLength,
    `Use at most ${STAFF_PASSWORD_POLICY.maxLength} characters`,
  );

/**
 * The context checks the schema cannot make on its own (ADR-0026 D7): not the email (or its
 * name part), and not the password being replaced. `previous` is only known where the plain
 * old password is at hand (the panel's forms); the API checks it against the stored hash.
 * Returns the message to show, or null when the password is fine. Shared by panel and API.
 */
export function staffPasswordProblem(
  password: string,
  context: { readonly email: string; readonly previous?: string },
): string | null {
  const length = StaffNewPassword.safeParse(password);
  if (!length.success) return length.error.issues[0]?.message ?? 'Choose another password';
  const typed = password.trim().toLowerCase();
  const email = context.email.trim().toLowerCase();
  const name = email.split('@')[0] ?? '';
  if (typed === email || (name.length > 0 && typed === name)) {
    return 'Don’t use your email as your password';
  }
  if (context.previous !== undefined && password === context.previous) {
    return 'Choose a password different from the current one';
  }
  return null;
}

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
  /**
   * ADR-0026 D7: the password was a temporary one. The TOTP step must then carry `newPassword`,
   * and the session starts only once it is saved.
   */
  mustChangePassword: z.boolean(),
  expiresAt: IsoDateTime,
});
export type StaffLoginChallenge = z.infer<typeof StaffLoginChallenge>;

/** POST /admin/auth/totp — step 2. `newPassword` is required when the challenge says so. */
export const StaffTotpBody = z.object({
  challengeId: Uuid,
  code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
  newPassword: StaffNewPassword.optional(),
});
export type StaffTotpBody = z.infer<typeof StaffTotpBody>;

/**
 * POST /admin/me/password — the signed-in person changes their own password, proving it with
 * the current one and an authenticator code. Every other session ends; the answer is a new one.
 */
export const StaffChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: StaffNewPassword,
  code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
});
export type StaffChangePasswordBody = z.infer<typeof StaffChangePasswordBody>;

export const StaffChangePasswordResponse = TokenPair;
export type StaffChangePasswordResponse = z.infer<typeof StaffChangePasswordResponse>;

export const StaffGrant = z.object({
  /** staff_role_grants.id — what POST /admin/staff/:id/grants/:grantId/revoke takes. */
  id: Uuid,
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

/**
 * Staff may re-attribute a breach only to the client or force majeure (ADR-0016 D9). The breach then
 * owes nothing — it leaves the OPEN queue, though its priced amounts stay for the record. Moving one
 * onto the photographer or Clickco is never a desk action: it would set up a payout cut on someone's
 * word.
 */
export const BreachReattribution = z.enum(['CLIENT', 'FORCE_MAJEURE']);
export type BreachReattribution = z.infer<typeof BreachReattribution>;

/** POST /admin/breaches/:breachId/attribute — who caused the delay (ADR-0016). */
export const AdminAttributeBreachBody = z.object({
  attributedTo: BreachReattribution,
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
  /**
   * ADR-0026 D7: set while the account still has a temporary password (never used, or reset):
   * when it stops working. null once the person has chosen their own.
   */
  temporaryPasswordExpiresAt: IsoDateTime.nullable(),
  grants: z.array(StaffGrant),
});
export type AdminStaffRow = z.infer<typeof AdminStaffRow>;

/** POST /admin/staff — a fresh authenticator code of the caller's (step-up, audit M3). */
export const AdminCreateStaffBody = z.object({
  code: StepUpCode,
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

/**
 * POST /admin/staff/:staffId/reset-password (SUPER_ADMIN, ADR-0026 D7): a new temporary password,
 * shown once, valid 72 hours; every session of that person has ended.
 */
export const AdminResetPasswordResponse = z.object({
  staff: AdminStaffRow,
  temporaryPassword: z.string().min(16),
  expiresAt: IsoDateTime,
});
export type AdminResetPasswordResponse = z.infer<typeof AdminResetPasswordResponse>;

// ── S9 API additions (list envelopes, queries, grants, audit view) ──────────

/** GET query for the queue-style admin lists (QA, incidents, dispatch, alerts, staff). */
export const AdminListQuery = z.object({
  cursor: AdminCursor.optional(),
  limit: z.int().min(1).max(100).default(50),
});
export type AdminListQuery = z.input<typeof AdminListQuery>;

/** GET /admin/breaches — OPEN = neither waived nor applied (the default). */
export const AdminBreachStatusFilter = z.enum(['OPEN', 'WAIVED', 'ALL']);
export type AdminBreachStatusFilter = z.infer<typeof AdminBreachStatusFilter>;

export const AdminBreachQuery = AdminListQuery.extend({
  status: AdminBreachStatusFilter.default('OPEN'),
});
export type AdminBreachQuery = z.input<typeof AdminBreachQuery>;

export const AdminQaPage = AdminPage(AdminQaItem);
export type AdminQaPage = z.infer<typeof AdminQaPage>;
export const AdminIncidentPage = AdminPage(AdminIncidentItem);
export type AdminIncidentPage = z.infer<typeof AdminIncidentPage>;
export const AdminDispatchPage = AdminPage(AdminDispatchItem);
export type AdminDispatchPage = z.infer<typeof AdminDispatchPage>;
export const AdminBreachPage = AdminPage(AdminBreachItem);
export type AdminBreachPage = z.infer<typeof AdminBreachPage>;
export const AdminAlertPage = AdminPage(AdminAlert);
export type AdminAlertPage = z.infer<typeof AdminAlertPage>;
export const AdminStaffPage = AdminPage(AdminStaffRow);
export type AdminStaffPage = z.infer<typeof AdminStaffPage>;

/** POST /admin/staff/:staffId/grants — every grant needs a fresh authenticator code (M3). */
export const AdminGrantBody = z
  .object({ code: StepUpCode, role: StaffRole, cityId: Uuid.nullable() })
  .refine((g) => g.role !== 'CITY_MANAGER' || g.cityId !== null, {
    message: 'A city manager needs a city',
    path: ['cityId'],
  })
  .refine((g) => g.role !== 'SUPER_ADMIN' || g.cityId === null, {
    message: 'A super admin covers every city',
    path: ['cityId'],
  });
export type AdminGrantBody = z.infer<typeof AdminGrantBody>;

/**
 * POST /admin/staff/:staffId/{deactivate,reset-totp,reset-password}: a fresh authenticator code
 * of the caller's (step-up, audit M3).
 */
export const AdminStaffStepUpBody = z.object({ code: StepUpCode });
export type AdminStaffStepUpBody = z.infer<typeof AdminStaffStepUpBody>;

/** One audit_logs row as the booking page shows it (read-only; the table is append-only). */
export const AdminAuditEntry = z.object({
  id: z.string(),
  action: z.string(),
  actorKind: z.string(),
  actorEmail: z.string().nullable(),
  entityKind: z.string(),
  entityId: Uuid.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  occurredAt: IsoDateTime,
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

/**
 * GET /admin/bookings/:bookingId with the ADR-0025 D4 audit view. Optional in the schema so
 * existing AdminBookingDetail fixtures stay valid; the API always sends it.
 */
export const AdminBookingDetailWithAudit = AdminBookingDetail.extend({
  audit: z.array(AdminAuditEntry).optional(),
});
export type AdminBookingDetailWithAudit = z.infer<typeof AdminBookingDetailWithAudit>;

// ── Cities and the answers of the admin POSTs ───────────────────────────────

/** GET /admin/cities — the caller's grant cities (every city with an all-cities grant). */
export const AdminCity = z.object({
  id: Uuid,
  name: z.string(),
  state: z.string(),
  status: AreaStatus,
});
export type AdminCity = z.infer<typeof AdminCity>;
export const AdminCityList = z.array(AdminCity);
export type AdminCityList = z.infer<typeof AdminCityList>;

/** POST /admin/qa/:bookingId — the booking's delivery after the decision. */
export const AdminQaDecisionResponse = DeliveryView;
export type AdminQaDecisionResponse = DeliveryView;

/** POST /admin/assignments/:assignmentId/confirm-incident */
export const AdminConfirmIncidentResponse = ConfirmIncidentResponse;
export type AdminConfirmIncidentResponse = ConfirmIncidentResponse;

/** POST /admin/breaches/:breachId/attribute and …/waive — the breach as the board shows it. */
export const AdminBreachDecisionResponse = AdminBreachItem;
export type AdminBreachDecisionResponse = AdminBreachItem;

/** POST /admin/staff/:staffId/grants, …/grants/:grantId/revoke, …/deactivate, …/reset-totp */
export const AdminStaffChangeResponse = AdminStaffRow;
export type AdminStaffChangeResponse = AdminStaffRow;

/** POST /admin/auth/logout */
export const AdminLogoutResponse = z.object({ loggedOut: z.literal(true) });
export type AdminLogoutResponse = z.infer<typeof AdminLogoutResponse>;
