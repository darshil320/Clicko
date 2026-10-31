import { ApiError } from '@clickco/api-client';
import type { AdminStaffRow, StaffGrant } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  canDeactivate,
  canRevoke,
  codeDigits,
  needsCity,
  stepUpCodeIssue,
  stepUpError,
} from './rules';

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

describe('step-up code (audit M3)', () => {
  const httpError = (status: number, code: string, message: string) =>
    new ApiError({ kind: 'HTTP', status, code, message });

  it('accepts exactly six digits', () => {
    expect(stepUpCodeIssue('123456')).toBeNull();
    for (const bad of ['', '12345', '1234567', '12a456']) {
      expect(stepUpCodeIssue(bad)).toBe('Enter the 6-digit code from your authenticator app');
    }
  });

  it('keeps only the first six digits of what was typed or pasted', () => {
    expect(codeDigits('123 456')).toBe('123456');
    expect(codeDigits('12-34-56-78')).toBe('123456');
    expect(codeDigits('abc')).toBe('');
  });

  it("shows the server's message for a wrong, used or rate-limited code", () => {
    const used = 'That code was already used. Wait for the next one and try again.';
    expect(stepUpError(httpError(422, 'STEP_UP_CODE_USED', used))).toBe(used);
    expect(stepUpError(httpError(422, 'STEP_UP_CODE_INVALID', 'That code is not right.'))).toBe(
      'That code is not right.',
    );
    expect(stepUpError(httpError(429, 'RATE_LIMITED', 'Too many wrong codes.'))).toBe(
      'Too many wrong codes.',
    );
  });

  it('leaves every other failure to the toast', () => {
    expect(stepUpError(httpError(409, 'LAST_SUPER_ADMIN', 'One must remain'))).toBeNull();
    expect(stepUpError(new Error('boom'))).toBeNull();
  });
});
