import { z } from 'zod';
import { PhoneE164, Pincode } from './common.js';
import { AreaStatus, CityTier, PlanTier } from './enums.js';

export const TravelZone = z.union([z.literal(0), z.literal(1), z.literal(2)]);

/** Result of the pincode gate every booking passes first (v0.2 §7, DOMAIN Invariant 23). */
export const ServiceabilityResult = z.discriminatedUnion('bookable', [
  z.object({
    bookable: z.literal(true),
    pincode: Pincode,
    status: z.enum(['LIVE', 'PILOT']),
    areaName: z.string().nullable(),
    city: z.object({ id: z.uuid(), name: z.string(), tier: CityTier }),
    travelZone: TravelZone,
    limitedAvailability: z.boolean(),
  }),
  z.object({
    bookable: z.literal(false),
    pincode: Pincode,
    status: AreaStatus.exclude(['LIVE', 'PILOT']).or(z.literal('UNKNOWN')),
    cityName: z.string().nullable(),
    canJoinWaitlist: z.boolean(),
    waitingCount: z.int().min(0),
  }),
]);
export type ServiceabilityResult = z.infer<typeof ServiceabilityResult>;

export const JoinWaitlistBody = z.object({
  phone: PhoneE164,
  fullName: z.string().trim().min(1).max(120),
  pincode: Pincode,
  cityNameRaw: z.string().trim().max(120).optional(),
  intendedDate: z.iso.date().optional(),
  intendedTier: PlanTier.optional(),
});
export type JoinWaitlistBody = z.infer<typeof JoinWaitlistBody>;

export const JoinWaitlistResponse = z.object({
  joined: z.literal(true),
  waitingCount: z.int().min(1),
});
export type JoinWaitlistResponse = z.infer<typeof JoinWaitlistResponse>;
