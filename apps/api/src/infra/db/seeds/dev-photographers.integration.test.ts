import { PhoneE164 } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PhotographersService } from '../../../modules/photographers/photographers.service';
import { PhotographersRepository } from '../../../modules/photographers/repositories/photographers.repository';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { seedLaunchCities } from '../seed';
import { DEV_PHOTOGRAPHERS, devPhone, seedDevPhotographers } from './dev-photographers';
import { alignLaunchEmergencyRules, seedLaunchRuleset } from './launch-ruleset.seed';

describe('dev photographer data', () => {
  it('uses valid, unique numbers in the +91 99990 00xxx block, clear of demo and test numbers', () => {
    const phones = DEV_PHOTOGRAPHERS.map((_, i) => devPhone(i));
    expect(new Set(phones).size).toBe(phones.length);
    for (const p of phones) {
      expect(PhoneE164.safeParse(p).success).toBe(true);
      expect(p.startsWith('+919999000')).toBe(true);
    }
    expect(phones).not.toContain('+919876543210');
    expect(phones).not.toContain('+919811122233');
  });

  it('covers the three launch cities in the planned numbers', () => {
    const count = (city: string) => DEV_PHOTOGRAPHERS.filter((p) => p.city === city).length;
    expect([count('Surat'), count('Mumbai'), count('Vadodara')]).toEqual([12, 6, 4]);
    expect(DEV_PHOTOGRAPHERS.filter((p) => p.drone)).toHaveLength(1);
    expect(DEV_PHOTOGRAPHERS.filter((p) => p.emergency).length).toBeGreaterThanOrEqual(2);
    for (const p of DEV_PHOTOGRAPHERS) {
      expect(p.km).toBeGreaterThanOrEqual(1);
      expect(p.km).toBeLessThanOrEqual(20);
    }
  });
});

describe.runIf(TEST_DATABASE_URL)('seedDevPhotographers in Postgres', () => {
  let db: ScratchDb;

  beforeAll(async () => {
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    await seedLaunchRuleset(db.sql);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('inserts verified ACTIVE photographers once; a second run changes nothing', async () => {
    expect(await seedDevPhotographers(db.sql)).toEqual({ inserted: DEV_PHOTOGRAPHERS.length });
    expect(await seedDevPhotographers(db.sql)).toEqual({ inserted: 0 });
    const rows = await db.sql<{ name: string; n: number }[]>`
      SELECT c.name, count(*)::int AS n FROM photographers p JOIN cities c ON c.id = p.city_id
      WHERE p.status = 'ACTIVE' GROUP BY c.name ORDER BY c.name`;
    expect(rows).toEqual([
      { name: 'Mumbai', n: 6 },
      { name: 'Surat', n: 12 },
      { name: 'Vadodara', n: 4 },
    ]);
    const [metrics] = await db.sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM photographer_metrics`;
    expect(metrics?.n).toBe(DEV_PHOTOGRAPHERS.length);
  });

  it('realigns a pre-ADR-0012 launch ruleset once (development databases)', async () => {
    await db.sql`UPDATE emergency_multipliers SET auto_refund_minutes_before = NULL, is_guaranteed = true
                 WHERE band IN ('NONE', 'HOURS_3_8')`;
    expect(await alignLaunchEmergencyRules(db.sql)).toBe(2);
    expect(await alignLaunchEmergencyRules(db.sql)).toBe(0);
    const rows = await db.sql<{ band: string; g: boolean; m: number | null }[]>`
      SELECT band, is_guaranteed AS g, auto_refund_minutes_before AS m FROM emergency_multipliers
      ORDER BY multiplier_bps`;
    expect(rows.map((r) => [r.band, r.g, r.m])).toEqual([
      ['NONE', true, 90],
      ['NEXT_DAY', true, 90],
      ['SAME_DAY', true, 90],
      ['HOURS_3_8', false, 90],
      ['HOURS_UNDER_3', false, 90],
    ]);
  });

  it('makes exactly one photographer dispatchable for a drone booking in Surat', async () => {
    const [surat] = await db.sql<{ id: string }[]>`SELECT id FROM cities WHERE name = 'Surat'`;
    const [food] = await db.sql<{ id: string }[]>`SELECT id FROM categories WHERE code = 'FOOD'`;
    const start = new Date('2026-11-15T06:30:00Z');
    const end = new Date('2026-11-15T08:30:00Z');
    const pool = await new PhotographersService(new PhotographersRepository(), db.sql).dispatchPool(
      db.sql,
      {
        cityId: surat?.id ?? '',
        tier: 'PROFESSIONAL',
        categoryId: food?.id ?? '',
        certRequiredFrom: 'PROFESSIONAL',
        shootStart: start,
        shootEnd: end,
        blockedFrom: start,
        blockedUntil: end,
        emergencyOnly: false,
        needsDroneCredentials: true,
      },
    );
    expect(pool.map((p) => p.fullName)).toEqual(['Riddhi Chauhan']);
  });
});
