import type { StaffRole } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  canSeeClientPhone,
  DESK_ROLES,
  type Desk,
  type GrantFacts,
  maskPhone,
  scopeCovers,
  scopeFor,
} from '../access/roles';

const SURAT = '11111111-1111-4111-8111-111111111111';
const MUMBAI = '22222222-2222-4222-8222-222222222222';
const g = (role: StaffRole, cityId: string | null = null): GrantFacts => ({ role, cityId });

/** ADR-0025 D3, row by row (✓ = allowed). */
const MATRIX: Readonly<Record<Desk, readonly StaffRole[]>> = {
  bookings: [
    'SUPER_ADMIN',
    'CITY_MANAGER',
    'OPS_AGENT',
    'QUALITY_MANAGER',
    'SUPPORT',
    'FINANCE',
    'READ_ONLY',
  ],
  qa: ['SUPER_ADMIN', 'CITY_MANAGER', 'OPS_AGENT', 'QUALITY_MANAGER'],
  incidents: ['SUPER_ADMIN', 'CITY_MANAGER', 'OPS_AGENT'],
  dispatch: ['SUPER_ADMIN', 'CITY_MANAGER', 'OPS_AGENT', 'SUPPORT', 'READ_ONLY'],
  breaches: ['SUPER_ADMIN', 'CITY_MANAGER', 'QUALITY_MANAGER'],
  alerts: [
    'SUPER_ADMIN',
    'CITY_MANAGER',
    'OPS_AGENT',
    'QUALITY_MANAGER',
    'SUPPORT',
    'FINANCE',
    'READ_ONLY',
  ],
  staff: ['SUPER_ADMIN'],
};

const ALL_ROLES: readonly StaffRole[] = [
  'SUPER_ADMIN',
  'FINANCE',
  'CITY_MANAGER',
  'OPS_AGENT',
  'QUALITY_MANAGER',
  'SUPPORT',
  'READ_ONLY',
];

describe('the S9 role matrix', () => {
  it('matches ADR-0025 D3 exactly', () => {
    for (const desk of Object.keys(MATRIX) as Desk[]) {
      expect([...DESK_ROLES[desk]].sort(), desk).toEqual([...MATRIX[desk]].sort());
    }
    expect(Object.keys(DESK_ROLES).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  it.each(Object.keys(MATRIX) as Desk[])('%s: allowed roles get a scope, others none', (desk) => {
    for (const role of ALL_ROLES) {
      const cityId = role === 'CITY_MANAGER' ? SURAT : null;
      const scope = scopeFor([g(role, cityId)], DESK_ROLES[desk]);
      expect(scope === null, `${desk} / ${role}`).toBe(!MATRIX[desk].includes(role));
    }
  });
});

describe('city scope', () => {
  it('SUPER_ADMIN passes every desk in every city, even with a city on the grant', () => {
    expect(scopeFor([g('SUPER_ADMIN', SURAT)], DESK_ROLES.staff)).toBe('ALL');
    expect(scopeFor([g('SUPER_ADMIN')], DESK_ROLES.breaches)).toBe('ALL');
  });

  it('a CITY_MANAGER sees only their cities; a NULL city grant sees all', () => {
    expect(scopeFor([g('CITY_MANAGER', SURAT)], DESK_ROLES.qa)).toEqual([SURAT]);
    expect(scopeFor([g('OPS_AGENT')], DESK_ROLES.qa)).toBe('ALL');
  });

  it('only grants whose role opens this desk widen the scope', () => {
    // READ_ONLY everywhere does not open QA in Mumbai for a Surat city manager.
    const grants = [g('READ_ONLY'), g('CITY_MANAGER', SURAT)];
    expect(scopeFor(grants, DESK_ROLES.qa)).toEqual([SURAT]);
    expect(scopeFor(grants, DESK_ROLES.bookings)).toBe('ALL');
  });

  it('merges cities from several grants without duplicates', () => {
    const grants = [g('CITY_MANAGER', SURAT), g('CITY_MANAGER', MUMBAI), g('CITY_MANAGER', SURAT)];
    expect([...(scopeFor(grants, DESK_ROLES.incidents) as string[])].sort()).toEqual(
      [SURAT, MUMBAI].sort(),
    );
  });

  it('no grants means no access', () => {
    expect(scopeFor([], DESK_ROLES.bookings)).toBeNull();
  });

  it('scopeCovers checks one city', () => {
    expect(scopeCovers('ALL', MUMBAI)).toBe(true);
    expect(scopeCovers([SURAT], SURAT)).toBe(true);
    expect(scopeCovers([SURAT], MUMBAI)).toBe(false);
  });
});

describe('READ_ONLY masking', () => {
  it('masks the client phone unless a non-READ_ONLY grant covers the city', () => {
    expect(canSeeClientPhone([g('READ_ONLY')], SURAT)).toBe(false);
    expect(canSeeClientPhone([g('READ_ONLY'), g('CITY_MANAGER', SURAT)], SURAT)).toBe(true);
    expect(canSeeClientPhone([g('READ_ONLY'), g('CITY_MANAGER', SURAT)], MUMBAI)).toBe(false);
    expect(canSeeClientPhone([g('FINANCE')], MUMBAI)).toBe(true);
  });

  it('keeps the country code and the last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91******3210');
    expect(maskPhone('123')).toBe('***');
  });
});
