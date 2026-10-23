/** ADR-0013 D3 — pure. The distance itself is computed by PostGIS in dispatch/repositories. */
import type { GeofenceBasis } from '@clickco/contracts';
import { ONSITE_CONFIG } from '../onsite.config';

export type GeofenceDecision =
  | { readonly kind: 'ACCEPTED'; readonly verified: boolean }
  | { readonly kind: 'OUTSIDE_GEOFENCE'; readonly limitM: number }
  | { readonly kind: 'LOCATION_TOO_INACCURATE'; readonly maxAccuracyM: number };

export interface GeofenceInput {
  readonly distanceM: number;
  readonly accuracyM: number;
  readonly basis: GeofenceBasis;
}

/**
 * A geocoded venue is a hard 150 m fence. A fallback point (pincode centroid, city centre) is not
 * the venue: within 150 m of it the fix is verified; beyond, up to the basis limit, it is accepted
 * unverified (ops reviews it); further is refused. A fix less accurate than 100 m is refused.
 */
export function decideGeofence(input: GeofenceInput): GeofenceDecision {
  const { radiusM, maxAccuracyM, fallbackMaxM } = ONSITE_CONFIG.geofence;
  if (input.accuracyM > maxAccuracyM) return { kind: 'LOCATION_TOO_INACCURATE', maxAccuracyM };
  if (input.distanceM <= radiusM) return { kind: 'ACCEPTED', verified: true };
  if (input.basis === 'VENUE') return { kind: 'OUTSIDE_GEOFENCE', limitM: radiusM };
  const limitM = fallbackMaxM[input.basis];
  return input.distanceM <= limitM
    ? { kind: 'ACCEPTED', verified: false }
    : { kind: 'OUTSIDE_GEOFENCE', limitM };
}
