import type { StaffRole } from '@clickco/contracts';

/**
 * ADR-0025 D3 — the S9 role matrix and city scoping, as pure functions. The API decides access;
 * the panel only hides what this would refuse. SUPER_ADMIN passes every check in every city.
 */
export type Desk = 'bookings' | 'qa' | 'incidents' | 'dispatch' | 'breaches' | 'alerts' | 'staff';

const EVERYONE: readonly StaffRole[] = [
  'SUPER_ADMIN',
  'CITY_MANAGER',
  'OPS_AGENT',
  'QUALITY_MANAGER',
  'SUPPORT',
  'FINANCE',
  'READ_ONLY',
];

export const DESK_ROLES: Readonly<Record<Desk, readonly StaffRole[]>> = {
  bookings: EVERYONE,
  qa: ['SUPER_ADMIN', 'CITY_MANAGER', 'OPS_AGENT', 'QUALITY_MANAGER'],
  incidents: ['SUPER_ADMIN', 'CITY_MANAGER', 'OPS_AGENT'],
  dispatch: ['SUPER_ADMIN', 'CITY_MANAGER', 'OPS_AGENT', 'SUPPORT', 'READ_ONLY'],
  breaches: ['SUPER_ADMIN', 'CITY_MANAGER', 'QUALITY_MANAGER'],
  alerts: EVERYONE,
  staff: ['SUPER_ADMIN'],
};

export interface GrantFacts {
  readonly role: StaffRole;
  /** null = every city. */
  readonly cityId: string | null;
}

/** The cities a caller may act in for one desk: every city, a list, or null (no access). */
export type CityScope = 'ALL' | readonly string[];

/**
 * Only grants whose role opens the desk count: READ_ONLY everywhere plus CITY_MANAGER in Surat
 * opens the QA desk in Surat only.
 */
export function scopeFor(
  grants: readonly GrantFacts[],
  roles: readonly StaffRole[],
): CityScope | null {
  if (grants.some((g) => g.role === 'SUPER_ADMIN')) return 'ALL';
  const usable = grants.filter((g) => roles.includes(g.role));
  if (usable.length === 0) return null;
  if (usable.some((g) => g.cityId === null)) return 'ALL';
  return [...new Set(usable.map((g) => g.cityId as string))];
}

export function scopeCovers(scope: CityScope, cityId: string): boolean {
  return scope === 'ALL' || scope.includes(cityId);
}

/** READ_ONLY sees client phones masked; any other role covering the city sees them. */
export function canSeeClientPhone(grants: readonly GrantFacts[], cityId: string): boolean {
  return grants.some(
    (g) =>
      g.role === 'SUPER_ADMIN' ||
      (g.role !== 'READ_ONLY' && (g.cityId === null || g.cityId === cityId)),
  );
}

export function maskPhone(phone: string): string {
  if (phone.length < 8) return '*'.repeat(phone.length);
  return `${phone.slice(0, 3)}${'*'.repeat(phone.length - 7)}${phone.slice(-4)}`;
}
