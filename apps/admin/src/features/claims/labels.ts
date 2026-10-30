import type { AdminClaimFilter, ClaimCause, ClaimStatus } from '@clickco/contracts';
import type { BadgeVariant } from '@clickco/ui-web';

export const CAUSE_LABEL: Readonly<Record<ClaimCause, string>> = {
  CLIENT: 'The client',
  GUEST: 'A guest or someone at the event',
  VENUE_CONDITION: 'Unsafe venue conditions',
};

export const STATUS: Readonly<Record<ClaimStatus, { label: string; tone: BadgeVariant }>> = {
  OPEN: { label: 'New', tone: 'warning' },
  UNDER_REVIEW: { label: 'Being assessed', tone: 'outline' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  RECOVERED: { label: 'Recovered', tone: 'success' },
  WRITTEN_OFF: { label: 'Written off', tone: 'neutral' },
};

export const FILTER_LABEL: Readonly<Record<AdminClaimFilter, string>> = {
  OPEN: 'Open',
  DECIDED: 'Decided',
  ALL: 'All',
};

/** What can be approved: never above the cap or what was claimed. */
export const approvable = (claimedPaise: number, capPaise: number): number =>
  Math.min(claimedPaise, capPaise);

export const claimKeys = {
  all: ['care', 'claims'] as const,
  list: (filter: AdminClaimFilter) => ['care', 'claims', filter] as const,
};
