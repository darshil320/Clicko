import type {
  AdminModerationFilter,
  ModerationDecision,
  ReporterKind,
  ReportReason,
  ReportStatus,
  ReportTargetKind,
} from '@clickco/contracts';
import type { BadgeVariant } from '@clickco/ui-web';

/** Moderation words for people, not codes (ADR-0026 D8, ADR-0027 D4). */

export const REASON_LABEL: Readonly<Record<ReportReason, string>> = {
  ABUSIVE: 'Abusive or offensive',
  HARASSMENT: 'Harassment',
  SPAM: 'Spam or advertising',
  FALSE_INFORMATION: 'False or misleading',
  PERSONAL_INFORMATION: 'Shares personal details',
  UNSAFE_BEHAVIOUR: 'Unsafe behaviour',
  OTHER: 'Something else',
};

export const TARGET_LABEL: Readonly<Record<ReportTargetKind, string>> = {
  REVIEW: 'Review',
  USER: 'Client',
  PHOTOGRAPHER: 'Photographer',
};

/** Who reported, or who a warning goes to. */
export const PERSON_KIND_LABEL: Readonly<Record<ReporterKind, string>> = {
  USER: 'Client',
  PHOTOGRAPHER: 'Photographer',
};

/**
 * `label` is the choice, `action` the button, `done` the outcome. HIDE and WARN act on the
 * target, so they confirm in a dialog first (ADR-0026 D8).
 */
export const DECISION: Readonly<
  Record<ModerationDecision, { label: string; action: string; done: string; confirms: boolean }>
> = {
  HIDE: { label: 'Hide the review', action: 'Hide review', done: 'Hidden', confirms: true },
  KEEP: {
    label: 'Keep it up — it follows the rules',
    action: 'Keep it up',
    done: 'Kept up',
    confirms: false,
  },
  WARN: { label: 'Warn the person', action: 'Record warning', done: 'Warned', confirms: true },
  DISMISS: {
    label: 'Dismiss — nothing to act on',
    action: 'Dismiss report',
    done: 'Dismissed',
    confirms: false,
  },
};

export const STATUS: Readonly<Record<ReportStatus, { label: string; tone: BadgeVariant }>> = {
  OPEN: { label: 'Open', tone: 'warning' },
  ACTIONED: { label: 'Acted on', tone: 'success' },
  DISMISSED: { label: 'Closed, no action', tone: 'neutral' },
};

export const FILTER_LABEL: Readonly<Record<AdminModerationFilter, string>> = {
  OPEN: 'Open',
  DECIDED: 'Decided',
  ALL: 'All',
};

/** "Review of Asha Patel", "Client Rohan Shah", "A photographer" (name unknown). */
export function reportedLabel(r: {
  readonly targetKind: ReportTargetKind;
  readonly targetName: string | null;
}): string {
  if (r.targetName === null) return `A ${TARGET_LABEL[r.targetKind].toLowerCase()}`;
  if (r.targetKind === 'REVIEW') return `Review of ${r.targetName}`;
  return `${TARGET_LABEL[r.targetKind]} ${r.targetName}`;
}

/** "1 of 5" — stars as words, never colour or glyphs alone. */
export function starsLabel(rating: number): string {
  return `${rating} of 5`;
}

/**
 * Whether the review now differs from what was reported (the author edited it before the report
 * was filed, or — before this was refused — while it was open). The desk then shows both.
 */
export function changedSinceReport(
  now: { readonly rating: number; readonly comment: string | null },
  reported: { readonly rating: number; readonly comment: string | null } | null,
): boolean {
  return reported !== null && (reported.rating !== now.rating || reported.comment !== now.comment);
}

/** "No warnings yet", "1 warning", "3 warnings". */
export function warningsLabel(count: number): string {
  if (count === 0) return 'No warnings yet';
  return count === 1 ? '1 warning' : `${count} warnings`;
}

/** "None", "1 open report", "2 open reports". */
export function openReportsLabel(count: number): string {
  if (count === 0) return 'None';
  return count === 1 ? '1 open report' : `${count} open reports`;
}

/** "1 report closed", "3 reports closed" — for a past decision. */
export function reportsClosedLabel(count: number): string {
  return count === 1 ? '1 report closed' : `${count} reports closed`;
}

const possessive = (name: string) => `${name}'s`;

function closesLine(otherOpenReports: number): string {
  if (otherOpenReports === 0) return 'The report closes.';
  const others =
    otherOpenReports === 1 ? '1 other open report' : `${otherOpenReports} other open reports`;
  return `This report and ${others} on the same target close.`;
}

export interface ConsequenceInput {
  readonly decision: ModerationDecision;
  readonly targetKind: ReportTargetKind;
  readonly authorName: string | null;
  readonly photographerName: string | null;
  readonly personName: string | null;
  readonly personWarnings: number;
  readonly otherOpenReports: number;
}

/** What a decision will do, in plain words with names (the confirm dialog, ADR-0026 D8). */
export function decisionConsequence(d: ConsequenceInput): string {
  const closes = closesLine(d.otherOpenReports);
  switch (d.decision) {
    case 'HIDE': {
      const author = d.authorName ? possessive(d.authorName) : "The client's";
      const about = d.photographerName ? ` of ${d.photographerName}` : '';
      const rating = d.photographerName
        ? `${possessive(d.photographerName)} rating`
        : "the photographer's rating";
      return `${author} review${about} will be hidden from the app and stop counting in ${rating}. ${closes}`;
    }
    case 'WARN': {
      const name = d.personName ?? 'This person';
      const total = d.personWarnings + 1;
      const record = total === 1 ? 'their first' : `${total} in total`;
      const stays = d.targetKind === 'REVIEW' ? ' The review stays up.' : '';
      return `A warning goes on ${possessive(name)} record (${record}).${stays} ${closes}`;
    }
    case 'KEEP':
      return `Nothing changes for the ${TARGET_LABEL[d.targetKind].toLowerCase()}. ${closes}`;
    case 'DISMISS':
      return `No action is taken. ${closes}`;
  }
}

/** The toast after a decision: "Review of Asha Patel: hidden". */
export function decidedNotice(decision: ModerationDecision, reported: string): string {
  return `${reported}: ${DECISION[decision].done.toLowerCase()}`;
}

export const moderationKeys = {
  all: ['moderation'] as const,
  list: (filter: AdminModerationFilter) => ['moderation', 'list', filter] as const,
  one: (id: string) => ['moderation', 'one', id] as const,
};
