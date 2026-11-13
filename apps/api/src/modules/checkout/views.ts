/** Domain records → @clickco/contracts wire shapes. Money crosses as integer paise (ADR-0007). */
import {
  type BookingCharge,
  BookingDetail,
  type BookingPendingExtension,
  BookingSummary,
  type PayBookingResponse,
  PayBookingResponse as PayBookingResponseSchema,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import type { BookingView, TimelineEntry } from '../bookings/bookings.types';
import { endedWithoutDelivery } from '../bookings/state-machine';
import type { GatewayName } from '../payments/gateways/payment-gateway.port';
import type { InvoiceRecord, PaymentRecord } from '../payments/payments.types';

/**
 * The client's view of their booking. A booking that ended without a delivery shows no balance:
 * nothing more is payable on it in the app (the stored column keeps the split of the price).
 */
export function toBookingSummary(v: BookingView, cityName: string): BookingSummary {
  return BookingSummary.parse({
    id: v.id,
    reference: v.reference,
    status: v.status,
    tier: v.tier,
    categoryCode: v.categoryCode,
    cityName,
    scheduledStart: v.scheduledStart.toISOString(),
    scheduledHours: v.scheduledHours,
    emergencyBand: v.emergencyBand,
    venueAddress: v.venueAddress,
    totalPaise: fromPaiseBigint(v.totalPaise),
    advancePaise: fromPaiseBigint(v.advancePaise),
    balancePaise: fromPaiseBigint(endedWithoutDelivery(v.status) ? 0n : v.balancePaise),
    amountPaidPaise: fromPaiseBigint(v.amountPaidPaise),
    quoteExpiresAt: v.quoteExpiresAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
  });
}

const toTimelineJson = (t: TimelineEntry) => ({
  fromStatus: t.fromStatus,
  toStatus: t.toStatus,
  actorKind: t.actorKind,
  reason: t.reason,
  occurredAt: t.occurredAt.toISOString(),
});

const toInvoiceJson = (i: InvoiceRecord) => ({
  invoiceNumber: i.invoiceNumber,
  purpose: i.purpose,
  taxablePaise: fromPaiseBigint(i.taxablePaise),
  cgstPaise: fromPaiseBigint(i.cgstPaise),
  sgstPaise: fromPaiseBigint(i.sgstPaise),
  igstPaise: fromPaiseBigint(i.igstPaise),
  totalPaise: fromPaiseBigint(i.totalPaise),
  issuedAt: i.issuedAt.toISOString(),
});

export function toBookingDetail(
  view: BookingView,
  cityName: string,
  timeline: readonly TimelineEntry[],
  invoices: readonly InvoiceRecord[],
  onsite: {
    readonly pendingExtensions: readonly BookingPendingExtension[];
    readonly charges: readonly BookingCharge[];
  } = { pendingExtensions: [], charges: [] },
): BookingDetail {
  return BookingDetail.parse({
    booking: toBookingSummary(view, cityName),
    timeline: timeline.map(toTimelineJson),
    invoices: invoices.map(toInvoiceJson),
    pendingExtensions: onsite.pendingExtensions,
    charges: onsite.charges,
    deliveredAt: view.deliveredAt?.toISOString() ?? null,
  });
}

export function toPayBookingResponse(
  p: PaymentRecord,
  gateway: GatewayName,
  checkoutKeyId: string | null,
): PayBookingResponse {
  if (!p.providerOrderId) throw new Error(`Payment ${p.id} has no gateway order`);
  return PayBookingResponseSchema.parse({
    paymentId: p.id,
    gateway,
    providerOrderId: p.providerOrderId,
    amountPaise: fromPaiseBigint(p.amountPaise),
    authorizeOnly: p.isAuthOnly,
    checkoutKeyId,
  });
}
