import type {
  ApplicationSource,
  ApplicationStage,
  DocumentKind,
  DocumentReviewStatus,
  PhotographerStatus,
  PlanTier,
} from '@clickco/contracts';
import type postgres from 'postgres';

/** Supply-side records (ADR-0026 D5). Dates are instants; `date` columns are YYYY-MM-DD text. */

export type Tx = postgres.TransactionSql;

/** The cities a caller acts in: every city, or these. */
export type CityScope = 'ALL' | readonly string[];

export interface VerificationRecord {
  readonly identityConfirmedAt: Date | null;
  readonly idProofKind: DocumentKind | null;
  /** Last four only (schema §6) — never a full identifier. */
  readonly idProofLast4: string | null;
  readonly policeVerificationAt: string | null;
  readonly policeVerificationExpires: string | null;
  readonly panVerifiedAt: Date | null;
  readonly panNumber: string | null;
  readonly bankVerifiedAt: Date | null;
  readonly isGstRegistered: boolean;
}

export interface DocumentCounts {
  readonly pending: number;
  readonly approved: number;
  readonly rejected: number;
}

export interface ApplicationCardRecord {
  readonly id: string;
  readonly photographerId: string;
  readonly fullName: string;
  readonly phone: string;
  readonly cityId: string;
  readonly source: string | null;
  readonly portfolioUrl: string | null;
  readonly yearsExperience: number | null;
  readonly requestedMaxTier: PlanTier | null;
  readonly stage: ApplicationStage;
  readonly stageSince: Date;
  readonly createdAt: Date;
  readonly documents: DocumentCounts;
}

export interface BoardColumnRecord {
  readonly stage: ApplicationStage;
  readonly count: number;
  readonly items: readonly ApplicationCardRecord[];
}

export interface ApplicationEventRecord {
  readonly fromStage: ApplicationStage | null;
  readonly toStage: ApplicationStage;
  readonly actorStaffId: string | null;
  readonly note: string | null;
  readonly at: Date;
}

export interface DocumentRecord {
  readonly id: string;
  readonly photographerId: string;
  readonly kind: DocumentKind;
  readonly reviewStatus: DocumentReviewStatus;
  readonly referenceLast4: string | null;
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly storageKey: string;
  readonly uploadedAt: Date;
  readonly reviewNote: string | null;
  readonly reviewedAt: Date | null;
  readonly purgedAt: Date | null;
}

export interface ApplicationDetailRecord extends ApplicationCardRecord {
  readonly photographerStatus: PhotographerStatus;
  readonly declaredGear: string | null;
  readonly interviewAt: Date | null;
  readonly interviewNotes: string | null;
  readonly decisionReason: string | null;
  readonly decidedAt: Date | null;
  readonly verification: VerificationRecord;
  readonly documents: DocumentCounts;
  readonly documentList: readonly DocumentRecord[];
  readonly history: readonly ApplicationEventRecord[];
}

export interface NewApplicant {
  readonly fullName: string;
  readonly phone: string;
  readonly cityId: string;
  readonly source: ApplicationSource;
  readonly portfolioUrl: string | null;
  readonly yearsExperience: number | null;
  readonly requestedMaxTier: PlanTier | null;
  readonly note: string | null;
}

export interface KycQueueRecord extends DocumentRecord {
  readonly photographerName: string;
  readonly photographerStatus: PhotographerStatus;
  readonly cityId: string;
  readonly applicationStage: ApplicationStage | null;
}

export interface DirectoryRecord {
  readonly id: string;
  readonly fullName: string;
  readonly phone: string;
  readonly cityId: string;
  readonly status: PhotographerStatus;
  readonly maxTier: PlanTier;
  readonly ratingAvgBps: number | null;
  readonly shootsCompleted: number;
  readonly activePenalties: number;
  readonly onboardedAt: Date | null;
}

export interface DirectoryFilter {
  readonly scope: CityScope;
  readonly cityId?: string;
  readonly status?: PhotographerStatus;
  readonly search?: string;
  /** Whether a search may match phone digits (false for a caller who sees masked phones). */
  readonly searchPhones: boolean;
  readonly after?: { readonly fullName: string; readonly id: string };
  readonly limit: number;
}

export interface PenaltyRecord {
  readonly id: string;
  readonly photographerId: string;
  readonly bookingId: string | null;
  readonly kind: string;
  readonly severity: number;
  readonly payoutDeductionBps: number;
  readonly deactivationDays: number | null;
  readonly waived: boolean;
  readonly waiveReason: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface CategoryRecord {
  readonly code: string;
  readonly name: string;
  readonly certifiedTier: PlanTier;
  readonly certifiedAt: Date;
}

export interface MetricsRecord {
  readonly shootsCompleted: number;
  readonly ratingAvgBps: number | null;
  readonly ratingCount: number;
  readonly acceptanceRateBps: number | null;
  readonly onTimeUploadRateBps: number | null;
  readonly noShowCount: number;
  readonly dataLossCount: number;
  readonly escalationCount: number;
  readonly computedAt: Date;
}

export interface ProfileRecord extends DirectoryRecord {
  readonly email: string | null;
  readonly serviceRadiusKm: number;
  readonly acceptsEmergency: boolean;
  readonly acceptsOutstation: boolean;
  readonly verification: VerificationRecord;
  readonly categories: readonly CategoryRecord[];
  readonly metrics: MetricsRecord | null;
  readonly penalties: readonly PenaltyRecord[];
  readonly documents: readonly DocumentRecord[];
  readonly application: { readonly id: string; readonly stage: ApplicationStage } | null;
  readonly suspendedAt: Date | null;
  readonly suspensionReason: string | null;
  readonly offboardedAt: Date | null;
}
