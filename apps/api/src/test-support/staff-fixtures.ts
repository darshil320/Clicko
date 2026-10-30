import type { StaffRole } from '@clickco/contracts';
import { generateTemporaryPassword } from '../modules/admin/auth/password';
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

/**
 * A staff account with TOTP not enrolled. By default its password is a known random one that
 * needs no change (so desk tests sign in in two steps); `{ temporary: true }` makes it exactly as
 * the staff:create CLI does — a temporary password that expires in 72 hours and must be replaced
 * at the first sign-in (ADR-0026 D7).
 */
export async function bootstrapStaff(
  e2e: E2eApp,
  email: string,
  role: StaffRole,
  cityId: string | null = null,
  opts: { readonly temporary?: boolean } = {},
): Promise<{ id: string; password: string }> {
  const r = await createStaffAccount(
    e2e.db.sql,
    {
      email,
      fullName: `Test ${role}`,
      role,
      cityId,
      via: 'test',
      ...(opts.temporary ? {} : { password: generateTemporaryPassword() }),
    },
    e2e.now(),
  );
  if (r.outcome !== 'CREATED') throw new Error(`bootstrapStaff: ${email} exists`);
  return { id: r.staffId, password: r.password };
}

/** The password `signIn` chose for an account whose temporary one it had to replace. */
const chosenKey = (email: string) => `password:${email}`;

/** The password that signs `email` in now: the one `signIn` chose, else the one given. */
export const currentPassword = (
  secrets: ReadonlyMap<string, string>,
  email: string,
  password: string,
): string => secrets.get(chosenKey(email)) ?? password;

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
 * a code is never a replay of the previous sign-in's. A temporary password is replaced with one
 * derived from it (ADR-0026 D7), remembered in `secrets` and used by later calls automatically
 * (`currentPassword` reads it).
 */
export async function signIn(
  e2e: E2eApp,
  secrets: Map<string, string>,
  email: string,
  password: string,
): Promise<Json> {
  e2e.advance(31_000);
  const login = await e2e.call('POST', '/admin/auth/login', {
    body: { email, password: currentPassword(secrets, email, password) },
  });
  if (login.status !== 200) throw new Error(`signIn: login ${JSON.stringify(login.json)}`);
  const challenge = login.json.data as Json;
  if (challenge.step === 'ENROL_TOTP') secrets.set(email, challenge.enrolment.secret as string);
  const secret = secrets.get(email);
  if (!secret) throw new Error(`signIn: no authenticator secret for ${email}`);
  const newPassword = challenge.mustChangePassword ? `${password}.chosen` : undefined;
  const totp = await e2e.call('POST', '/admin/auth/totp', {
    body: {
      challengeId: challenge.challengeId,
      code: codeFor(e2e, secret),
      ...(newPassword ? { newPassword } : {}),
    },
  });
  if (newPassword && totp.status === 200) secrets.set(chosenKey(email), newPassword);
  if (totp.status !== 200) throw new Error(`signIn: totp ${JSON.stringify(totp.json)}`);
  return totp.json.data as Json;
}
