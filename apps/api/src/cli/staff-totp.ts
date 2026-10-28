import postgres from 'postgres';
import { loadEnv } from '../config/env';
import { assertLocalTestDatabase } from '../infra/db/migrate';
import { SecretBox } from '../modules/admin/auth/secret-box';
import { TOTP_POLICY, totpAt } from '../modules/admin/auth/totp';
import { StaffRepository } from '../modules/admin/staff/staff.repository';

/**
 * DEVELOPMENT ONLY: prints the current 6-digit code of an enrolled local staff account, so the
 * admin panel can be signed into without an authenticator app. Refuses any other NODE_ENV and
 * any non-local database.
 */
async function main(email: string | undefined): Promise<void> {
  if (!email) {
    process.stderr.write('Usage: pnpm --filter @clickco/api staff:totp <email>\n');
    process.exit(2);
  }
  const env = loadEnv(process.env);
  if (env.NODE_ENV !== 'development')
    throw new Error('staff:totp only runs with NODE_ENV=development');
  assertLocalTestDatabase(env.DATABASE_URL, 'DATABASE_URL');
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const staff = await new StaffRepository().findByEmail(sql, email);
    if (!staff?.totpSecret) throw new Error(`${email} has no enrolled authenticator`);
    const secret = new SecretBox(env.STAFF_TOTP_KEY).open(staff.totpSecret, staff.id);
    const now = new Date();
    const left =
      TOTP_POLICY.periodSeconds - (Math.floor(now.getTime() / 1000) % TOTP_POLICY.periodSeconds);
    process.stdout.write(`${totpAt(secret, now)}  (valid ~${left}s more, ±30s drift accepted)\n`);
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main(process.argv[2]).catch((error: unknown) => {
    process.stderr.write(
      `staff:totp failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
