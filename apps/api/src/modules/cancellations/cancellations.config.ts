import type { BookingStatus, CancellationBand, EmergencyBand } from '@clickco/contracts';

/**
 * The T&C v2 §3 cancellation ladder as data (clickco-terms-conditions-v2.md §3.1–§3.3). An owner
 * or legal ruling changes these numbers, not the code. Refunds are a share of the advance in basis
 * points (10000 = all of it).
 *
 * Boundaries fall in the client's favour where the T&C is silent: exactly 72 h before the shoot
 * is still "3–7 days" (100 %), exactly 24 h is still "24–72 hours" (50 %), and exactly 7 days is
 * not "less than 7 days" for the peak-season forfeit.
 */
export const CANCELLATION_LADDER = {
  /** §3.1, best band first: the first whose `minNoticeHours` the notice reaches applies. */
  standard: [
    { band: 'MORE_THAN_7_DAYS', minNoticeHours: 168, refundBps: 10_000 },
    { band: 'DAYS_3_TO_7', minNoticeHours: 72, refundBps: 10_000 },
    { band: 'HOURS_24_TO_72', minNoticeHours: 24, refundBps: 5_000 },
    { band: 'UNDER_24_HOURS', minNoticeHours: Number.NEGATIVE_INFINITY, refundBps: 0 },
  ] satisfies ReadonlyArray<{
    readonly band: CancellationBand;
    readonly minNoticeHours: number;
    readonly refundBps: number;
  }>,
  /**
   * §3.2: during Peak Season "50 % of the advance is forfeited on any cancellation made less than
   * 7 days before the shoot" — read as written (ADR-0031): under 7 days, a flat 50 % refund of the
   * advance, whatever the notice (so under 24 h is 50 % too). Peak Season is the quote's flag
   * (doc 05 §5).
   */
  peak: { underNoticeHours: 168, refundBps: 5_000 },
  /** §3.3: emergency and same-day bookings — free until a photographer accepts, nothing after. */
  emergency: { beforeAcceptanceBps: 10_000, afterAcceptanceBps: 0 },
} as const;

/**
 * T&C §2.2(b): "Emergency and same-day bookings (24 hours' notice or less)" — the bands paid 100 %
 * at booking (doc 05 §5). NEXT_DAY (24–48 h) is a standard 50/50 booking.
 */
export const EMERGENCY_BANDS: readonly EmergencyBand[] = ['SAME_DAY', 'HOURS_3_8', 'HOURS_UNDER_3'];

/** Nothing has been captured: cancelling needs no refund (the pre-existing path, kept as it was). */
export const UNPAID_CANCELLABLE: readonly BookingStatus[] = ['QUOTED', 'ADVANCE_PENDING'];

/** DOMAIN §2 "any pre-shoot state" once paid: the ladder applies. */
export const PAID_PRE_SHOOT: readonly BookingStatus[] = [
  'CONFIRMED',
  'DISPATCHING',
  'ASSIGNED',
  'EN_ROUTE',
];

/** A photographer has accepted and holds the booking (§3.3 "once accepted"). */
export const PHOTOGRAPHER_ACCEPTED: readonly BookingStatus[] = ['ASSIGNED', 'EN_ROUTE'];

/** Every way a booking has already been cancelled. */
export const CANCELLED: readonly BookingStatus[] = [
  'CANCELLED_CLIENT',
  'CANCELLED_PRO',
  'PRO_NO_SHOW',
];

/** `bookings.cancellation_reason` and the `booking.cancelled_client` payload reason. */
export const CLIENT_CANCELLED_REASON = 'CLIENT_CANCELLED';
/** The reason the unpaid path has always written (unchanged). */
export const CLIENT_CANCELLED_BEFORE_PAYMENT = 'CLIENT_CANCELLED_BEFORE_PAYMENT';
/** `assignments.release_reason` when the client cancels. */
export const ASSIGNMENT_RELEASE_REASON = 'CLIENT_CANCELLED';
