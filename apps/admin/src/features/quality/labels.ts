import type { AdminQualityFilter, QualityOutcome, QualityStatus } from '@clickco/contracts';
import type { BadgeVariant } from '@clickco/ui-web';
import { formatRupees } from '../../shared/money-labels';

export const OUTCOME_LABEL: Readonly<Record<QualityOutcome, string>> = {
  CREDIT: 'Credit for their next booking',
  PARTIAL_REFUND: 'Partial refund',
  RESHOOT: 'Free reshoot',
  NO_ACTION: 'No action — the photos meet the plan',
};

export const STATUS: Readonly<Record<QualityStatus, { label: string; tone: BadgeVariant }>> = {
  OPEN: { label: 'New', tone: 'warning' },
  IN_REVIEW: { label: 'In review', tone: 'outline' },
  RESOLVED: { label: 'Decided', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
};

export const FILTER_LABEL: Readonly<Record<AdminQualityFilter, string>> = {
  OPEN: 'Open',
  RESOLVED: 'Decided',
  ALL: 'All',
};

/** What a QM decision will do, in plain words (the confirm dialog). */
export function decisionConsequence(d: {
  readonly outcome: QualityOutcome;
  readonly amountPaise: number;
  readonly clientName: string;
  readonly reference: string;
}): string {
  const closes = `The issue and booking ${d.reference} close.`;
  switch (d.outcome) {
    case 'CREDIT':
      return `A ${formatRupees(d.amountPaise)} credit for ${d.clientName} goes to "To settle" for approval. ${closes}`;
    case 'PARTIAL_REFUND':
      return `A ${formatRupees(d.amountPaise)} refund to ${d.clientName} goes to "To settle" for approval. ${closes}`;
    case 'RESHOOT':
      return `Ops is asked to book a free reshoot for ${d.clientName}. ${closes}`;
    case 'NO_ACTION':
      return `${d.clientName} gets no compensation; tell them why. ${closes}`;
  }
}

export const qualityKeys = {
  all: ['care', 'quality'] as const,
  list: (filter: AdminQualityFilter) => ['care', 'quality', filter] as const,
};
