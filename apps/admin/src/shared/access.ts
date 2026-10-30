import {
  ADMIN_DESK_ROLES,
  ADMIN_DESKS,
  type AdminDesk,
  type StaffGrant,
  type StaffRole,
} from '@clickco/contracts';

/**
 * ADR-0025 D3 + ADR-0026 — which desks a staff member may open. The desk list and roles come
 * from `@clickco/contracts`, the same source the API guards use. The API enforces every rule;
 * the panel only hides what the server would refuse anyway. SUPER_ADMIN passes every check.
 */
export const DESKS = ADMIN_DESKS;
export type Desk = AdminDesk;

export const DESK_ROLES: Readonly<Record<Desk, ReadonlyArray<StaffRole>>> = ADMIN_DESK_ROLES;

type Grants = ReadonlyArray<Pick<StaffGrant, 'role' | 'cityId' | 'cityName'>>;

export function isSuperAdmin(grants: Grants): boolean {
  return grants.some((g) => g.role === 'SUPER_ADMIN');
}

export function canUse(grants: Grants, desk: Desk): boolean {
  return isSuperAdmin(grants) || grants.some((g) => DESK_ROLES[desk].includes(g.role));
}

export type NavSection = 'Operations' | 'Money' | 'Supply' | 'Customer care' | 'Admin';

export interface NavEntry {
  readonly desk: Desk;
  readonly href: `/${string}`;
  readonly label: string;
  readonly section: NavSection;
}

/** The left navigation, grouped and in order (ADR-0026 D8). */
export const NAV: ReadonlyArray<NavEntry> = [
  { desk: 'overview', href: '/today', label: 'Today', section: 'Operations' },
  { desk: 'bookings', href: '/bookings', label: 'Bookings', section: 'Operations' },
  { desk: 'dispatch', href: '/dispatch', label: 'Dispatch', section: 'Operations' },
  { desk: 'qa', href: '/qa', label: 'QA', section: 'Operations' },
  { desk: 'incidents', href: '/incidents', label: 'Incidents', section: 'Operations' },
  { desk: 'alerts', href: '/alerts', label: 'Alerts', section: 'Operations' },
  { desk: 'reviews', href: '/reviews', label: 'To settle', section: 'Money' },
  { desk: 'refunds', href: '/refunds', label: 'Refunds', section: 'Money' },
  { desk: 'payouts', href: '/payouts', label: 'Payouts', section: 'Money' },
  { desk: 'pricing', href: '/pricing', label: 'Pricing', section: 'Money' },
  { desk: 'photographers', href: '/photographers', label: 'Photographers', section: 'Supply' },
  { desk: 'quality', href: '/quality', label: 'Quality issues', section: 'Customer care' },
  { desk: 'tickets', href: '/tickets', label: 'Support tickets', section: 'Customer care' },
  { desk: 'claims', href: '/claims', label: 'Equipment claims', section: 'Customer care' },
  { desk: 'breaches', href: '/breaches', label: 'Late deliveries', section: 'Customer care' },
  { desk: 'staff', href: '/staff', label: 'Staff', section: 'Admin' },
];

export function navFor(grants: Grants): ReadonlyArray<NavEntry> {
  return NAV.filter((entry) => canUse(grants, entry.desk));
}

/** Where a signed-in person lands: their first desk, or nowhere if they have none. */
export function homeFor(grants: Grants): string | null {
  return navFor(grants)[0]?.href ?? null;
}

/** The desk a path belongs to (`/bookings/…` → bookings, `/today` → overview), or null. */
export function deskOf(pathname: string): Desk | null {
  const first = pathname.split('/')[1] ?? '';
  const entry = NAV.find((n) => n.href === `/${first}`);
  return entry ? entry.desk : null;
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
