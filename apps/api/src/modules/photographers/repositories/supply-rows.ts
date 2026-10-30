import type { DocumentKind, DocumentReviewStatus } from '@clickco/contracts';
import type postgres from 'postgres';
import type { CityScope, DocumentRecord, VerificationRecord } from '../supply.types';

/** Row shapes and mappers shared by the supply repositories (photographers schema §6). */

export type Db = postgres.ISql;

/** photographers columns behind VerificationRecord; `date` columns come back as text. */
export const VERIFICATION_COLUMNS = `p.identity_confirmed_at, p.id_proof_kind, p.id_proof_last4,
  p.police_verification_at::text AS police_verification_at,
  p.police_verification_expires::text AS police_verification_expires,
  p.pan_verified_at, p.pan_number, p.bank_verified_at, p.is_gst_registered`;

export interface VerificationRow {
  identity_confirmed_at: Date | null;
  id_proof_kind: DocumentKind | null;
  id_proof_last4: string | null;
  police_verification_at: string | null;
  police_verification_expires: string | null;
  pan_verified_at: Date | null;
  pan_number: string | null;
  bank_verified_at: Date | null;
  is_gst_registered: boolean;
}

export const toVerification = (r: VerificationRow): VerificationRecord => ({
  identityConfirmedAt: r.identity_confirmed_at,
  idProofKind: r.id_proof_kind,
  idProofLast4: r.id_proof_last4?.trim() ?? null,
  policeVerificationAt: r.police_verification_at,
  policeVerificationExpires: r.police_verification_expires,
  panVerifiedAt: r.pan_verified_at,
  panNumber: r.pan_number,
  bankVerifiedAt: r.bank_verified_at,
  isGstRegistered: r.is_gst_registered,
});

export const DOCUMENT_COLUMNS = `d.id, d.photographer_id, d.kind, d.review_status, d.reference_last4,
  d.issued_on::text AS issued_on, d.expires_on::text AS expires_on, d.mime_type,
  d.size_bytes::text AS size_bytes, d.storage_key, d.uploaded_at, d.review_note, d.reviewed_at,
  d.purged_at`;

export interface DocumentRow {
  id: string;
  photographer_id: string;
  kind: DocumentKind;
  review_status: DocumentReviewStatus;
  reference_last4: string | null;
  issued_on: string | null;
  expires_on: string | null;
  mime_type: string | null;
  size_bytes: string | null;
  storage_key: string;
  uploaded_at: Date;
  review_note: string | null;
  reviewed_at: Date | null;
  purged_at: Date | null;
}

export const toDocument = (r: DocumentRow): DocumentRecord => ({
  id: r.id,
  photographerId: r.photographer_id,
  kind: r.kind,
  reviewStatus: r.review_status,
  referenceLast4: r.reference_last4?.trim() ?? null,
  issuedOn: r.issued_on,
  expiresOn: r.expires_on,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  storageKey: r.storage_key,
  uploadedAt: r.uploaded_at,
  reviewNote: r.review_note,
  reviewedAt: r.reviewed_at,
  purgedAt: r.purged_at,
});

/** `p.city_id` within the caller's cities. */
export function cityClause(db: Db, scope: CityScope) {
  if (scope === 'ALL') return db`TRUE`;
  if (scope.length === 0) return db`FALSE`;
  return db`p.city_id IN ${db([...scope])}`;
}

export function and(db: Db, parts: readonly postgres.PendingQuery<postgres.Row[]>[]) {
  return parts.reduce((acc, part) => db`${acc} AND ${part}`, db`TRUE`);
}

/** `%`, `_` and `\` are literal in a search, not wildcards. */
export const likeEscape = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Name contains the text, or (with 4+ digits, and only when `byPhone`) the phone contains those
 * digits. A caller who sees masked phones searches by name only: a substring search would
 * otherwise reveal the hidden digits one guess at a time.
 */
export function personSearch(db: Db, text: string, byPhone: boolean) {
  const digits = byPhone ? text.replace(/\D/g, '') : '';
  const name = db`p.full_name ILIKE ${`%${likeEscape(text)}%`}`;
  return digits.length >= 4 ? db`(${name} OR p.phone_e164 LIKE ${`%${digits}%`})` : db`(${name})`;
}

/** Postgres SQLSTATEs the supply services map to 409 / 422. */
export const UNIQUE_VIOLATION = '23505';
export const CHECK_VIOLATION = '23514';
export const FOREIGN_KEY_VIOLATION = '23503';

export const sqlState = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
