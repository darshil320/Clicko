import postgres from 'postgres';
import { loadEnv } from '../../config/env';
import { assertLocalTestDatabase } from './migrate';
import { seedDevPhotographers } from './seeds/dev-photographers';
import { alignLaunchEmergencyRules } from './seeds/launch-ruleset.seed';

/**
 * `pnpm db:seed:dev` — demo photographers for the dispatch desk, and the ADR-0012 launch-ruleset
 * realignment. Development databases on this machine only.
 */
async function main(): Promise<void> {
  const env = loadEnv(process.env);
  if (env.NODE_ENV !== 'development') {
    throw new Error('db:seed:dev only runs with NODE_ENV=development');
  }
  assertLocalTestDatabase(env.DATABASE_URL, 'DATABASE_URL');
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [surat] = await sql`SELECT 1 FROM cities WHERE name = 'Surat'`;
    if (!surat) throw new Error('run `pnpm db:seed` first (cities and categories are missing)');
    const aligned = await alignLaunchEmergencyRules(sql);
    if (aligned > 0)
      process.stdout.write(`Realigned ${aligned} launch emergency rules (ADR-0012).\n`);
    const r = await seedDevPhotographers(sql);
    process.stdout.write(`Seeded ${r.inserted} new demo photographers.\n`);
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `Dev seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
