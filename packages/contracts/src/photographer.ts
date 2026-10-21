import { z } from 'zod';
import { Uuid } from './common.js';
import { PhotographerStatus, PlanTier } from './enums.js';

/**
 * Client-facing photographer profile. Deliberately has no phone, email or
 * address: calling is masked (DOMAIN Invariant 11). Unknown keys are stripped.
 */
export const Photographer = z.object({
  id: Uuid,
  displayName: z.string().min(1),
  cityId: Uuid,
  status: PhotographerStatus,
  maxTier: PlanTier,
  categoryCodes: z.array(z.string().min(1)),
  ratingAverage: z.number().min(0).max(5).nullable(),
  completedShoots: z.int().min(0),
  acceptsEmergency: z.boolean(),
});
export type Photographer = z.infer<typeof Photographer>;
