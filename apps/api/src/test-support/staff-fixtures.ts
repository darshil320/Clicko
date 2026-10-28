import type { StaffRole } from '@clickco/contracts';
import { base32Decode, totpAt } from '../modules/admin/auth/totp';
import { createStaffAccount } from '../modules/admin/staff/bootstrap';
import { TokenService } from '../modules/auth/token.service';
import type { E2eApp, Json } from './e2e-app';

/** Staff panel test helpers (ADR-0025). */

export async function cityIdOf(e2e: E2eApp, name: string): Promise<string> {
  const [row] = await e2e.db.sql<{ id: string }[]>`SELECT id FROM cities WHERE name = ${name}`;
  if (!row) throw new Error(`cityIdOf: ${name} is not seeded`);
  return row.id;
}

/** An account as the staff:create CLI makes it (temporary password, TOTP not enrolled). */
export async function bootstrapStaff(
  e2e: E2eApp,
  email: string,
  role: StaffRole,
  cityId: string | null = null,
): Promise<{ id: string; password: string }> {
  const r = await createStaffAccount(
    e2e.db.sql,
    { email, fullName: `Test ${role}`, role, cityId, via: 'test' },
    e2e.now(),
  );
  if (r.outcome !== 'CREATED') throw new Error(`bootstrapStaff: ${email} exists`);
  return { id: r.staffId, password: r.password };
}

/** A STAFF access token minted directly: clock jumps of days outlive a 15-minute token. */
export async function staffToken(e2e: E2eApp, staffId: string): Promise<string> {
  return (await e2e.get(TokenService).issue({ kind: 'STAFF', id: staffId }, null)).accessToken;
}

/** The current code for a base32 secret at the app's clock, shifted by whole steps. */
export const codeFor = (e2e: E2eApp, secretBase32: string, steps = 0): string =>
  totpAt(base32Decode(secretBase32), new Date(e2e.now().getTime() + steps * 30_000));

/**
 * Password → (enrol or) TOTP → session, through the real endpoints. `secrets` remembers each
 * enrolled email's authenticator secret for later sign-ins. Advances the clock one step first so
 * a code is never a replay of the previous sign-in's.
 */
export async function signIn(
  e2e: E2eApp,
  secrets: Map<string, string>,
  email: string,
  password: string,
): Promise<Json> {
  e2e.advance(31_000);
  const login = await e2e.call('POST', '/admin/auth/login', { body: { email, password } });
  if (login.status !== 200) throw new Error(`signIn: login ${JSON.stringify(login.json)}`);
  const challenge = login.json.data as Json;
  if (challenge.step === 'ENROL_TOTP') secrets.set(email, challenge.enrolment.secret as string);
  const secret = secrets.get(email);
  if (!secret) throw new Error(`signIn: no authenticator secret for ${email}`);
  const totp = await e2e.call('POST', '/admin/auth/totp', {
    body: { challengeId: challenge.challengeId, code: codeFor(e2e, secret) },
  });
  if (totp.status !== 200) throw new Error(`signIn: totp ${JSON.stringify(totp.json)}`);
  return totp.json.data as Json;
}
