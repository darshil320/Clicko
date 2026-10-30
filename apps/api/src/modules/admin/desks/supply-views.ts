import {
  type AdminApplicationCard,
  type AdminDocumentSummary,
  type AdminKycItem,
  type AdminPenalty,
  type AdminPhotographerProfile,
  type AdminPhotographerRow,
  type AdminVerification,
  maskTail,
} from '@clickco/contracts';
import type {
  ApplicationCardRecord,
  DirectoryRecord,
  DocumentRecord,
  KycQueueRecord,
  PenaltyRecord,
  ProfileRecord,
  VerificationRecord,
} from '../../photographers/supply.types';
import { maskPhone } from '../access/roles';

/** Supply records → the panel's contracts. Identifiers leave masked, always (Invariant 15). */

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** "asha@example.com" → "a•••@example.com". */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at <= 0 ? '•••' : `${email.slice(0, 1)}•••${email.slice(at)}`;
}

export const masked = (last4: string | null): string | null => (last4 ? maskTail(last4) : null);

export const shownPhone = (phone: string, canSee: boolean): string =>
  canSee ? phone : maskPhone(phone);

export function toVerification(v: VerificationRecord): AdminVerification {
  return {
    identityConfirmedAt: iso(v.identityConfirmedAt),
    idProofKind: v.idProofKind,
    idProofMasked: masked(v.idProofLast4),
    policeVerifiedOn: v.policeVerificationAt,
    policeVerificationExpires: v.policeVerificationExpires,
    panVerifiedAt: iso(v.panVerifiedAt),
    panMasked: v.panNumber ? maskTail(v.panNumber) : null,
    bankVerifiedAt: iso(v.bankVerifiedAt),
    gstRegistered: v.isGstRegistered,
  };
}

export function toDocumentSummary(d: DocumentRecord): AdminDocumentSummary {
  return {
    id: d.id,
    kind: d.kind,
    reviewStatus: d.reviewStatus,
    referenceMasked: masked(d.referenceLast4),
    expiresOn: d.expiresOn,
    uploadedAt: d.uploadedAt.toISOString(),
    reviewNote: d.reviewNote,
    reviewedAt: iso(d.reviewedAt),
  };
}

export function toCard(
  c: ApplicationCardRecord,
  cityName: string,
  canSeePhone: boolean,
): AdminApplicationCard {
  return {
    id: c.id,
    photographerId: c.photographerId,
    fullName: c.fullName,
    phone: shownPhone(c.phone, canSeePhone),
    cityId: c.cityId,
    cityName,
    source: c.source,
    portfolioUrl: c.portfolioUrl,
    yearsExperience: c.yearsExperience,
    requestedMaxTier: c.requestedMaxTier,
    stage: c.stage,
    stageSince: c.stageSince.toISOString(),
    createdAt: c.createdAt.toISOString(),
    documents: c.documents,
  };
}

export function toKycItem(d: KycQueueRecord, cityName: string): AdminKycItem {
  return {
    id: d.id,
    photographerId: d.photographerId,
    photographerName: d.photographerName,
    photographerStatus: d.photographerStatus,
    applicationStage: d.applicationStage,
    cityName,
    kind: d.kind,
    referenceMasked: masked(d.referenceLast4),
    issuedOn: d.issuedOn,
    expiresOn: d.expiresOn,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    uploadedAt: d.uploadedAt.toISOString(),
  };
}

export function toDirectoryRow(
  r: DirectoryRecord,
  cityName: string,
  canSeePhone: boolean,
): AdminPhotographerRow {
  return {
    id: r.id,
    fullName: r.fullName,
    phone: shownPhone(r.phone, canSeePhone),
    cityId: r.cityId,
    cityName,
    status: r.status,
    maxTier: r.maxTier,
    ratingAvgBps: r.ratingAvgBps,
    shootsCompleted: r.shootsCompleted,
    activePenalties: r.activePenalties,
    onboardedAt: iso(r.onboardedAt),
  };
}

export function toPenalty(p: PenaltyRecord, bookingReference: string | null): AdminPenalty {
  return {
    id: p.id,
    bookingId: p.bookingId,
    bookingReference,
    kind: p.kind,
    severity: p.severity,
    payoutDeductionBps: p.payoutDeductionBps,
    deactivationDays: p.deactivationDays,
    waived: p.waived,
    waiveReason: p.waiveReason,
    note: p.note,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toProfile(
  p: ProfileRecord,
  ctx: {
    readonly cityName: string;
    readonly canSeePhone: boolean;
    readonly references: ReadonlyMap<string, string>;
  },
): AdminPhotographerProfile {
  return {
    ...toDirectoryRow(p, ctx.cityName, ctx.canSeePhone),
    email: p.email && !ctx.canSeePhone ? maskEmail(p.email) : p.email,
    serviceRadiusKm: p.serviceRadiusKm,
    acceptsEmergency: p.acceptsEmergency,
    acceptsOutstation: p.acceptsOutstation,
    verification: toVerification(p.verification),
    categories: p.categories.map((c) => ({
      code: c.code,
      name: c.name,
      certifiedTier: c.certifiedTier,
      certifiedAt: c.certifiedAt.toISOString(),
    })),
    metrics: p.metrics ? { ...p.metrics, computedAt: p.metrics.computedAt.toISOString() } : null,
    penalties: p.penalties.map((x) =>
      toPenalty(x, x.bookingId ? (ctx.references.get(x.bookingId) ?? null) : null),
    ),
    documents: p.documents.map(toDocumentSummary),
    application: p.application,
    suspendedAt: iso(p.suspendedAt),
    suspensionReason: p.suspensionReason,
    offboardedAt: iso(p.offboardedAt),
  };
}
