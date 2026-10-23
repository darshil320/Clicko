import type { BookingStatus, BookingSummary } from '@clickco/contracts';
import type { BadgeTone } from '@clickco/ui';

export interface StatusPresentation {
  readonly label: string;
  readonly tone: BadgeTone;
}

/** Client wording for every state in the booking state machine (schema §1, ADR-0011). */
const PRESENTATION: Readonly<Record<BookingStatus, StatusPresentation>> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  QUOTED: { label: 'Payment pending', tone: 'warning' },
  ADVANCE_PENDING: { label: 'Payment pending', tone: 'warning' },
  CONFIRMED: { label: 'Awaiting assignment', tone: 'warning' },
  DISPATCHING: { label: 'Awaiting assignment', tone: 'warning' },
  ASSIGNED: { label: 'Photographer assigned', tone: 'accent' },
  EN_ROUTE: { label: 'On the way', tone: 'accent' },
  CHECKED_IN: { label: 'Shoot in progress', tone: 'accent' },
  IN_PROGRESS: { label: 'Shoot in progress', tone: 'accent' },
  CHECKED_OUT: { label: 'Preparing photos', tone: 'neutral' },
  UPLOADING: { label: 'Preparing photos', tone: 'neutral' },
  PROCESSING: { label: 'Preparing photos', tone: 'neutral' },
  QA: { label: 'Preparing photos', tone: 'neutral' },
  BALANCE_PENDING: { label: 'Balance due', tone: 'warning' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  CLOSED: { label: 'Completed', tone: 'success' },
  CANCELLED_CLIENT: { label: 'Cancelled', tone: 'danger' },
  CANCELLED_PRO: { label: 'Cancelled', tone: 'danger' },
  PRO_NO_SHOW: { label: 'Photographer no-show', tone: 'danger' },
  ACCESS_DENIED: { label: 'Venue access denied', tone: 'danger' },
  UNSAFE_SITE: { label: 'Stopped — unsafe site', tone: 'danger' },
  DATA_LOSS: { label: 'Needs attention', tone: 'danger' },
  QUALITY_ESCALATION: { label: 'Under review', tone: 'warning' },
  ABANDONED: { label: 'Expired', tone: 'neutral' },
};

export function statusPresentation(status: BookingStatus): StatusPresentation {
  return PRESENTATION[status];
}

/** Finished one way or another — listed under "Past". */
const FINISHED: ReadonlySet<BookingStatus> = new Set([
  'DELIVERED',
  'CLOSED',
  'CANCELLED_CLIENT',
  'CANCELLED_PRO',
  'PRO_NO_SHOW',
  'ACCESS_DENIED',
  'UNSAFE_SITE',
  'ABANDONED',
]);

/** Ended without a delivered shoot — the journey timeline is replaced by the outcome. */
const HALTED: ReadonlySet<BookingStatus> = new Set([
  'CANCELLED_CLIENT',
  'CANCELLED_PRO',
  'PRO_NO_SHOW',
  'ACCESS_DENIED',
  'UNSAFE_SITE',
  'ABANDONED',
]);

export const isFinished = (status: BookingStatus): boolean => FINISHED.has(status);
export const isHalted = (status: BookingStatus): boolean => HALTED.has(status);
/** The API allows a client cancel only before payment lands (ADR-0009; later = refund ladder, S8). */
export const canCancel = (status: BookingStatus): boolean =>
  status === 'QUOTED' || status === 'ADVANCE_PENDING';
export const awaitingPayment = canCancel;

export interface SplitBookings {
  readonly upcoming: readonly BookingSummary[];
  readonly past: readonly BookingSummary[];
}

/** Upcoming soonest-first; past most-recent-first. Never mutates the input. */
export function splitBookings(bookings: readonly BookingSummary[]): SplitBookings {
  const byStart = (a: BookingSummary, b: BookingSummary) =>
    Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart);
  return {
    upcoming: bookings.filter((b) => !isFinished(b.status)).sort(byStart),
    past: bookings.filter((b) => isFinished(b.status)).sort((a, b) => byStart(b, a)),
  };
}

export type JourneyKey = 'BOOKED' | 'ASSIGNED' | 'SHOOT' | 'PHOTOS';
export type StepState = 'done' | 'current' | 'upcoming';

export interface JourneyStep {
  readonly key: JourneyKey;
  readonly label: string;
  readonly state: StepState;
}

const STEP_LABELS: Readonly<Record<JourneyKey, string>> = {
  BOOKED: 'Booked',
  ASSIGNED: 'Photographer assigned',
  SHOOT: 'Shoot day',
  PHOTOS: 'Photos in 48 hours',
};
const STEP_KEYS: readonly JourneyKey[] = ['BOOKED', 'ASSIGNED', 'SHOOT', 'PHOTOS'];

/** Index of the step the booking is working on; 4 = all done. */
function currentStep(status: BookingStatus): number {
  switch (status) {
    case 'DRAFT':
    case 'QUOTED':
    case 'ADVANCE_PENDING':
      return 0;
    case 'CONFIRMED':
    case 'DISPATCHING':
      return 1;
    case 'ASSIGNED':
    case 'EN_ROUTE':
    case 'CHECKED_IN':
    case 'IN_PROGRESS':
      return 2;
    case 'CHECKED_OUT':
    case 'UPLOADING':
    case 'PROCESSING':
    case 'QA':
    case 'BALANCE_PENDING':
    case 'DATA_LOSS':
    case 'QUALITY_ESCALATION':
      return 3;
    default:
      return 4;
  }
}

/** The four-step timeline on Screen 5 and the booking detail: Booked → … → Photos. */
export function journey(status: BookingStatus): readonly JourneyStep[] {
  const current = currentStep(status);
  return STEP_KEYS.map((key, index) => ({
    key,
    label: key === 'PHOTOS' && current === 4 ? 'Photos delivered' : STEP_LABELS[key],
    state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
  }));
}
