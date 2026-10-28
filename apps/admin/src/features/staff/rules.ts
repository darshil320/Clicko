import type { AdminStaffRow, StaffGrant, StaffRole } from '@clickco/contracts';

/**
 * Staff management rules the panel mirrors (ADR-0025 D5): a SUPER_ADMIN cannot deactivate
 * themselves or remove their own SUPER_ADMIN grant. The server enforces both.
 */
export function canDeactivate(row: AdminStaffRow, myId: string): boolean {
  return row.isActive && row.id !== myId;
}

export function canRevoke(row: AdminStaffRow, grant: StaffGrant, myId: string): boolean {
  return row.isActive && !(row.id === myId && grant.role === 'SUPER_ADMIN');
}

export const needsCity = (role: StaffRole): boolean => role === 'CITY_MANAGER';
