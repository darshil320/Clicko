import {
  type DocumentKind,
  KYC_LINK_TTL_SECONDS,
  type VerificationCheck,
} from '@clickco/contracts';
import type { CityScope, VerificationRecord } from './supply.types';

/**
 * Pure supply rules (ADR-0026 D5). Approving a document is the "human ticked it" of schema §6:
 * an identity document confirms identity (kind + last 4 only, never the number — Invariant 15),
 * PAN / bank proof / police verification tick their checks. Other documents are records only.
 */
const EFFECT: Readonly<Partial<Record<DocumentKind, VerificationCheck>>> = {
  DRIVING_LICENCE: 'IDENTITY',
  PASSPORT: 'IDENTITY',
  VOTER_ID: 'IDENTITY',
  PAN_CARD: 'PAN',
  BANK_PROOF: 'BANK',
  POLICE_VERIFICATION: 'POLICE',
};

export function verificationEffect(kind: DocumentKind): VerificationCheck | null {
  return EFFECT[kind] ?? null;
}

const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The IST calendar day (YYYY-MM-DD) of an instant. */
export const istToday = (now: Date): string => IST_DATE.format(now);

/** A document valid through `expiresOn` (inclusive); null never expires. */
export function isDocumentExpired(expiresOn: string | null, today: string): boolean {
  return expiresOn !== null && expiresOn < today;
}

export const KYC_LINK_TTL_MS = KYC_LINK_TTL_SECONDS * 1_000;

export const kycLinkExpiry = (now: Date): Date => new Date(now.getTime() + KYC_LINK_TTL_MS);

export const DAY_MS = 86_400_000;

const CHECK_LABEL = {
  IDENTITY: 'an identity document',
  POLICE: 'the police verification',
  PAN: 'the PAN card',
  BANK: 'the bank proof',
} as const;

export const covers = (scope: CityScope, cityId: string): boolean =>
  scope === 'ALL' || scope.includes(cityId);

/** The four checks an ACTIVE photographer needs (schema pro_active_requires_verification). */
export function missingChecks(v: VerificationRecord): VerificationCheck[] {
  return [
    ...(v.identityConfirmedAt ? [] : (['IDENTITY'] as const)),
    ...(v.policeVerificationAt ? [] : (['POLICE'] as const)),
    ...(v.panVerifiedAt ? [] : (['PAN'] as const)),
    ...(v.bankVerifiedAt ? [] : (['BANK'] as const)),
  ];
}

/** "Approve the PAN card and the bank proof first." */
export function missingChecksMessage(missing: readonly VerificationCheck[]): string {
  const labels = missing.map((m) => CHECK_LABEL[m]);
  const list =
    labels.length <= 1
      ? (labels[0] ?? '')
      : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  return `Approve ${list} first`;
}
