import { z } from 'zod';
import { Contact, GalleryRecipient } from './booking.js';
import { IsoDateTime, Pincode, Uuid } from './common.js';
import { BookingStatus, EmergencyBand, PlanTier } from './enums.js';
import { Hours, MoneyPaise } from './money.js';
import { BookingCharge, BookingPendingExtension } from './onsite.js';
import { AddonCode, PriceQuote } from './pricing.js';

/**
 * POST /bookings — the server re-prices from these inputs; a client-sent total
 * is never trusted (doc 05 principle 2). Consents are opt-in and never defaulted.
 */
export const CreateBookingBody = z
  .object({
    tier: PlanTier.exclude(['SIGNATURE']),
    categoryCode: z.string().regex(/^[A-Z_]{2,32}$/),
    pincode: Pincode,
    scheduledStart: IsoDateTime,
    hours: Hours,
    addons: z
      .array(z.object({ code: AddonCode, quantity: z.int().min(1).max(4).default(1) }))
      .max(8)
      .default([]),
    travelDistanceKm: z.number().min(0).max(500).multipleOf(0.01).optional(),
    promoCode: z.string().trim().toUpperCase().min(3).max(32).optional(),
    venueAddress: z.string().trim().min(5).max(500),
    venueLandmark: z.string().trim().max(200).optional(),
    booker: Contact,
    subject: Contact.optional(),
    galleryRecipient: GalleryRecipient.default('BOOKER'),
    specialRequirements: z.string().trim().max(2000).optional(),
    modelReleaseConsent: z.boolean(),
    acceptedTermsVersion: z.string().min(1).max(32),
  })
  .refine((b) => b.galleryRecipient !== 'SUBJECT' || b.subject !== undefined, {
    message: 'a subject contact is required when the gallery goes to the subject',
    path: ['subject'],
  });
export type CreateBookingBody = z.input<typeof CreateBookingBody>;
export type CreateBookingRequest = z.output<typeof CreateBookingBody>;

export const BookingSummary = z.object({
  id: Uuid,
  reference: z.string(),
  status: BookingStatus,
  tier: PlanTier,
  categoryCode: z.string(),
  cityName: z.string(),
  scheduledStart: IsoDateTime,
  scheduledHours: Hours,
  emergencyBand: EmergencyBand,
  venueAddress: z.string(),
  totalPaise: MoneyPaise,
  advancePaise: MoneyPaise,
  balancePaise: MoneyPaise,
  amountPaidPaise: MoneyPaise,
  quoteExpiresAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type BookingSummary = z.infer<typeof BookingSummary>;

export const CreateBookingResponse = z.object({ booking: BookingSummary, quote: PriceQuote });
export type CreateBookingResponse = z.infer<typeof CreateBookingResponse>;

export const PaymentGateway = z.enum(['SANDBOX', 'RAZORPAY']);

/** POST /bookings/:id/pay — opens the advance (or full / authorise-only) payment. */
export const PayBookingResponse = z.object({
  paymentId: Uuid,
  gateway: PaymentGateway,
  providerOrderId: z.string(),
  amountPaise: MoneyPaise,
  authorizeOnly: z.boolean(),
  /** Public checkout key for the client SDK; null for the sandbox. */
  checkoutKeyId: z.string().nullable(),
});
export type PayBookingResponse = z.infer<typeof PayBookingResponse>;

export const BookingTimelineEntry = z.object({
  fromStatus: BookingStatus.nullable(),
  toStatus: BookingStatus,
  actorKind: z.enum(['SYSTEM', 'USER', 'PHOTOGRAPHER', 'STAFF']),
  reason: z.string().nullable(),
  occurredAt: IsoDateTime,
});

export const InvoiceView = z.object({
  invoiceNumber: z.string(),
  purpose: z.enum(['ADVANCE', 'BALANCE', 'FULL', 'EXTENSION', 'EDIT_SERVICE']),
  taxablePaise: MoneyPaise,
  cgstPaise: MoneyPaise,
  sgstPaise: MoneyPaise,
  igstPaise: MoneyPaise,
  totalPaise: MoneyPaise,
  issuedAt: IsoDateTime,
});

/**
 * GET /bookings/:id — owner only. `pendingExtensions` (awaiting the client's approval) and `charges`
 * (approved extensions, waiting time) arrive with on-site operations (ADR-0013); optional so older
 * consumers keep parsing.
 */
export const BookingDetail = z.object({
  booking: BookingSummary,
  timeline: z.array(BookingTimelineEntry),
  invoices: z.array(InvoiceView),
  pendingExtensions: z.array(BookingPendingExtension).optional(),
  charges: z.array(BookingCharge).optional(),
});
export type BookingDetail = z.infer<typeof BookingDetail>;

/** Development only: POST /dev/payments/:paymentId/simulate — the sandbox gateway "pays". */
export const SimulatePaymentBody = z.object({ outcome: z.enum(['CAPTURED', 'FAILED']) });
