import type { AdminStaffRow, StaffGrant } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { canDeactivate, canRevoke, needsCity } from './rules';

const ME = '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f';
const OTHER = '8e0a4d2b-3c5f-4d9e-8a21-2b3c4d5e6f70';
const SURAT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const G1 = '9f1b5e3c-4d6a-4eaf-9b32-3c4d5e6f7081';

const superGrant: StaffGrant = { id: G1, role: 'SUPER_ADMIN', cityId: null, cityName: null };
const cityGrant: StaffGrant = { id: G1, role: 'CITY_MANAGER', cityId: SURAT, cityName: 'Surat' };

const row = (id: string, grants: StaffGrant[], isActive = true): AdminStaffRow => ({
  id,
  email: 'vikram.reddy@clickco.in',
  fullName: 'Vikram Reddy',
  isActive,
  totpEnrolled: true,
  temporaryPasswordExpiresAt: null,
  lastLoginAt: null,
  grants,
});

describe('staff rules (ADR-0025 D5)', () => {
  it('never lets a super admin deactivate themselves', () => {
    expect(canDeactivate(row(ME, [superGrant]), ME)).toBe(false);
    expect(canDeactivate(row(OTHER, [superGrant]), ME)).toBe(true);
    expect(canDeactivate(row(OTHER, [superGrant], false), ME)).toBe(false);
  });

  it('never lets a super admin remove their own SUPER_ADMIN grant', () => {
    expect(canRevoke(row(ME, [superGrant, cityGrant]), superGrant, ME)).toBe(false);
    expect(canRevoke(row(ME, [superGrant, cityGrant]), cityGrant, ME)).toBe(true);
    expect(canRevoke(row(OTHER, [superGrant]), superGrant, ME)).toBe(true);
  });

  it('asks for a city for a city manager only', () => {
    expect(needsCity('CITY_MANAGER')).toBe(true);
    expect(needsCity('OPS_AGENT')).toBe(false);
  });
});
