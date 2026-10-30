import { z } from 'zod';
import { AdminListQuery, AdminPage } from './admin.js';
import { IsoDateTime, PhoneE164, Uuid } from './common.js';
import { PhotographerStatus, PlanTier, type StaffRole } from './enums.js';

/**
 * ADR-0026 D5 (stream C) — the supply desk: onboarding kanban, KYC queue, photographer directory,
 * penalty waivers and status changes. No Aadhaar anywhere (DOMAIN Invariant 15): identifiers are
 * last-4 only and always reach the screen masked.
 */

// ── Schema enums (docs/clickco-04-schema.sql §1; admin-supply.test.ts pins them) ──

export const ApplicationStage = z.enum([
  'APPLIED',
  'SCREENING',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_DONE',
  'DOCS_REQUESTED',
  'DOCS_UNDER_REVIEW',
  'TRIAL_ASSIGNED',
  'TRIAL_REVIEW',
  'CONTRACT_SENT',
  'APPROVED',
  'REJECTED',
  'ON_HOLD',
  'WITHDRAWN',
]);
export type ApplicationStage = z.infer<typeof ApplicationStage>;

/** No AADHAAR entry, by design (schema header note 4). */
export const DocumentKind = z.enum([
  'PAN_CARD',
  'DRIVING_LICENCE',
  'PASSPORT',
  'VOTER_ID',
  'ADDRESS_PROOF',
  'POLICE_VERIFICATION',
  'BANK_PROOF',
  'GST_CERTIFICATE',
  'DRONE_RPC',
  'DRONE_UIN',
  'EQUIPMENT_INVOICE',
  'SIGNED_CONTRACT',
  'OTHER',
]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const DocumentReviewStatus = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'RESUBMIT_REQUESTED',
  'EXPIRED',
]);
export type DocumentReviewStatus = z.infer<typeof DocumentReviewStatus>;

// ── Who may do what (the API enforces; SUPER_ADMIN always may) ──────────────

/** Per-action roles inside the photographers desk (ADMIN_DESK_ROLES.photographers opens it). */
export const SUPPLY_ACTION_ROLES = {
  /** Add a walk-in, referral or outreach applicant. */
  createApplicant: ['CITY_MANAGER', 'OPS_AGENT'],
  /** Move an application between in-flight stages. */
  moveApplication: ['CITY_MANAGER', 'OPS_AGENT'],
  /** Approve (onboard) or reject an application. */
  decideApplication: ['CITY_MANAGER'],
  /** Approve or reject a KYC document. */
  decideKyc: ['CITY_MANAGER'],
  /** Open a KYC document through a 5-minute signed link (every view is audited). */
  viewKycDocument: ['CITY_MANAGER'],
  /** Waive a penalty (ADR-0013 verified emergency, a no-show reversed after a late check-in). */
  waivePenalty: ['CITY_MANAGER', 'QUALITY_MANAGER'],
  /** Pause, reactivate, suspend or offboard a photographer. */
  changeStatus: ['CITY_MANAGER'],
} as const satisfies Readonly<Record<string, readonly StaffRole[]>>;
export type SupplyAction = keyof typeof SUPPLY_ACTION_ROLES;

// ── Onboarding (photographer_applications + photographer_application_events) ──

/** The kanban's in-flight columns, in pipeline order. */
export const APPLICATION_BOARD_STAGES = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_DONE',
  'DOCS_REQUESTED',
  'DOCS_UNDER_REVIEW',
  'TRIAL_ASSIGNED',
  'TRIAL_REVIEW',
  'CONTRACT_SENT',
  'ON_HOLD',
] as const satisfies readonly ApplicationStage[];

