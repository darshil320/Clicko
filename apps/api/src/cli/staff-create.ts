import { StaffRole } from '@clickco/contracts';
import postgres from 'postgres';
import { loadEnv } from '../config/env';
import { createStaffAccount } from '../modules/admin/staff/bootstrap';

const USAGE =
  'Usage: pnpm --filter @clickco/api staff:create <email> "<full name>" <role> [cityId]\n' +
  `Roles: ${StaffRole.options.join(', ')}. CITY_MANAGER needs a city id.\n`;

/**
 * ADR-0025 D2: creates a staff account (the first SUPER_ADMIN above all) and prints its
 * temporary password ONCE. TOTP enrolment happens at the first sign-in. Audited as SYSTEM.
 */
async function main(argv: readonly string[]): Promise<void> {
  const [email, fullName, role, cityId] = argv;
  const parsedRole = StaffRole.safeParse(role);
  if (!email || !fullName || !parsedRole.success) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const env = loadEnv(process.env);
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const result = await createStaffAccount(
      sql,
      { email, fullName, role: parsedRole.data, cityId: cityId ?? null, via: 'cli' },
      new Date(),
    );
    if (result.outcome === 'EXISTS') {
      process.stderr.write(`A staff account for ${email} already exists; nothing changed.\n`);
      process.exit(1);
    }
    const expiry = result.expiresAt
      ? ` It expires at ${result.expiresAt.toISOString()} (72 hours).`
      : '';
    process.stdout.write(
      `Created ${parsedRole.data} ${email} (${result.staffId}).\n` +
        `Temporary password (shown once, hand it over privately): ${result.password}\n` +
        `At first sign-in they choose their own password and set up their authenticator app.${expiry}\n`,
    );
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `staff:create failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
