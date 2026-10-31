import type { StaffRole } from '@clickco/contracts';
import type postgres from 'postgres';
import { DEV_STAFF_TOTP_KEY } from '../../../modules/admin/auth/secret-box';
import { base32Decode } from '../../../modules/admin/auth/totp';
import { createStaffAccount } from '../../../modules/admin/staff/bootstrap';

/**
 * DEVELOPMENT ONLY (ADR-0025 D2): one staff account per role, all with this PUBLIC password and
 * this PUBLIC authenticator secret (documented in apps/api/CLAUDE.md). Never seeded elsewhere:
 * db:seed:dev refuses any NODE_ENV but development and any non-local database.
 */
export const DEV_STAFF_PASSWORD = 'clickco-dev-staff-only';
export const DEV_STAFF_TOTP_SECRET = 'CLICKCODEVSTAFFTOTPSECRETAAAAAAA';

const ACCOUNTS: ReadonlyArray<{ email: string; name: string; role: StaffRole; surat?: true }> = [
  { email: 'super-admin@clickco.test', name: 'Dev Super Admin', role: 'SUPER_ADMIN' },
  {
    email: 'city-manager@clickco.test',
    name: 'Dev City Manager (Surat)',
    role: 'CITY_MANAGER',
    surat: true,
  },
  { email: 'ops@clickco.test', name: 'Dev Ops Agent', role: 'OPS_AGENT' },
  { email: 'quality@clickco.test', name: 'Dev Quality Manager', role: 'QUALITY_MANAGER' },
  { email: 'support@clickco.test', name: 'Dev Support', role: 'SUPPORT' },
  { email: 'finance@clickco.test', name: 'Dev Finance', role: 'FINANCE' },
  { email: 'read-only@clickco.test', name: 'Dev Read Only', role: 'READ_ONLY' },
];

export async function seedDevStaff(
  sql: postgres.Sql,
  totpKey: string,
  now: Date,
): Promise<{ inserted: number }> {
  // Clients audit L3: a public password belongs only under the public dev key — never sealed with
  // a real key, which would make the accounts usable wherever that key is deployed.
  if (!Buffer.from(totpKey, 'base64').equals(Buffer.from(DEV_STAFF_TOTP_KEY, 'base64'))) {
    throw new Error('seedDevStaff: refused — STAFF_TOTP_KEY is not the built-in development key');
  }
  const [surat] = await sql<{ id: string }[]>`SELECT id FROM cities WHERE name = 'Surat'`;
  if (!surat) throw new Error('seedDevStaff: run `pnpm db:seed` first (no Surat)');
  let inserted = 0;
  for (const a of ACCOUNTS) {
    const result = await createStaffAccount(
      sql,
      {
        email: a.email,
        fullName: a.name,
        role: a.role,
        cityId: a.surat ? surat.id : null,
        password: DEV_STAFF_PASSWORD,
        totp: { secret: base32Decode(DEV_STAFF_TOTP_SECRET), totpKey },
        via: 'dev-seed',
      },
      now,
    );
    if (result.outcome === 'CREATED') inserted += 1;
  }
  return { inserted };
}