/** Where an application ends. Approved is final: the photographer's status takes over. */
export const APPLICATION_CLOSED_STAGES = [
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const satisfies readonly ApplicationStage[];

/** The decisions only a city manager (or SUPER_ADMIN) takes. */
export const APPLICATION_DECISION_STAGES = [
  'APPROVED',
  'REJECTED',
] as const satisfies readonly ApplicationStage[];

const isBoardStage = (s: ApplicationStage): boolean =>
  (APPLICATION_BOARD_STAGES as readonly ApplicationStage[]).includes(s);

/**
 * May an application move `from` → `to`? Never to where it already is; never out of APPROVED
 * (the photographer is onboarded — pause or offboard them instead); a rejected or withdrawn
 * application can be reopened into an in-flight stage only.
 */
export function canMoveApplication(from: ApplicationStage, to: ApplicationStage): boolean {
  if (from === to || from === 'APPROVED') return false;
  if (!isBoardStage(from)) return isBoardStage(to);
  return true;
}

export const ApplicationSource = z.enum(['REFERRAL', 'INSTAGRAM', 'WALK_IN', 'OUTREACH', 'OTHER']);
export type ApplicationSource = z.infer<typeof ApplicationSource>;

/** A link shown to staff: http(s) only, so it can never be a script URL. */
export const WebLink = z.url({ protocol: /^https?$/ }).max(500);

/** A reason for the audit log (and, where it applies, the photographer). */
export const AdminReason = z.string().trim().min(3, 'Add a short reason').max(1_000);

/** GET /admin/supply/applications — the kanban. */
export const AdminApplicationQuery = z.object({
  cityId: Uuid.optional(),
  /** Name or phone. */
  q: z.string().trim().min(2).max(80).optional(),
});
export type AdminApplicationQuery = z.input<typeof AdminApplicationQuery>;

export const AdminApplicationCard = z.object({
  id: Uuid,
  photographerId: Uuid,
  fullName: z.string(),
  /** Masked for READ_ONLY. */
  phone: z.string(),
  cityId: Uuid,
  cityName: z.string(),
  source: z.string().nullable(),
  portfolioUrl: z.string().nullable(),
  yearsExperience: z.int().min(0).nullable(),
  requestedMaxTier: PlanTier.nullable(),
  stage: ApplicationStage,
  /** When it entered its current stage. */
  stageSince: IsoDateTime,
  createdAt: IsoDateTime,
  documents: z.object({
    pending: z.int().min(0),
    approved: z.int().min(0),
    rejected: z.int().min(0),
  }),
});
export type AdminApplicationCard = z.infer<typeof AdminApplicationCard>;

export const AdminApplicationColumn = z.object({
  stage: ApplicationStage,
  /** Every application in the stage (closed stages: the last 30 days). */
  count: z.int().min(0),
  /** Longest-waiting first, at most APPLICATION_COLUMN_CAP. */
  items: z.array(AdminApplicationCard),
});
export type AdminApplicationColumn = z.infer<typeof AdminApplicationColumn>;

export const APPLICATION_COLUMN_CAP = 100;
/** Closed columns show what closed in this many days. */
export const APPLICATION_CLOSED_WINDOW_DAYS = 30;

/** Every stage, board stages first then closed ones. */
export const AdminApplicationBoard = z.object({ columns: z.array(AdminApplicationColumn) });
export type AdminApplicationBoard = z.infer<typeof AdminApplicationBoard>;

/** The photographer's manual verification ticks (schema §6). */
export const AdminVerification = z.object({
  identityConfirmedAt: IsoDateTime.nullable(),
  idProofKind: DocumentKind.nullable(),
  /** "•••• 1234" — never more than the last four. */
  idProofMasked: z.string().nullable(),
  policeVerifiedOn: z.iso.date().nullable(),
  policeVerificationExpires: z.iso.date().nullable(),
  panVerifiedAt: IsoDateTime.nullable(),
  panMasked: z.string().nullable(),
  bankVerifiedAt: IsoDateTime.nullable(),
  gstRegistered: z.boolean(),
});
export type AdminVerification = z.infer<typeof AdminVerification>;

/** The four checks an ACTIVE photographer must have passed (schema pro_active_requires_verification). */
export const VerificationCheck = z.enum(['IDENTITY', 'POLICE', 'PAN', 'BANK']);
export type VerificationCheck = z.infer<typeof VerificationCheck>;

export function missingVerification(v: AdminVerification): VerificationCheck[] {
  return [
    ...(v.identityConfirmedAt ? [] : (['IDENTITY'] as const)),
    ...(v.policeVerifiedOn ? [] : (['POLICE'] as const)),
    ...(v.panVerifiedAt ? [] : (['PAN'] as const)),
    ...(v.bankVerifiedAt ? [] : (['BANK'] as const)),
  ];
}

export const AdminApplicationEvent = z.object({
  fromStage: ApplicationStage.nullable(),
  toStage: ApplicationStage,
  actorName: z.string().nullable(),
  note: z.string().nullable(),
  at: IsoDateTime,
});
export type AdminApplicationEvent = z.infer<typeof AdminApplicationEvent>;

export const AdminDocumentSummary = z.object({
  id: Uuid,
  kind: DocumentKind,
  reviewStatus: DocumentReviewStatus,
  referenceMasked: z.string().nullable(),
  expiresOn: z.iso.date().nullable(),
  uploadedAt: IsoDateTime,
  reviewNote: z.string().nullable(),
  reviewedAt: IsoDateTime.nullable(),
});
export type AdminDocumentSummary = z.infer<typeof AdminDocumentSummary>;

export const AdminApplicationDetail = AdminApplicationCard.extend({
  photographerStatus: PhotographerStatus,
  declaredGear: z.string().nullable(),
  interviewAt: IsoDateTime.nullable(),
  interviewNotes: z.string().nullable(),
  decisionReason: z.string().nullable(),
  decidedAt: IsoDateTime.nullable(),
  verification: AdminVerification,
  documents: z.array(AdminDocumentSummary),
  history: z.array(AdminApplicationEvent),
});
export type AdminApplicationDetail = z.infer<typeof AdminApplicationDetail>;

/** POST /admin/supply/applications/:id/move — every move is logged with its reason. */
export const AdminMoveApplicationBody = z.object({ toStage: ApplicationStage, note: AdminReason });
export type AdminMoveApplicationBody = z.infer<typeof AdminMoveApplicationBody>;

/** POST /admin/supply/applicants — a walk-in, referral or outreach applicant. */
export const AdminCreateApplicantBody = z.object({
  fullName: z.string().trim().min(2, 'Enter their full name').max(120),
  phone: PhoneE164,
  cityId: Uuid,
  source: ApplicationSource,
  portfolioUrl: WebLink.optional(),
  yearsExperience: z.int().min(0).max(60).optional(),
  requestedMaxTier: PlanTier.optional(),
  note: z.string().trim().max(1_000).optional(),
});
export type AdminCreateApplicantBody = z.infer<typeof AdminCreateApplicantBody>;

// ── KYC queue (photographer_documents) ──────────────────────────────────────

export const AdminKycItem = z.object({
  id: Uuid,
  photographerId: Uuid,
  photographerName: z.string(),
  photographerStatus: PhotographerStatus,
  applicationStage: ApplicationStage.nullable(),
  cityName: z.string(),
  kind: DocumentKind,
  referenceMasked: z.string().nullable(),
  issuedOn: z.iso.date().nullable(),
  expiresOn: z.iso.date().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.int().min(0).nullable(),
  uploadedAt: IsoDateTime,
});
export type AdminKycItem = z.infer<typeof AdminKycItem>;

export const AdminKycPage = AdminPage(AdminKycItem);
export type AdminKycPage = z.infer<typeof AdminKycPage>;

export const KycDecision = z.enum(['APPROVE', 'REJECT']);
export type KycDecision = z.infer<typeof KycDecision>;

/** POST /admin/supply/kyc/:documentId/decide — a rejection says why (the photographer is told). */
export const AdminKycDecisionBody = z
  .object({ decision: KycDecision, note: z.string().trim().max(1_000).optional() })
  .refine((b) => b.decision === 'APPROVE' || (b.note?.length ?? 0) >= 3, {
    message: 'Say why it was rejected',
    path: ['note'],
  });
export type AdminKycDecisionBody = z.infer<typeof AdminKycDecisionBody>;

export const AdminKycDecisionResponse = AdminDocumentSummary.extend({
  photographerId: Uuid,
  verification: AdminVerification,
});
export type AdminKycDecisionResponse = z.infer<typeof AdminKycDecisionResponse>;

/** How long a KYC document link works (ADR-0026 D5). */
export const KYC_LINK_TTL_SECONDS = 300;

/**
 * POST /admin/supply/kyc/:documentId/view-link — audited `kyc.document_view`. `opensInBrowser`
 * is false for local (development) storage, whose links cannot be followed.
 */
export const AdminDocumentLink = z.object({
  url: z.string().min(1),
  expiresAt: IsoDateTime,
  opensInBrowser: z.boolean(),
});
export type AdminDocumentLink = z.infer<typeof AdminDocumentLink>;

// ── Directory, penalties, status ────────────────────────────────────────────

export const AdminPhotographerQuery = AdminListQuery.extend({
  /** Name or phone. */
  q: z.string().trim().min(2).max(80).optional(),
  cityId: Uuid.optional(),
  status: PhotographerStatus.optional(),
});
export type AdminPhotographerQuery = z.input<typeof AdminPhotographerQuery>;

export const AdminPhotographerRow = z.object({
  id: Uuid,
  fullName: z.string(),
  /** Masked for READ_ONLY. */
  phone: z.string(),
  cityId: Uuid,
  cityName: z.string(),
  status: PhotographerStatus,
  maxTier: PlanTier,
  /** 4.87 → 4870. */
  ratingAvgBps: z.int().min(0).nullable(),
  shootsCompleted: z.int().min(0),
  /** Penalties not waived. */
  activePenalties: z.int().min(0),
  onboardedAt: IsoDateTime.nullable(),
});
export type AdminPhotographerRow = z.infer<typeof AdminPhotographerRow>;

export const AdminPhotographerPage = AdminPage(AdminPhotographerRow);
export type AdminPhotographerPage = z.infer<typeof AdminPhotographerPage>;

export const AdminPenalty = z.object({
  id: Uuid,
  bookingId: Uuid.nullable(),
  bookingReference: z.string().nullable(),
  /** NO_SHOW | LATE_UPLOAD | SLA_BREACH | CONDUCT | DATA_LOSS */
  kind: z.string(),
  /** 1 warning, 2 deactivation, 3 removal. */
  severity: z.int().min(1).max(3),
  payoutDeductionBps: z.int().min(0).max(10_000),
  deactivationDays: z.int().min(0).nullable(),
  waived: z.boolean(),
  waiveReason: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type AdminPenalty = z.infer<typeof AdminPenalty>;

export const AdminPhotographerCategory = z.object({
  code: z.string(),
  name: z.string(),
  certifiedTier: PlanTier,
  certifiedAt: IsoDateTime,
});
export type AdminPhotographerCategory = z.infer<typeof AdminPhotographerCategory>;

export const AdminPhotographerMetrics = z.object({
  shootsCompleted: z.int().min(0),
  ratingAvgBps: z.int().min(0).nullable(),
  ratingCount: z.int().min(0),
  acceptanceRateBps: z.int().min(0).nullable(),
  onTimeUploadRateBps: z.int().min(0).nullable(),
  noShowCount: z.int().min(0),
  dataLossCount: z.int().min(0),
  escalationCount: z.int().min(0),
  computedAt: IsoDateTime,
});
export type AdminPhotographerMetrics = z.infer<typeof AdminPhotographerMetrics>;

export const AdminPhotographerProfile = AdminPhotographerRow.extend({
  email: z.string().nullable(),
  serviceRadiusKm: z.number().min(0),
  acceptsEmergency: z.boolean(),
  acceptsOutstation: z.boolean(),
  verification: AdminVerification,
  categories: z.array(AdminPhotographerCategory),
  metrics: AdminPhotographerMetrics.nullable(),
  penalties: z.array(AdminPenalty),
  documents: z.array(AdminDocumentSummary),
  application: z.object({ id: Uuid, stage: ApplicationStage }).nullable(),
  suspendedAt: IsoDateTime.nullable(),
  suspensionReason: z.string().nullable(),
  offboardedAt: IsoDateTime.nullable(),
});
export type AdminPhotographerProfile = z.infer<typeof AdminPhotographerProfile>;

/** POST /admin/supply/penalties/:penaltyId/waive */
export const AdminWaivePenaltyBody = z.object({ reason: AdminReason });
export type AdminWaivePenaltyBody = z.infer<typeof AdminWaivePenaltyBody>;

export const PhotographerStatusAction = z.enum(['PAUSE', 'REACTIVATE', 'SUSPEND', 'OFFBOARD']);
export type PhotographerStatusAction = z.infer<typeof PhotographerStatusAction>;

/** Which statuses each action leaves from, and where it lands. OFFBOARDED is final. */
export const PHOTOGRAPHER_STATUS_ACTIONS: Readonly<
  Record<
    PhotographerStatusAction,
    { readonly from: readonly PhotographerStatus[]; readonly to: PhotographerStatus }
  >
> = {
  PAUSE: { from: ['ACTIVE'], to: 'PAUSED' },
  REACTIVATE: { from: ['PAUSED', 'SUSPENDED'], to: 'ACTIVE' },
  SUSPEND: { from: ['ACTIVE', 'PAUSED'], to: 'SUSPENDED' },
  OFFBOARD: { from: ['ACTIVE', 'PAUSED', 'SUSPENDED'], to: 'OFFBOARDED' },
};

export function statusActionsFrom(status: PhotographerStatus): PhotographerStatusAction[] {
  return PhotographerStatusAction.options.filter((a) =>
    PHOTOGRAPHER_STATUS_ACTIONS[a].from.includes(status),
  );
}

/** POST /admin/supply/photographers/:id/status */
export const AdminPhotographerStatusBody = z.object({
  action: PhotographerStatusAction,
  reason: AdminReason,
});
export type AdminPhotographerStatusBody = z.infer<typeof AdminPhotographerStatusBody>;

/** Last four characters behind dots: "ABCDE1234F" → "•••• 234F". */
export function maskTail(value: string, keep = 4): string {
  const tail = value.slice(-keep);
  return `•••• ${tail}`;
}
