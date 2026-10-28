import type {
  AssignmentEventKind,
  AssignmentEventView,
  AssignmentStatus,
  PlanTier,
  ProAssignmentDetail,
} from '@clickco/contracts';
import { TIER_REQUIREMENTS } from '@/shared/catalogue';
import type { OnsiteActionKind } from '@/shared/offline/queue';
import { formatDistance } from './errors';
import { advanceStage, type EndReason, type JobProjection, type JobStage } from './project';

/** Display words for the job: badges, list labels, the checklist and the activity timeline. */

/** India's single emergency number — said plainly wherever a photographer may be unsafe. */
export const SAFETY_LINE = "If you're in danger, leave now and call 112.";
export const EMERGENCY_DIAL_URL = 'tel:112';

/** The StatusBadge tones this feature uses (never the accent: that is the stage's primary action). */
export type JobBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'emergency';

export interface Badge {
  readonly label: string;
  readonly tone: JobBadgeTone;
}

const STAGE_BADGE: Readonly<Record<Exclude<JobStage, 'ENDED'>, Badge>> = {
  ASSIGNED: { label: 'Booked', tone: 'neutral' },
  EN_ROUTE: { label: 'On the way', tone: 'neutral' },
  CHECKED_IN: { label: 'Checked in', tone: 'success' },
  IN_PROGRESS: { label: 'Shooting', tone: 'success' },
  CHECKED_OUT: { label: 'Checked out', tone: 'success' },
};

