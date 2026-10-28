import type {
  AssignmentEventKind,
  AssignmentStatus,
  BookingStatus,
  ProAssignmentDetail,
} from '@clickco/contracts';
import type { OnsiteActionKind, QueuedAction } from '@/shared/offline/queue';
import {
  billingStartsAt,
  clientAbsentOpensAt,
  earliestCheckOutAt,
  opensAt,
  uploadDeadlineAt,
} from './timing';

/**
 * The job as the screen shows it (ADR-0024 D5): the server's state, moved ahead by this job's
 * actions still waiting in the offline queue. Pure, so every rule is tested.
 */

/** The shoot's stages in order; ENDED is any terminal outcome other than a check-out. */
export type JobStage =
  | 'ASSIGNED'
  | 'EN_ROUTE'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'CHECKED_OUT'
  | 'ENDED';

export type EndReason =
  | 'ACCESS_DENIED'
  | 'UNSAFE_SITE'
  | 'CANCELLED_BY_CLIENT'
  | 'RELEASED'
  | 'NO_SHOW'
  | 'CANCELLED';

export interface JobTiming {
  /** Scheduled start − 3 h: en-route and check-in open (ADR-0013 D2). */
  readonly opensAt: string;
  readonly isOpen: boolean;
  /** max(check-in, scheduled start), once checked in. */
  readonly billingStartsAt: string | null;
  /** The server's once it knows the check-in; computed here while it is queued. */
  readonly earliestCheckOutAt: string | null;
  readonly canCheckOut: boolean;
  readonly clientAbsentOpensAt: string | null;
  readonly uploadDeadlineAt: string | null;
}

export interface JobProjection {
  readonly stage: JobStage;
  readonly endReason: EndReason | null;
  /** Anything for this job is still waiting in the queue. */
  readonly syncing: boolean;
  readonly queued: readonly OnsiteActionKind[];
  readonly checkedInAt: string | null;
  readonly checkedOutAt: string | null;
  readonly declaredFrameCount: number | null;
  readonly clientAbsent: boolean;
  readonly waiting: { readonly minutes: number | null; readonly at: string } | null;
  readonly extensionQueued: boolean;
  readonly accessDeniedAt: string | null;
  readonly unsafeAt: string | null;
  /** Cancelling is allowed until check-in, and only with nothing of this job still queued. */
  readonly canCancel: boolean;
  readonly timing: JobTiming;
}

const RANK: Readonly<Record<Exclude<JobStage, 'ENDED'>, number>> = {
  ASSIGNED: 0,
  EN_ROUTE: 1,
  CHECKED_IN: 2,
  IN_PROGRESS: 3,
  CHECKED_OUT: 4,
};

/** The stage a queued action reaches once the server has it (check-in auto-walks en-route). */
const REACHES: Partial<Record<OnsiteActionKind, Exclude<JobStage, 'ENDED'>>> = {
  EN_ROUTE: 'EN_ROUTE',
  CHECK_IN: 'CHECKED_IN',
  START: 'IN_PROGRESS',
  CHECK_OUT: 'CHECKED_OUT',
  CLIENT_ABSENT: 'CHECKED_OUT',
};

const BOOKING_STAGE: Partial<Record<BookingStatus, JobStage>> = {
  ASSIGNED: 'ASSIGNED',
  EN_ROUTE: 'EN_ROUTE',
  CHECKED_IN: 'CHECKED_IN',
  IN_PROGRESS: 'IN_PROGRESS',
  CHECKED_OUT: 'CHECKED_OUT',
  UPLOADING: 'CHECKED_OUT',
  PROCESSING: 'CHECKED_OUT',
  QA: 'CHECKED_OUT',
  BALANCE_PENDING: 'CHECKED_OUT',
  DELIVERED: 'CHECKED_OUT',
  CLOSED: 'CHECKED_OUT',
  QUALITY_ESCALATION: 'CHECKED_OUT',
  DATA_LOSS: 'CHECKED_OUT',
};

const ASSIGNMENT_STAGE: Readonly<Record<AssignmentStatus, JobStage>> = {
  ASSIGNED: 'ASSIGNED',
  EN_ROUTE: 'EN_ROUTE',
  ACTIVE: 'CHECKED_IN',
  COMPLETED: 'CHECKED_OUT',
  ABANDONED: 'ENDED',
  RELEASED: 'ENDED',
};

/** Terminal outcomes, checked before the normal stage mapping. */
function endReasonOf(booking: BookingStatus, assignment: AssignmentStatus): EndReason | null {
  if (booking === 'ACCESS_DENIED') return 'ACCESS_DENIED';
  if (booking === 'UNSAFE_SITE') return 'UNSAFE_SITE';
  if (booking === 'CANCELLED_CLIENT') return 'CANCELLED_BY_CLIENT';
  if (assignment === 'RELEASED') return 'RELEASED';
  if (assignment === 'ABANDONED') return 'NO_SHOW';
  if (
    booking === 'CANCELLED_PRO' ||
    booking === 'PRO_NO_SHOW' ||
    booking === 'ABANDONED' ||
    booking === 'DISPATCHING'
  ) {
    return 'CANCELLED';
  }
  return null;
}

/** Moves a stage forward (never back) for each queued action, in queue order. */
export function advanceStage(stage: JobStage, kinds: readonly OnsiteActionKind[]): JobStage {
  if (stage === 'ENDED') return stage;
  return kinds.reduce<JobStage>((current, kind) => {
    const target = REACHES[kind];
    if (!target || current === 'ENDED') return current;
    return RANK[target] > RANK[current] ? target : current;
  }, stage);
}

