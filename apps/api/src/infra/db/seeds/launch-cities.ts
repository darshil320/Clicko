import type { AreaStatus, CityTier } from '@clickco/contracts';

/**
 * Launch configuration (v0.2 §7): Surat LIVE · Mumbai LIVE · Vadodara PILOT.
 *
 * Pincodes are seeded as the core postal ranges for each city, all travel zone 0,
 * with no area names or centroids. VERIFY against the India Post pincode directory
 * before public launch: confirm which numbers exist, add area names and centroids,
 * and move outer pincodes to zone 1. Ops can correct rows later; the seed never
 * overwrites an existing row.
 */
export interface SeedCity {
  readonly name: string;
  readonly state: string;
  readonly tier: CityTier;
  readonly status: AreaStatus;
  readonly centre: { readonly lat: number; readonly lng: number };
  readonly pincodeRanges: ReadonlyArray<readonly [number, number]>;
}

export const LAUNCH_CITIES: readonly SeedCity[] = [
  {
    name: 'Surat',
    state: 'Gujarat',
    tier: 'TIER_1',
    status: 'LIVE',
    centre: { lat: 21.1702, lng: 72.8311 },
    pincodeRanges: [[395001, 395023]],
  },
  {
    name: 'Mumbai',
    state: 'Maharashtra',
    tier: 'METRO',
    status: 'LIVE',
    centre: { lat: 19.076, lng: 72.8777 },
    pincodeRanges: [[400001, 400104]],
  },
  {
    name: 'Vadodara',
    state: 'Gujarat',
    tier: 'TIER_1',
    status: 'PILOT',
    centre: { lat: 22.3072, lng: 73.1812 },
    pincodeRanges: [[390001, 390025]],
  },
];

export function expandPincodes(ranges: SeedCity['pincodeRanges']): string[] {
  return ranges.flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_, i) => String(from + i)),
  );
}
