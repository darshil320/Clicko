import { z } from 'zod';

export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });

/** Indian 6-digit pincode; never starts with 0. */
export const Pincode = z.string().regex(/^[1-9]\d{5}$/, 'must be a 6-digit Indian pincode');
export type Pincode = z.infer<typeof Pincode>;

/** Indian mobile in E.164 (+91 then 10 digits starting 6–9). */
export const PhoneE164 = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'must be +91 followed by a 10-digit mobile');
export type PhoneE164 = z.infer<typeof PhoneE164>;

export const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLng>;
