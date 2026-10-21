import { z } from 'zod';
import { LatLng, Uuid } from './common.js';
import { AreaStatus, CityTier } from './enums.js';

export const City = z.object({
  id: Uuid,
  name: z.string().min(1),
  state: z.string().min(1),
  tier: CityTier,
  status: AreaStatus,
  centre: LatLng,
});
export type City = z.infer<typeof City>;
