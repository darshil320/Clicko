'use client';

import type { StaffGrant, StaffRole } from '@clickco/contracts';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from './api';
import { keys } from './query';

type Grants = ReadonlyArray<Pick<StaffGrant, 'role' | 'cityId'>>;

/**
 * Whether these grants hold one of `roles` (SUPER_ADMIN always does) — in `cityId` when given.
 * The panel only hides what the API would refuse anyway (ADR-0025 D3).
 */
export function canAct(grants: Grants, roles: ReadonlyArray<StaffRole>, cityId?: string): boolean {
  return grants.some(
    (g) =>
      g.role === 'SUPER_ADMIN' ||
      (roles.includes(g.role) &&
        (cityId === undefined || g.cityId === null || g.cityId === cityId)),
  );
}

/** The signed-in staff member's grants (shared with the shell's `me` query). */
export function useGrants(): Grants {
  const me = useQuery({ queryKey: keys.me, queryFn: () => adminApi.me() });
  return me.data?.grants ?? [];
}

/** `useCan(SUPPLY_ACTION_ROLES.decideKyc)(cityId)`. */
export function useCan(roles: ReadonlyArray<StaffRole>): (cityId?: string) => boolean {
  const grants = useGrants();
  return (cityId) => canAct(grants, roles, cityId);
}