/** When the photographer tapped: the action's own deviceTs, else when it was queued. */
function tappedAt(item: QueuedAction): string {
  const { action } = item;
  switch (action.kind) {
    case 'EN_ROUTE':
    case 'START':
      return item.queuedAt;
    case 'EXTENSION':
      return action.deviceTs;
    default:
      return action.body.deviceTs ?? item.queuedAt;
  }
}

const firstEvent = (detail: ProAssignmentDetail, kind: AssignmentEventKind) =>
  detail.events.find((e) => e.kind === kind) ?? null;

const firstQueued = (pending: readonly QueuedAction[], kinds: readonly OnsiteActionKind[]) =>
  pending.find((p) => kinds.includes(p.action.kind)) ?? null;

function reportedAt(
  detail: ProAssignmentDetail,
  pending: readonly QueuedAction[],
  event: AssignmentEventKind,
  kind: OnsiteActionKind,
): string | null {
  const reported = firstEvent(detail, event);
  if (reported) return reported.occurredAt;
  const queued = firstQueued(pending, [kind]);
  return queued ? tappedAt(queued) : null;
}

function waitingOf(detail: ProAssignmentDetail, pending: readonly QueuedAction[]) {
  const logged = firstEvent(detail, 'WAITING_LOGGED');
  if (logged) return { minutes: logged.minutes, at: logged.occurredAt };
  const queued = firstQueued(pending, ['WAITING']);
  if (queued?.action.kind !== 'WAITING') return null;
  return { minutes: queued.action.body.minutes, at: tappedAt(queued) };
}

function checkOutOf(detail: ProAssignmentDetail, pending: readonly QueuedAction[]) {
  if (detail.checkOut) {
    return { at: detail.checkOut.at, frames: detail.checkOut.declaredFrameCount };
  }
  const queued = firstQueued(pending, ['CHECK_OUT', 'CLIENT_ABSENT']);
  if (!queued) return null;
  const frames = queued.action.kind === 'CHECK_OUT' ? queued.action.body.declaredFrameCount : 0;
  return { at: tappedAt(queued), frames };
}

/** The server's values once it has the check-in; the same rule applied locally while queued. */
function billingOf(detail: ProAssignmentDetail, checkedInAt: string | null): string | null {
  if (detail.checkIn) {
    return detail.billingStartsAt ?? billingStartsAt(detail.checkIn.at, detail.scheduledStart);
  }
  return checkedInAt ? billingStartsAt(checkedInAt, detail.scheduledStart) : null;
}

function earliestOf(detail: ProAssignmentDetail, billing: string | null): string | null {
  if (!billing) return null;
  if (detail.checkIn && detail.earliestCheckOutAt) return detail.earliestCheckOutAt;
  return earliestCheckOutAt(billing, detail.scheduledHours, detail.approvedExtensionHours);
}

function timingOf(
  detail: ProAssignmentDetail,
  checkedInAt: string | null,
  checkedOutAt: string | null,
  now: Date,
): JobTiming {
  const opens = opensAt(detail.scheduledStart);
  const billing = billingOf(detail, checkedInAt);
  const earliest = earliestOf(detail, billing);
  return {
    opensAt: opens,
    isOpen: now.getTime() >= Date.parse(opens),
    billingStartsAt: billing,
    earliestCheckOutAt: earliest,
    canCheckOut: earliest !== null && now.getTime() >= Date.parse(earliest),
    clientAbsentOpensAt: billing ? clientAbsentOpensAt(billing) : null,
    uploadDeadlineAt: checkedOutAt ? uploadDeadlineAt(checkedOutAt) : null,
  };
}

export function projectJob(
  detail: ProAssignmentDetail,
  pending: readonly QueuedAction[],
  now: Date,
): JobProjection {
  const mine = pending.filter((p) => p.assignmentId === detail.assignmentId);
  const queued = mine.map((p) => p.action.kind);
  const endReason = endReasonOf(detail.bookingStatus, detail.status);
  const serverStage: JobStage = endReason
    ? 'ENDED'
    : (BOOKING_STAGE[detail.bookingStatus] ?? ASSIGNMENT_STAGE[detail.status]);
  const stage = advanceStage(serverStage, queued);

  const queuedCheckIn = firstQueued(mine, ['CHECK_IN']);
  const checkedInAt = detail.checkIn?.at ?? (queuedCheckIn ? tappedAt(queuedCheckIn) : null);
  const checkOut = checkOutOf(detail, mine);
  const clientAbsent =
    firstEvent(detail, 'CLIENT_ABSENT_REPORTED') !== null ||
    firstQueued(mine, ['CLIENT_ABSENT']) !== null;

  return {
    stage,
    endReason,
    syncing: mine.length > 0,
    queued,
    checkedInAt,
    checkedOutAt: checkOut?.at ?? null,
    declaredFrameCount: checkOut?.frames ?? null,
    clientAbsent,
    waiting: waitingOf(detail, mine),
    extensionQueued: queued.includes('EXTENSION'),
    accessDeniedAt: reportedAt(detail, mine, 'ACCESS_DENIED_REPORTED', 'ACCESS_DENIED'),
    unsafeAt: reportedAt(detail, mine, 'UNSAFE_REPORTED', 'UNSAFE'),
    canCancel: (stage === 'ASSIGNED' || stage === 'EN_ROUTE') && mine.length === 0,
    timing: timingOf(detail, checkedInAt, checkOut?.at ?? null, now),
  };
}
