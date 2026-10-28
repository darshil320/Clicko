import type { StaffGrant, StaffRole } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  canUse,
  cityScope,
  DESK_ROLES,
  DESKS,
  type Desk,
  deskOf,
  grantLabel,
  homeFor,
  navFor,
  uniqueCities,
} from './access';

const SURAT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PUNE = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const ID = '9f1b5e3c-4d6a-4eaf-9b32-3c4d5e6f7081';

const grant = (role: StaffRole, cityId: string | null = null, cityName: string | null = null) =>
  ({ id: ID, role, cityId, cityName }) satisfies StaffGrant;

/** ADR-0025 D3, transcribed row by row (✓ = allowed). */
const MATRIX: Record<Desk, Record<StaffRole, boolean>> = {
  bookings: {
    SUPER_ADMIN: true,
    CITY_MANAGER: true,
    OPS_AGENT: true,
    QUALITY_MANAGER: true,
    SUPPORT: true,
    FINANCE: true,
    READ_ONLY: true,
  },
  qa: {
    SUPER_ADMIN: true,
    CITY_MANAGER: true,
    OPS_AGENT: true,
    QUALITY_MANAGER: true,
    SUPPORT: false,
    FINANCE: false,
    READ_ONLY: false,
  },
  incidents: {
    SUPER_ADMIN: true,
    CITY_MANAGER: true,
    OPS_AGENT: true,
    QUALITY_MANAGER: false,
    SUPPORT: false,
    FINANCE: false,
    READ_ONLY: false,
  },
  dispatch: {
    SUPER_ADMIN: true,
    CITY_MANAGER: true,
    OPS_AGENT: true,
    QUALITY_MANAGER: false,
    SUPPORT: true,
    FINANCE: false,
    READ_ONLY: true,
  },
  breaches: {
    SUPER_ADMIN: true,
    CITY_MANAGER: true,
    OPS_AGENT: false,
    QUALITY_MANAGER: true,
    SUPPORT: false,
    FINANCE: false,
    READ_ONLY: false,
  },
  alerts: {
    SUPER_ADMIN: true,
    CITY_MANAGER: true,
    OPS_AGENT: true,
    QUALITY_MANAGER: true,
    SUPPORT: true,
    FINANCE: true,
    READ_ONLY: true,
  },
  staff: {
    SUPER_ADMIN: true,
    CITY_MANAGER: false,
    OPS_AGENT: false,
    QUALITY_MANAGER: false,
    SUPPORT: false,
    FINANCE: false,
    READ_ONLY: false,
  },
};

describe('the ADR-0025 D3 role matrix', () => {
  const cases = DESKS.flatMap((desk) =>
    (Object.keys(MATRIX[desk]) as StaffRole[]).map((role) => [desk, role] as const),
  );

  it.each(cases)('%s for %s', (desk, role) => {
    expect(canUse([grant(role, role === 'CITY_MANAGER' ? SURAT : null)], desk)).toBe(
      MATRIX[desk][role],
    );
  });

  it('never lists SUPER_ADMIN: it passes every check', () => {
    for (const roles of Object.values(DESK_ROLES)) expect(roles).not.toContain('SUPER_ADMIN');
  });

  it('allows nothing without a grant', () => {
    for (const desk of DESKS) expect(canUse([], desk)).toBe(false);
  });

  it('unions several grants', () => {
    const grants = [grant('FINANCE'), grant('QUALITY_MANAGER')];
    expect(navFor(grants).map((n) => n.label)).toEqual(['Bookings', 'QA', 'Breaches', 'Alerts']);
  });
});

describe('navigation', () => {
  it('shows only the desks the roles allow, in order', () => {
    expect(navFor([grant('SUPPORT')]).map((n) => n.href)).toEqual([
      '/bookings',
      '/dispatch',
      '/alerts',
    ]);
    expect(navFor([grant('SUPER_ADMIN')])).toHaveLength(7);
  });

  it('lands on the first allowed desk', () => {
    expect(homeFor([grant('READ_ONLY')])).toBe('/bookings');
    expect(homeFor([])).toBeNull();
  });

  it('knows which desk a path is on', () => {
    expect(deskOf('/bookings/7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f')).toBe('bookings');
    expect(deskOf('/staff')).toBe('staff');
    expect(deskOf('/dev/pricing')).toBeNull();
    expect(deskOf('/')).toBeNull();
  });
});

describe('city scope', () => {
  it('is every city for SUPER_ADMIN and for an unscoped grant', () => {
    expect(cityScope([grant('SUPER_ADMIN')], 'qa')).toBe('ALL');
    expect(cityScope([grant('OPS_AGENT')], 'qa')).toBe('ALL');
  });

  it('is the city manager’s cities, only from grants that allow the desk', () => {
    const grants = [
      grant('CITY_MANAGER', SURAT, 'Surat'),
      grant('CITY_MANAGER', PUNE, 'Pune'),
      grant('FINANCE', null, null),
    ];
    expect(cityScope(grants, 'qa')).toEqual([
      { cityId: PUNE, cityName: 'Pune' },
      { cityId: SURAT, cityName: 'Surat' },
    ]);
    expect(cityScope(grants, 'alerts')).toBe('ALL');
  });

  it('dedupes cities by id', () => {
    expect(
      uniqueCities([
        { cityId: SURAT, cityName: 'Surat' },
        { cityId: SURAT, cityName: 'Surat' },
      ]),
    ).toHaveLength(1);
  });
});

describe('grantLabel', () => {
  it('reads as a role, with the city when scoped', () => {
    expect(grantLabel({ role: 'CITY_MANAGER', cityName: 'Surat' })).toBe('City manager · Surat');
    expect(grantLabel({ role: 'SUPER_ADMIN', cityName: null })).toBe('Super admin');
  });
});
