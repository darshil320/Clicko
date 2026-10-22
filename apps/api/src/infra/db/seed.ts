import postgres from 'postgres';
import { loadEnv } from '../../config/env';
import { expandPincodes, LAUNCH_CITIES, type SeedCity } from './seeds/launch-cities';
import { seedLaunchRuleset } from './seeds/launch-ruleset.seed';

/** Idempotent reference-data seed. Inserts what is missing; never overwrites ops edits. */
export async function seedLaunchCities(
  sql: postgres.Sql,
  cities: readonly SeedCity[] = LAUNCH_CITIES,
): Promise<{ cities: number; pincodes: number }> {
  let pincodes = 0;
  await sql.begin(async (tx) => {
    for (const c of cities) {
      await tx`
        INSERT INTO cities (name, state, tier, status, centre, launched_at)
        VALUES (${c.name}, ${c.state}, ${c.tier}, ${c.status},
                ST_SetSRID(ST_MakePoint(${c.centre.lng}, ${c.centre.lat}), 4326)::geography,
                ${c.status === 'WAITLIST' ? null : '2027-02-01'})
        ON CONFLICT (lower(name), lower(state)) DO NOTHING`;
      const [city] = await tx<{ id: string }[]>`
        SELECT id FROM cities WHERE lower(name) = lower(${c.name}) AND lower(state) = lower(${c.state})`;
      if (!city) throw new Error(`seed: city ${c.name} missing after insert`);
      const codes = expandPincodes(c.pincodeRanges);
      const inserted = await tx`
        INSERT INTO serviceable_areas (pincode, city_id, status, travel_zone, notes)
        SELECT p, ${city.id}, ${c.status}::area_status, 0, 'seed: verify against India Post directory'
        FROM unnest(${codes}::text[]) AS p
        ON CONFLICT (pincode) DO NOTHING
        RETURNING pincode`;
      pincodes += inserted.length;
    }
  });
  return { cities: cities.length, pincodes };
}

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const r = await seedLaunchCities(sql);
    process.stdout.write(`Seeded ${r.cities} cities; ${r.pincodes} new pincodes.\n`);
    const p = await seedLaunchRuleset(sql);
    process.stdout.write(
      p.created ? 'Published pricing ruleset 2026.10.01.\n' : 'Pricing ruleset already present.\n',
    );
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `Seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
