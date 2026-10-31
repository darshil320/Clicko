import { isApiError } from '@clickco/api-client';
import {
  type AdminStaffRow,
  type StaffGrant,
  type StaffRole,
  StepUpCode,
} from '@clickco/contracts';

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

/**
 * Audit M3: creating staff, granting a role, deactivating, and resetting an authenticator or a
 * password each need a fresh 6-digit code from the caller's authenticator app. The form's own
 * check: null when the code is well formed, else what to fix.
 */
export function stepUpCodeIssue(code: string): string | null {
  const parsed = StepUpCode.safeParse(code);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Enter the 6-digit code');
}

/** The server's answers about the code itself, shown under the code field (and in the toast). */
const STEP_UP_ERRORS: ReadonlySet<string> = new Set([
  'STEP_UP_CODE_INVALID',
  'STEP_UP_CODE_USED',
  'STEP_UP_UNAVAILABLE',
  'RATE_LIMITED',
]);

/** The server's message when a request failed because of the code, else null. */
export function stepUpError(error: unknown): string | null {
  if (!isApiError(error) || error.kind !== 'HTTP' || !STEP_UP_ERRORS.has(error.code)) return null;
  return error.message || null;
}

/** Digits only, at most six: what the code field keeps of what was typed or pasted. */
export const codeDigits = (typed: string): string => typed.replace(/\D/g, '').slice(0, 6);