const END_BADGE: Readonly<Record<EndReason, Badge>> = {
  ACCESS_DENIED: { label: 'Access denied', tone: 'danger' },
  UNSAFE_SITE: { label: 'Unsafe site', tone: 'emergency' },
  CANCELLED_BY_CLIENT: { label: 'Cancelled by client', tone: 'neutral' },
  RELEASED: { label: 'No longer yours', tone: 'neutral' },
  NO_SHOW: { label: 'Missed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const SYNCING = ' · waiting to sync';

export function stageBadge(job: Pick<JobProjection, 'stage' | 'endReason' | 'syncing'>): Badge {
  const base =
    job.stage === 'ENDED' ? END_BADGE[job.endReason ?? 'CANCELLED'] : STAGE_BADGE[job.stage];
  return job.syncing ? { label: `${base.label}${SYNCING}`, tone: 'warning' } : base;
}

const LIST_BASE: Readonly<Record<AssignmentStatus, JobStage>> = {
  ASSIGNED: 'ASSIGNED',
  EN_ROUTE: 'EN_ROUTE',
  ACTIVE: 'CHECKED_IN',
  COMPLETED: 'CHECKED_OUT',
  ABANDONED: 'ENDED',
  RELEASED: 'ENDED',
};

/** The list has no booking status: ACTIVE may be before or after Start, so it reads "On site". */
const LIST_LABEL: Readonly<Record<JobStage, string>> = {
  ASSIGNED: 'Booked',
  EN_ROUTE: 'On the way',
  CHECKED_IN: 'On site',
  IN_PROGRESS: 'Shooting',
  CHECKED_OUT: 'Checked out',
  ENDED: 'Ended',
};

export function listLabel(status: AssignmentStatus, queued: readonly OnsiteActionKind[]): string {
  const label = LIST_LABEL[advanceStage(LIST_BASE[status], queued)];
  return queued.length > 0 ? `${label}${SYNCING}` : label;
}

export interface ChecklistItem {
  readonly key: string;
  readonly label: string;
}

/** Tiers whose kit includes lighting say so in the catalogue's gear line (shared/catalogue.ts). */
const LIGHTING = /lighting/i;

/** Pre-shoot checklist for the tier the client bought (doc 01 screen 13). Local only. */
export function checklistFor(tier: PlanTier): readonly ChecklistItem[] {
  const { gear, dualCard } = TIER_REQUIREMENTS[tier];
  const items: ChecklistItem[] = [
    { key: 'kit', label: `Kit: ${gear}` },
    { key: 'batteries', label: 'Batteries charged, spares packed' },
    dualCard
      ? { key: 'cards', label: 'Dual cards inserted, recording to both' }
      : { key: 'cards', label: 'Memory card formatted, with space' },
  ];
  return LIGHTING.test(gear)
    ? [...items, { key: 'lighting', label: 'Lighting kit packed' }]
    : items;
}

const EXTENSION_KINDS: ReadonlySet<AssignmentEventKind> = new Set([
  'EXTENSION_REQUESTED',
  'EXTENSION_APPROVED',
  'EXTENSION_DECLINED',
]);

/** ADR-0013 D8 decline reasons (apps/api onsite/rules/extensions.ts). */
const DECLINE_NOTE: Readonly<Record<string, string>> = {
  DECLINED_BY_CLIENT: 'The client declined your last request.',
  EXPIRED: "Your last request lapsed — the client didn't answer in time.",
  CALENDAR_CONFLICT:
    'Your last request was declined — you have another booking right after this one.',
  SHOOT_ENDED: 'Your last request closed when the shoot ended.',
  REPRICED: 'The price changed before the client answered — send a new request.',
};

const byTime = (a: { occurredAt: string }, b: { occurredAt: string }): number =>
  Date.parse(a.occurredAt) - Date.parse(b.occurredAt);

/** Why the latest extension request did not go through, if that is the latest news. */
export function declineNote(events: readonly AssignmentEventView[]): string | null {
  const latest = events
    .filter((e) => EXTENSION_KINDS.has(e.kind))
    .sort(byTime)
    .at(-1);
  if (latest?.kind !== 'EXTENSION_DECLINED') return null;
  return DECLINE_NOTE[latest.note ?? ''] ?? 'Your last request was declined.';
}

const EVENT_TITLE: Readonly<Record<AssignmentEventKind, string>> = {
  EXTENSION_REQUESTED: 'Extension requested',
  EXTENSION_APPROVED: 'Extension approved',
  EXTENSION_DECLINED: 'Extension declined',
  WAITING_LOGGED: 'Waiting logged',
  NOTE: 'Note',
  PROOF_UPLOADED: 'Proof photo added',
  UNSAFE_REPORTED: 'Unsafe site reported',
  ACCESS_DENIED_REPORTED: 'Access denied reported',
  CLIENT_ABSENT_REPORTED: 'Client absent reported',
  NO_SHOW_SUSPECTED: 'No check-in by the start',
  GEOFENCE_UNVERIFIED: 'Location sent for review',
};

export interface TimelineEntry {
  readonly key: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly at: string;
}

const TIMELINE_LENGTH = 8;

function eventSubtitle(event: AssignmentEventView): string | undefined {
  if (event.kind === 'WAITING_LOGGED' && event.minutes !== null) return `${event.minutes} min`;
  if (event.kind === 'EXTENSION_DECLINED' && event.note === 'EXPIRED') return 'Lapsed';
  if (event.kind === 'GEOFENCE_UNVERIFIED') return "The venue isn't mapped exactly yet";
  return undefined;
}

function fixSubtitle(distanceM: number | null, offline: boolean): string | undefined {
  const parts = [
    distanceM === null ? null : `${formatDistance(distanceM)} from the venue`,
    offline ? 'sent later' : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

const withSubtitle = (entry: Omit<TimelineEntry, 'subtitle'>, subtitle: string | undefined) =>
  subtitle === undefined ? entry : { ...entry, subtitle };

/** A short, light activity list: check-in, on-site events, check-out — the latest few. */
export function timelineEntries(detail: ProAssignmentDetail): readonly TimelineEntry[] {
  const { checkIn, checkOut } = detail;
  const entries: TimelineEntry[] = [
    ...(checkIn
      ? [
          withSubtitle(
            { key: 'check-in', title: 'Checked in', at: checkIn.at },
            fixSubtitle(checkIn.distanceM, checkIn.offline),
          ),
        ]
      : []),
    ...detail.events.map((event) =>
      withSubtitle(
        { key: event.eventId, title: EVENT_TITLE[event.kind], at: event.occurredAt },
        eventSubtitle(event),
      ),
    ),
    ...(checkOut
      ? [
          withSubtitle(
            { key: 'check-out', title: 'Checked out', at: checkOut.at },
            checkOut.declaredFrameCount === null
              ? undefined
              : `${checkOut.declaredFrameCount} frames`,
          ),
        ]
      : []),
  ];
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-TIMELINE_LENGTH);
}
