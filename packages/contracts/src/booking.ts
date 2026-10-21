import { z } from 'zod';
import { IsoDateTime, PhoneE164, Pincode, Uuid } from './common.js';
import { BookingStatus, EmergencyBand, PlanTier } from './enums.js';
import { Hours, MoneyPaise } from './money.js';
import { PriceSnapshot } from './price-snapshot.js';

export const BookingReference = z.string().regex(/^CLK-\d+$/, 'must look like CLK-4821');

export const Contact = z.object({ name: z.string().min(1), phone: PhoneE164 });
export type Contact = z.infer<typeof Contact>;

export const GalleryRecipient = z.enum(['BOOKER', 'SUBJECT']);

export const Venue = z.object({
  pincode: Pincode,
  address: z.string().min(1),
  landmark: z.string().nullable(),
});

/** Client-facing booking. Totals are denormalised from the latest snapshot; the snapshot is truth. */
export const Booking = z
  .object({
    id: Uuid,
    reference: BookingReference,
    status: BookingStatus,
    userId: Uuid,
    cityId: Uuid,
    categoryCode: z.string().min(1),
    tier: PlanTier,
    scheduledStart: IsoDateTime,
    scheduledHours: Hours,
    emergencyBand: EmergencyBand,
    venue: Venue,
    booker: Contact,
    subject: Contact.nullable(),
    galleryRecipient: GalleryRecipient,
    totalPaise: MoneyPaise,
    advancePaise: MoneyPaise,
    balancePaise: MoneyPaise,
    amountPaidPaise: MoneyPaise,
    price: PriceSnapshot.optional(),
    createdAt: IsoDateTime,
  })
  .refine((b) => b.advancePaise + b.balancePaise === b.totalPaise, {
    message: 'advance + balance must equal total',
    path: ['balancePaise'],
  })
  .refine((b) => b.price === undefined || b.price.totalAmountPaise === b.totalPaise, {
    message: 'denormalised total must match the attached price snapshot',
    path: ['totalPaise'],
  })
  .refine((b) => b.galleryRecipient !== 'SUBJECT' || b.subject !== null, {
    message: 'a subject contact is required when the gallery goes to the subject',
    path: ['subject'],
  });
export type Booking = z.infer<typeof Booking>;
