import type { StaffGrant, StaffRole } from '@clickco/contracts';

/**
 * ADR-0025 D3 — which desks a staff member may open. The API enforces every rule; the panel
 * only hides what the server would refuse anyway (D6). SUPER_ADMIN passes every check, so it is
 * not listed. CITY_MANAGER is limited to their cities by the server.
 */
export const DESKS = [
  'bookings',
  'qa',
  'incidents',
  'dispatch',
  'breaches',
  'alerts',
  'staff',
] as const;
export type Desk = (typeof DESKS)[number];

export const DESK_ROLES: Readonly<Record<Desk, ReadonlyArray<StaffRole>>> = {
  /** Booking board + detail (READ_ONLY sees the client phone masked — the server masks it). */
  bookings: ['CITY_MANAGER', 'OPS_AGENT', 'QUALITY_MANAGER', 'SUPPORT', 'FINANCE', 'READ_ONLY'],
  /** QA pass / fail. */
  qa: ['CITY_MANAGER', 'OPS_AGENT', 'QUALITY_MANAGER'],
  /** Confirm incident. */
  incidents: ['CITY_MANAGER', 'OPS_AGENT'],
  /** Dispatch desk (view). */
  dispatch: ['CITY_MANAGER', 'OPS_AGENT', 'SUPPORT', 'READ_ONLY'],
  /** Breach attribute / waive. */
  breaches: ['CITY_MANAGER', 'QUALITY_MANAGER'],
  /** Alert feed. */
  alerts: ['CITY_MANAGER', 'OPS_AGENT', 'QUALITY_MANAGER', 'SUPPORT', 'FINANCE', 'READ_ONLY'],
  /** Staff management. */
  staff: [],
};

type Grants = ReadonlyArray<Pick<StaffGrant, 'role' | 'cityId' | 'cityName'>>;

export function isSuperAdmin(grants: Grants): boolean {
  return grants.some((g) => g.role === 'SUPER_ADMIN');
}

export function canUse(grants: Grants, desk: Desk): boolean {
  return isSuperAdmin(grants) || grants.some((g) => DESK_ROLES[desk].includes(g.role));
}

export interface NavEntry {
  readonly desk: Desk;
  readonly href: `/${string}`;
  readonly label: string;
}

/** The left navigation, in order (ADR-0025 D6). */
export const NAV: ReadonlyArray<NavEntry> = [
  { desk: 'bookings', href: '/bookings', label: 'Bookings' },
  { desk: 'qa', href: '/qa', label: 'QA' },
  { desk: 'incidents', href: '/incidents', label: 'Incidents' },
  { desk: 'dispatch', href: '/dispatch', label: 'Dispatch' },
  { desk: 'breaches', href: '/breaches', label: 'Breaches' },
  { desk: 'alerts', href: '/alerts', label: 'Alerts' },
  { desk: 'staff', href: '/staff', label: 'Staff' },
];

export function navFor(grants: Grants): ReadonlyArray<NavEntry> {
  return NAV.filter((entry) => canUse(grants, entry.desk));
}

/** Where a signed-in person lands: their first desk, or nowhere if they have none. */
export function homeFor(grants: Grants): string | null {
  return navFor(grants)[0]?.href ?? null;
}

/** The desk a path belongs to (`/bookings/…` → bookings), or null outside the desks. */
export function deskOf(pathname: string): Desk | null {
  const first = pathname.split('/')[1] ?? '';
  return (DESKS as ReadonlyArray<string>).includes(first) ? (first as Desk) : null;
}

export interface CityRef {
  readonly cityId: string;
  readonly cityName: string;
}

/**
 * The cities a desk is limited to for this person: 'ALL' when an allowing grant has no city
 * (or the person is SUPER_ADMIN), otherwise the cities of their allowing grants.
 */
export function cityScope(grants: Grants, desk: Desk): 'ALL' | ReadonlyArray<CityRef> {
  if (isSuperAdmin(grants)) return 'ALL';
  const allowing = grants.filter((g) => DESK_ROLES[desk].includes(g.role));
  if (allowing.some((g) => g.cityId === null)) return 'ALL';
  return uniqueCities(
    allowing.map((g) => ({ cityId: g.cityId as string, cityName: g.cityName ?? 'City' })),
  );
}

/** Distinct cities by id, sorted by name. */
export function uniqueCities(cities: ReadonlyArray<CityRef>): ReadonlyArray<CityRef> {
  const byId = new Map<string, CityRef>();
  for (const c of cities) if (!byId.has(c.cityId)) byId.set(c.cityId, c);
  return [...byId.values()].sort((a, b) => a.cityName.localeCompare(b.cityName));
}

/** "Ops agent · Surat", "Super admin" — for the header and the staff list. */
export function grantLabel(grant: Pick<StaffGrant, 'role' | 'cityName'>): string {
  const role = grant.role.toLowerCase().replace(/_/g, ' ');
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  return grant.cityName ? `${label} · ${grant.cityName}` : label;
}
