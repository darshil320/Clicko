/** doc 05 §3 step 10 (travel). Never multiplied; passes through to the photographer at 100%. */
import { roundHalfUp } from '@clickco/utils';
import { METRES_PER_KM } from './constants';
import { type Outcome, ok, reject } from './outcome';
import type { ResolvedVenue, Ruleset, TravelSlabRule } from './types';

export interface PricedTravel {
  readonly amountPaise: bigint;
  readonly zone: 0 | 1 | 2;
  /** The distance actually priced (the slab's floor when no distance was supplied). */
  readonly distanceMetres: number;
  readonly isMeasured: boolean;
}

/** Zone 0 is inclusive at its top (exactly 15 km = zone 0); other slabs are (from, to]. */
function slabForDistance(
  slabs: readonly TravelSlabRule[],
  distanceMetres: number,
): TravelSlabRule | undefined {
  const zone0 = slabs.find((s) => s.zone === 0);
  if (zone0 !== undefined && (zone0.toMetres === null || distanceMetres <= zone0.toMetres)) {
    return zone0;
  }
  return slabs.find(
    (s) => s.fromMetres < distanceMetres && (s.toMetres === null || distanceMetres <= s.toMetres),
  );
}

function assertDistance(distanceMetres: number | undefined): void {
  if (distanceMetres === undefined) return;
  if (!Number.isSafeInteger(distanceMetres) || distanceMetres < 0) {
    throw new RangeError(
      `priceTravel: travelDistanceMetres must be a non-negative integer, got ${distanceMetres}`,
    );
  }
}

export function priceTravel(
  ruleset: Ruleset,
  venue: ResolvedVenue,
  distanceMetres: number | undefined,
): Outcome<PricedTravel> {
  assertDistance(distanceMetres);
  const slabs = ruleset.travelSlabs.filter((s) => s.cityTier === venue.cityTier);
  const slab =
    distanceMetres === undefined
      ? slabs.find((s) => s.zone === venue.travelZone)
      : slabForDistance(slabs, distanceMetres);
  if (slab === undefined) {
    return reject('NO_TRAVEL_SLAB', `No travel slab for ${venue.cityTier} at this distance`);
  }
  const priced = distanceMetres ?? slab.fromMetres;
  const beyondMetres = BigInt(Math.max(0, priced - slab.fromMetres));
  const overnightPaise = slab.zone === 2 ? slab.overnightPaise : 0n;
  const amountPaise =
    slab.flatPaise + roundHalfUp(slab.perKmPaise * beyondMetres, METRES_PER_KM) + overnightPaise;
  return ok({
    amountPaise,
    zone: slab.zone,
    distanceMetres: priced,
    isMeasured: distanceMetres !== undefined,
  });
}
