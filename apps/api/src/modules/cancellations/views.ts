/** Cancellation records → @clickco/contracts wire shapes. Money leaves as integer paise (ADR-0007). */
import {
  CancelBookingResponse,
  type CancellationOutcome,
  CancellationQuote,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import type { BookingView } from '../bookings/bookings.types';
import { toBookingSummary } from '../checkout/views';
import type { Assessment } from './cancellations.types';
import { bandReason, blockReason } from './rules/ladder';

const paise = fromPaiseBigint;

export function toQuote(bookingId: string, a: Assessment, now: Date): CancellationQuote {
  const common = {
    bookingId,
    peakSeason: a.peakSeason,
    paidPaise: paise(a.paidPaise),
    quotedAt: now.toISOString(),
  };
  if (a.kind === 'BLOCKED') {
    return CancellationQuote.parse({
      ...common,
      cancellable: false,
      blockedBy: a.block,
      band: null,
      clause: null,
      reason: blockReason(a.block),
      refundPaise: 0,
      keptPaise: 0,
      heldPaise: 0,
      refundBps: 0,
      changesAt: null,
    });
  }
  if (a.kind === 'UNPAID') {
    return CancellationQuote.parse({
      ...common,
      cancellable: true,
      blockedBy: null,
      band: 'BEFORE_PAYMENT',
      clause: null,
      reason:
        a.paidPaise > 0n
          ? 'Your booking was never confirmed, so everything you paid comes back.'
          : bandReason('BEFORE_PAYMENT'),
      refundPaise: paise(a.paidPaise),
      keptPaise: 0,
      heldPaise: 0,
      refundBps: 10_000,
      changesAt: null,
    });
  }
  return CancellationQuote.parse({
    ...common,
    cancellable: true,
    blockedBy: null,
    band: a.step.band,
    clause: a.step.clause,
    reason: bandReason(a.step.band),
    refundPaise: paise(a.split.refundPaise),
    keptPaise: paise(a.split.keptPaise),
    heldPaise: paise(a.heldPaise),
    refundBps: a.step.refundBps,
    changesAt: a.step.changesAt?.toISOString() ?? null,
  });
}

export function toCancelResponse(
  view: BookingView,
  cityName: string,
  outcome: CancellationOutcome,
): CancelBookingResponse {
  return CancelBookingResponse.parse({
    ...toBookingSummary(view, cityName),
    cancellation: outcome,
  });
}
