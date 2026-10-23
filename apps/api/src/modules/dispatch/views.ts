/** Dispatch records → @clickco/contracts wire shapes. Money crosses as integer paise (ADR-0007). */

import type { BookingStatus } from '@clickco/contracts';
import {
  type DispatchDeskView,
  DispatchDeskView as DispatchDeskViewSchema,
  type ProAssignment,
  ProAssignment as ProAssignmentSchema,
  type ProOffer,
  ProOffer as ProOfferSchema,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import type { AssignmentBookingDetail, OfferBookingSummary } from '../bookings/bookings.types';
import type { AreaLabel } from '../serviceability/serviceability.types';
import type { AssignmentRecord, AttemptRecord, PendingOffer, RoundRecord } from './dispatch.types';
import { maskOrNull, maskPhoneNumbers, roundToHalfKm } from './masking';

/** "Ananya Iyer" → "Ananya I." — a photographer never sees a client's full name or phone. */
export function clientDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? 'Client';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

const areaOf = (pincode: string, label: AreaLabel | undefined) => ({
  pincode,
  areaName: label?.areaName ?? null,
  cityName: label?.cityName ?? '',
});

/** Built from the address-free summary: an offer can never carry the venue address. */
export function toProOffer(
  offer: PendingOffer,
  b: OfferBookingSummary,
  label: AreaLabel | undefined,
): ProOffer {
  return ProOfferSchema.parse({
    attemptId: offer.id,
    bookingId: b.bookingId,
    bookingReference: b.reference,
    categoryCode: b.categoryCode,
    tier: b.tier,
    scheduledStart: b.scheduledStart.toISOString(),
    scheduledHours: b.scheduledHours,
    emergencyBand: b.emergencyBand,
    isBroadcast: offer.isBroadcast,
    payoutPaise: fromPaiseBigint(offer.offeredPayoutPaise),
    distanceKm: roundToHalfKm(offer.distanceKm),
    area: areaOf(b.venuePincode, label),
    clientDisplayName: clientDisplayName(b.bookerName),
    expiresAt: offer.expiresAt.toISOString(),
  });
}

export function toProAssignment(
  a: AssignmentRecord,
  b: AssignmentBookingDetail,
  label: AreaLabel | undefined,
  payoutPaise: bigint,
): ProAssignment {
  return ProAssignmentSchema.parse({
    assignmentId: a.id,
    bookingId: b.bookingId,
    bookingReference: b.reference,
    status: a.status,
    categoryCode: b.categoryCode,
    tier: b.tier,
    scheduledStart: b.scheduledStart.toISOString(),
    scheduledHours: b.scheduledHours,
    payoutPaise: fromPaiseBigint(payoutPaise),
    venue: {
      ...areaOf(b.venuePincode, label),
      address: maskPhoneNumbers(b.venueAddress),
      landmark: maskOrNull(b.venueLandmark),
    },
    clientDisplayName: clientDisplayName(b.bookerName),
    specialRequirements: maskOrNull(b.specialRequirements),
    acceptedAt: a.acceptedAt.toISOString(),
  });
}

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

const attemptJson = (a: AttemptRecord, name: (id: string) => string) => ({
  attemptId: a.id,
  photographerId: a.photographerId,
  photographerName: name(a.photographerId),
  rankScore: a.rankScore,
  distanceKm: a.distanceKm,
  offeredPayoutPaise: fromPaiseBigint(a.offeredPayoutPaise),
  notifiedAt: a.notifiedAt.toISOString(),
  expiresAt: a.expiresAt.toISOString(),
  respondedAt: iso(a.respondedAt),
  outcome: a.outcome,
  declineReason: a.declineReason,
});

export function toDeskView(input: {
  readonly bookingId: string;
  readonly status: BookingStatus;
  readonly rounds: readonly RoundRecord[];
  readonly attempts: readonly AttemptRecord[];
  readonly assignments: readonly AssignmentRecord[];
  readonly names: ReadonlyMap<string, string>;
}): DispatchDeskView {
  const name = (id: string) => input.names.get(id) ?? 'Unknown photographer';
  return DispatchDeskViewSchema.parse({
    bookingId: input.bookingId,
    bookingStatus: input.status,
    rounds: input.rounds.map((r) => ({
      roundId: r.id,
      wave: r.wave,
      radiusKm: r.radiusKm,
      candidateCount: r.candidateCount,
      windowSeconds: r.windowSeconds,
      isBroadcast: r.isBroadcast,
      startedAt: r.startedAt.toISOString(),
      endedAt: iso(r.endedAt),
      outcome: r.outcome,
      attempts: input.attempts.filter((a) => a.roundId === r.id).map((a) => attemptJson(a, name)),
    })),
    assignments: input.assignments.map((a) => ({
      assignmentId: a.id,
      photographerId: a.photographerId,
      photographerName: name(a.photographerId),
      status: a.status,
      blockedFrom: a.blockedFrom.toISOString(),
      blockedUntil: a.blockedUntil.toISOString(),
      acceptedAt: a.acceptedAt.toISOString(),
      releasedAt: iso(a.releasedAt),
      releaseReason: a.releaseReason,
    })),
  });
}
