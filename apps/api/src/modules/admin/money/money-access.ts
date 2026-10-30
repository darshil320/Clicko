import type { StaffRole } from '@clickco/contracts';
import { NotFoundException } from '@nestjs/common';
import { scopeCovers } from '../access/roles';
import type { StaffCaller } from '../access/staff-context';

/** The caller's roles that apply in `cityId` (an all-cities grant always applies). */
export function rolesIn(caller: StaffCaller, cityId: string): StaffRole[] {
  return [
    ...new Set(
      caller.grants
        .filter((g) => g.role === 'SUPER_ADMIN' || g.cityId === null || g.cityId === cityId)
        .map((g) => g.role),
    ),
  ];
}

/**
 * ADR-0025 D3 for entities the CityScopeGuard does not know (refunds, review events): another
 * city's item answers exactly like a missing one.
 */
export function assertInScope(
  caller: StaffCaller,
  cityId: string | null,
  notFound: { readonly code: string; readonly message: string },
): void {
  if (cityId === null ? caller.scope !== 'ALL' : !scopeCovers(caller.scope, cityId)) {
    throw new NotFoundException(notFound);
  }
}
