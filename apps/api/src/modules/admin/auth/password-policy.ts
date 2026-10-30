import { STAFF_PASSWORD_POLICY, staffPasswordProblem } from '@clickco/contracts';
import { UnprocessableEntityException } from '@nestjs/common';
import type { StaffRecord } from '../staff/staff.repository';
import { verifyPassword } from './password';

/**
 * ADR-0026 D7 — the staff password lifecycle, as small pure rules plus one hash check:
 * temporary passwords expire 72 hours after they are issued; a new password is 12–128
 * characters, not the email, and not the password it replaces.
 */

const HOUR_MS = 60 * 60 * 1000;

/** When a temporary password issued at `now` stops working. */
export function temporaryPasswordExpiry(now: Date): Date {
  return new Date(now.getTime() + STAFF_PASSWORD_POLICY.temporaryTtlHours * HOUR_MS);
}

/** A temporary password past its expiry. A chosen password never expires. */
export function temporaryPasswordExpired(
  staff: Pick<StaffRecord, 'mustChangePassword' | 'tempPasswordExpiresAt'>,
  now: Date,
): boolean {
  if (!staff.mustChangePassword) return false;
  // The schema guarantees an expiry with every temporary password; a missing one fails closed.
  return staff.tempPasswordExpiresAt === null || staff.tempPasswordExpiresAt <= now;
}

export const TEMPORARY_PASSWORD_EXPIRED = {
  code: 'TEMPORARY_PASSWORD_EXPIRED',
  message:
    'This temporary password has expired (they last 72 hours). Ask a super admin to reset it.',
} as const;

const rejected = (message: string) =>
  new UnprocessableEntityException({ code: 'PASSWORD_REJECTED', message });

/**
 * Refuses a new password that breaks the policy, with the reason a person can act on. The
 * "not the current one" check runs against the stored hash (one scrypt), so it holds for a
 * temporary password the server never kept in plain text.
 */
export async function assertNewPassword(
  newPassword: string,
  staff: Pick<StaffRecord, 'email' | 'passwordHash'>,
): Promise<void> {
  const problem = staffPasswordProblem(newPassword, { email: staff.email });
  if (problem) throw rejected(problem);
  if (await verifyPassword(newPassword, staff.passwordHash)) {
    throw rejected('Choose a password different from the current one');
  }
}
