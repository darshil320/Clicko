import type {
  AdminIncidentKind,
  BookingStatus,
  DispatchOutcome,
  EmergencyBand,
  QaStatus,
  SlaClockState,
} from '@clickco/contracts';
import type { BadgeVariant } from '@clickco/ui-web';

/**
 * Which badge tone each state gets. Tone never stands alone — the badge carries the label
 * (DESIGN.md §Accessibility). Emergency colour is for the emergency tier only.
 */
const BOOKING_TONE: Readonly<Record<BookingStatus, BadgeVariant>> = {
  DRAFT: 'neutral',
  QUOTED: 'neutral',
  ADVANCE_PENDING: 'neutral',
  CONFIRMED: 'outline',
  DISPATCHING: 'warning',
  ASSIGNED: 'outline',
  EN_ROUTE: 'outline',
  CHECKED_IN: 'outline',
  IN_PROGRESS: 'outline',
  CHECKED_OUT: 'outline',
  UPLOADING: 'outline',
  PROCESSING: 'outline',
  QA: 'warning',
  BALANCE_PENDING: 'warning',
  DELIVERED: 'success',
  CLOSED: 'success',
  CANCELLED_CLIENT: 'neutral',
  CANCELLED_PRO: 'destructive',
  PRO_NO_SHOW: 'destructive',
  ACCESS_DENIED: 'destructive',
  UNSAFE_SITE: 'destructive',
  DATA_LOSS: 'destructive',
  QUALITY_ESCALATION: 'destructive',
  ABANDONED: 'destructive',
};

export const bookingTone = (status: BookingStatus): BadgeVariant => BOOKING_TONE[status];

/** Booking flags from the board (NEEDS_REVIEW, OPS_ALERT, SLA_BREACHED, INCIDENT_REPORTED…). */
export function flagTone(flag: string): BadgeVariant {
  if (flag === 'SLA_BREACHED') return 'destructive';
  if (flag === 'NEEDS_REVIEW' || flag === 'OPS_ALERT' || flag === 'INCIDENT_REPORTED') {
    return 'warning';
  }
  return 'neutral';
}

export const emergencyTone = (band: EmergencyBand): BadgeVariant | null =>
  band === 'NONE' ? null : 'emergency';

const CLOCK_TONE: Readonly<Record<SlaClockState, BadgeVariant>> = {
  ARMED: 'outline',
  MET: 'success',
  BREACHED: 'destructive',
  CANCELLED: 'neutral',
};
export const clockTone = (state: SlaClockState): BadgeVariant => CLOCK_TONE[state];

const QA_TONE: Readonly<Record<QaStatus, BadgeVariant>> = {
  PENDING: 'warning',
  PASSED: 'success',
  FAILED: 'destructive',
};
export const qaTone = (status: QaStatus): BadgeVariant => QA_TONE[status];

const INCIDENT_TONE: Readonly<Record<AdminIncidentKind, BadgeVariant>> = {
  ACCESS_DENIED: 'warning',
  UNSAFE_SITE: 'destructive',
  CLIENT_ABSENT: 'neutral',
};
export const incidentTone = (kind: AdminIncidentKind): BadgeVariant => INCIDENT_TONE[kind];

/** Alerts: a needs-review flag is a warning, an ops alert is destructive. */
export function alertTone(type: string): BadgeVariant {
  if (type === 'ops.alert') return 'destructive';
  if (type.endsWith('.needs_review')) return 'warning';
  return 'neutral';
}

const OFFER_TONE: Readonly<Record<DispatchOutcome, BadgeVariant>> = {
  PENDING: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  LOST_RACE: 'neutral',
};
export const offerTone = (outcome: DispatchOutcome): BadgeVariant => OFFER_TONE[outcome];
