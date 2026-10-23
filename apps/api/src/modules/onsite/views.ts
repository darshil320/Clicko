/** On-site records → @clickco/contracts wire shapes. Money crosses as integer paise (ADR-0007). */
import {
  type AssignmentEventView,
  type BookingCharge,
  type BookingPendingExtension,
  CheckInResponse,
  CheckOutResponse,
  type ExtensionRequestView,
  ExtensionRequestView as ExtensionRequestViewSchema,
  type GeofenceBasis,
  type OnsiteChargeAmounts,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import type { BookingChargeRecord } from '../bookings/bookings.types';
import type { OnsiteAssignment } from '../dispatch/dispatch.types';
import { maskOrNull } from '../dispatch/masking';
import type { OnsiteCharge } from '../pricing/engine';
import type { AssignmentEventRecord } from './onsite.types';
import type { ExtensionRequestState } from './rules/extensions';

const iso = (d: Date): string => d.toISOString();

export function toCheckInResponse(r: {
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly checkedInAt: Date;
  readonly distanceM: number;
  readonly accuracyM: number;
  readonly basis: GeofenceBasis;
  readonly verified: boolean;
  readonly offline: boolean;
  readonly billingStartsAt: Date;
  readonly replayed: boolean;
}): CheckInResponse {
  return CheckInResponse.parse({
    assignmentId: r.assignmentId,
    bookingId: r.bookingId,
    bookingStatus: 'CHECKED_IN',
    checkedInAt: iso(r.checkedInAt),
    distanceM: r.distanceM,
    accuracyM: r.accuracyM,
    geofenceBasis: r.basis,
    geofenceVerified: r.verified,
    offline: r.offline,
    billingStartsAt: iso(r.billingStartsAt),
    replayed: r.replayed,
  });
}

export interface CheckOutView {
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly checkedOutAt: Date;
  readonly slaT0: Date;
  readonly deliveryDueAt: Date;
  readonly distanceM: number;
  readonly basis: GeofenceBasis;
  readonly verified: boolean;
  readonly declaredFrameCount: number;
  readonly replayed: boolean;
}

export function checkOutJson(r: CheckOutView) {
  return {
    assignmentId: r.assignmentId,
    bookingId: r.bookingId,
    bookingStatus: 'CHECKED_OUT' as const,
    checkedOutAt: iso(r.checkedOutAt),
    slaT0: iso(r.slaT0),
    deliveryDueAt: iso(r.deliveryDueAt),
    distanceM: r.distanceM,
    geofenceBasis: r.basis,
    geofenceVerified: r.verified,
    declaredFrameCount: r.declaredFrameCount,
    replayed: r.replayed,
  };
}

export function toCheckOutResponse(r: CheckOutView): CheckOutResponse {
  return CheckOutResponse.parse(checkOutJson(r));
}

export function chargeAmounts(c: {
  readonly taxablePaise: bigint;
  readonly gstPaise: bigint;
  readonly cgstPaise: bigint;
  readonly sgstPaise: bigint;
  readonly igstPaise: bigint;
  readonly totalPaise: bigint;
}): OnsiteChargeAmounts {
  return {
    taxablePaise: fromPaiseBigint(c.taxablePaise),
    gstPaise: fromPaiseBigint(c.gstPaise),
    cgstPaise: fromPaiseBigint(c.cgstPaise),
    sgstPaise: fromPaiseBigint(c.sgstPaise),
    igstPaise: fromPaiseBigint(c.igstPaise),
    totalPaise: fromPaiseBigint(c.totalPaise),
  };
}

export const amountsOf = (c: OnsiteCharge): OnsiteChargeAmounts =>
  chargeAmounts({
    taxablePaise: c.taxablePaise,
    gstPaise: c.gstAmountPaise,
    cgstPaise: c.gst.cgstPaise,
    sgstPaise: c.gst.sgstPaise,
    igstPaise: c.gst.igstPaise,
    totalPaise: c.totalPaise,
  });

export function toExtensionView(
  request: ExtensionRequestState,
  charge: OnsiteCharge,
  ids: { readonly assignmentId: string; readonly bookingId: string },
): ExtensionRequestView {
  return ExtensionRequestViewSchema.parse({
    eventId: request.eventId,
    assignmentId: ids.assignmentId,
    bookingId: ids.bookingId,
    hours: 1,
    hourlyRatePaise: fromPaiseBigint(charge.ratePerHourPaise),
    charge: amountsOf(charge),
    status: request.status,
    requestedAt: iso(request.requestedAt),
    expiresAt: iso(request.expiresAt),
  });
}

export function toPendingExtension(
  request: ExtensionRequestState,
  charge: OnsiteCharge,
): BookingPendingExtension {
  return {
    eventId: request.eventId,
    hours: 1,
    hourlyRatePaise: fromPaiseBigint(charge.ratePerHourPaise),
    charge: amountsOf(charge),
    requestedAt: iso(request.requestedAt),
    expiresAt: iso(request.expiresAt),
  };
}

export function toBookingCharge(c: BookingChargeRecord): BookingCharge {
  return {
    kind: c.kind,
    snapshotSequence: c.sequence,
    minutes: c.minutes,
    charge: chargeAmounts(c),
    chargedAt: iso(c.computedAt),
  };
}

/** The photographer's own timeline. Notes are theirs; any phone-number run is still masked. */
export function toEventView(e: AssignmentEventRecord): AssignmentEventView {
  return {
    eventId: e.id,
    kind: e.kind,
    minutes: e.minutes,
    amountPaise: e.amountPaise === null ? null : fromPaiseBigint(e.amountPaise),
    note: maskOrNull(e.note),
    actorKind: e.actorKind,
    occurredAt: iso(e.occurredAt),
  };
}

export function checkInView(a: OnsiteAssignment) {
  return a.checkInAt
    ? {
        at: iso(a.checkInAt),
        accuracyM: a.checkInAccuracyM,
        offline: a.checkInOffline,
        distanceM: a.checkInDistanceM,
      }
    : null;
}

export function checkOutView(a: OnsiteAssignment) {
  return a.checkOutAt
    ? {
        at: iso(a.checkOutAt),
        accuracyM: a.checkOutAccuracyM,
        offline: a.checkOutOffline,
        declaredFrameCount: a.declaredFrameCount,
      }
    : null;
}
