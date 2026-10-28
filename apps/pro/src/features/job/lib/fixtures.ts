import type { AssignmentEventView, ProAssignmentDetail } from '@clickco/contracts';
import type { OnsiteAction, QueuedAction } from '@/shared/offline/queue';

/** Test fixtures only (imported by *.test.ts). 4:30 pm IST on 14 Nov 2026, a 2-hour food shoot. */
export const JOB_ID = '6f1c2b8e-4a1d-4f7a-9b55-0c2d7e9a1f30';
export const START = '2026-11-14T11:00:00.000Z';

export function detailOf(overrides: Partial<ProAssignmentDetail> = {}): ProAssignmentDetail {
  return {
    assignmentId: JOB_ID,
    bookingId: '0b7d6a52-93e4-4c1f-8f2a-5d3e1c9b7a60',
    bookingReference: 'CK-7Q4M2',
    bookingStatus: 'ASSIGNED',
    status: 'ASSIGNED',
    categoryCode: 'FOOD',
    tier: 'PROFESSIONAL',
    scheduledStart: START,
    scheduledHours: 2,
    payoutPaise: 550_000,
    venue: {
      address: '12, Ghod Dod Road',
      landmark: 'Opp. Rajhans Cinema',
      pincode: '395007',
      areaName: 'Athwa',
      cityName: 'Surat',
    },
    clientDisplayName: 'Priya S.',
    specialRequirements: null,
    acceptedAt: '2026-11-13T09:00:00.000Z',
    checkIn: null,
    checkOut: null,
    billingStartsAt: null,
    earliestCheckOutAt: null,
    approvedExtensionHours: 0,
    pendingExtension: null,
    events: [],
    ...overrides,
  };
}

export function queuedOf(
  action: OnsiteAction,
  queuedAt: string,
  assignmentId: string = JOB_ID,
): QueuedAction {
  return {
    id: `q-${action.kind}-${queuedAt}`,
    photographerId: 'p-1',
    assignmentId,
    action,
    idempotencyKey: `key-${action.kind}`,
    queuedAt,
    attempts: 0,
    nextAttemptAt: queuedAt,
    lastError: null,
  };
}

export function eventOf(
  kind: AssignmentEventView['kind'],
  occurredAt: string,
  extra: Partial<AssignmentEventView> = {},
): AssignmentEventView {
  return {
    eventId: String(Date.parse(occurredAt) % 1_000_000 || 1),
    kind,
    minutes: null,
    amountPaise: null,
    note: null,
    actorKind: 'PHOTOGRAPHER',
    occurredAt,
    ...extra,
  };
}

export const FIX = {
  lat: 21.1702,
  lng: 72.8311,
  accuracyM: 12,
  mocked: false,
  takenAt: '2026-11-14T10:50:00.000Z',
} as const;
