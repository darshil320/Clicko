import { DAY_MS, istToday } from './supply-rules';

/**
 * KYC document retention (DPDP Act s.8(7) and the DPDP Rules: erase personal data once its purpose
 * is served; schema §6 photographer_documents: "Purge when the relationship ends").
 *
 * No document states a KYC retention period: ADR-0030 (follow-ups) and docs/store/privacy-labels.md
 * only say `purge_after` is set when the relationship ends, and docs/clickco-v0.2-locked-spec.md
 * fixes media retention only. So the documents are kept 180 days after the relationship ends:
 * long enough to answer a dispute, a chargeback or a payout/TDS (s.194C) query about the last
 * jobs, and to resolve an offboarding complaint — never longer. The tax records themselves
 * (payouts, TDS, vendor invoices, PAN on `photographers`) are not these files and are not purged
 * here. Rejected or withdrawn applicants were never paid, but no document gives them a shorter
 * period, so they use the same 180 days until an ADR sets one.
 */
export const KYC_RETENTION = {
  /** Days after offboarding (photographers.status → OFFBOARDED) before the files are purged. */
  daysAfterRelationshipEnds: 180,
  /** Days after an application is rejected or withdrawn (never onboarded). Same until an ADR. */
  daysAfterApplicationClosed: 180,
  /** Documents purged per sweep run; the next run takes the rest. */
  purgeBatch: 50,
} as const;

/** Outbox events for the retention state changes (rule 7). */
export const KYC_EVENTS = {
  /** purge_after was set on a photographer's unpurged documents. */
  SCHEDULED: 'photographer.kyc_purge_scheduled',
  /** A reopened application cleared a pending purge_after. */
  CANCELLED: 'photographer.kyc_purge_cancelled',
  /** One document's file was deleted through StoragePort and its identifiers erased. */
  PURGED: 'photographer_document.purged',
} as const;

export type KycPurgeReason = 'OFFBOARDED' | 'APPLICATION_REJECTED' | 'APPLICATION_WITHDRAWN';

/** purge_after (a date): the IST calendar day of `now` plus `days`. */
export function kycPurgeAfter(now: Date, days: number): string {
  const today = Date.parse(`${istToday(now)}T00:00:00.000Z`);
  return new Date(today + days * DAY_MS).toISOString().slice(0, 10);
}
