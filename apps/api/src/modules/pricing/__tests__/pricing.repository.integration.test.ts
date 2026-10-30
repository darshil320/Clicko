import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedLaunchCities } from '../../../infra/db/seed';
import { seedLaunchRuleset } from '../../../infra/db/seeds/launch-ruleset.seed';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { launchRuleset } from '../engine/launch-ruleset';
import type { Ruleset } from '../engine/types';
import { PricingRepository } from '../repositories/pricing.repository';

const sortBy = <T>(xs: readonly T[], key: (x: T) => string) =>
  [...xs].sort((a, b) => key(a).localeCompare(key(b)));

/** Order-insensitive view so the DB round trip can be compared with the fixture. */
function normalise(r: Ruleset) {
  return {
    ...r,
    baseRates: sortBy(r.baseRates, (x) => x.tier + x.cityTier),
    categoryUplifts: sortBy(r.categoryUplifts, (x) => x.categoryCode),
    emergency: sortBy(r.emergency, (x) => x.band),
    festivals: sortBy(r.festivals, (x) => x.label + (x.cityId ?? '')),
    travelSlabs: sortBy(r.travelSlabs, (x) => x.cityTier + x.zone),
    addons: sortBy(r.addons, (x) => x.code),
    addonPrices: sortBy(r.addonPrices, (x) => x.addonCode),
    extensionRates: sortBy(r.extensionRates, (x) => x.tier + x.cityTier),
    deliverables: sortBy(r.deliverables, (x) => x.tier),
  };
}

describe.runIf(TEST_DATABASE_URL)('pricing ruleset in Postgres', () => {
  let db: ScratchDb;
  let repo: PricingRepository;

  beforeAll(async () => {
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    await seedLaunchRuleset(db.sql);
    repo = new PricingRepository(db.sql);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('loads back exactly the rate card that was seeded', async () => {
    const loaded = await repo.loadCurrent(new Date('2026-11-15T00:00:00Z'));
    expect(loaded).not.toBeNull();
    const cities = await db.sql<{ id: string; name: string }[]>`SELECT id, name FROM cities`;
    const id = (n: string) => cities.find((c) => c.name === n)?.id ?? '';
    const expected = launchRuleset(loaded?.id ?? '', {
      surat: id('Surat'),
      mumbai: id('Mumbai'),
      vadodara: id('Vadodara'),
    });
    expect(normalise(loaded as Ruleset)).toEqual(normalise(expected));
  });

  it('has no current ruleset before the launch ruleset takes effect — pricing must fail loudly, not default', async () => {
    expect(await repo.loadCurrent(new Date('2026-09-01T00:00:00Z'))).toBeNull();
  });

  it('hides a deactivated category from new quotes but not from the ruleset as published', async () => {
    await db.sql`UPDATE categories SET is_active = false WHERE code = 'REAL_ESTATE'`;
    try {
      const current = await repo.loadCurrent(new Date('2026-11-15T00:00:00Z'));
      expect(current?.categoryUplifts.some((u) => u.categoryCode === 'REAL_ESTATE')).toBe(false);
      const published = await repo.loadById(current?.id ?? '');
      expect(published?.categoryUplifts.some((u) => u.categoryCode === 'REAL_ESTATE')).toBe(true);
    } finally {
      await db.sql`UPDATE categories SET is_active = true WHERE code = 'REAL_ESTATE'`;
    }
  });

  it('seeding twice changes nothing', async () => {
    expect(await seedLaunchRuleset(db.sql)).toEqual({ created: false });
  });

  it('allows only one open-ended ruleset', async () => {
    await expect(
      db.sql`INSERT INTO pricing_rulesets (version, effective_from, prices_include_gst, published_at)
             VALUES ('dup', now(), false, now())`,
    ).rejects.toThrow(/pricing_rulesets_one_current/);
  });

  it('an unpublished ruleset (a draft) never carries a real window (addendum 0010)', async () => {
    await expect(
      db.sql`INSERT INTO pricing_rulesets (version, effective_from, effective_to, prices_include_gst)
             VALUES ('draft-x', now(), now() + interval '1 day', false)`,
    ).rejects.toThrow(/pricing_rulesets_draft_window/);
  });

  it('refuses any UPDATE to a price snapshot', async () => {
    const [ids] = await db.sql<{ ruleset: string; city: string; category: string }[]>`
      SELECT (SELECT id FROM pricing_rulesets LIMIT 1) AS ruleset,
             (SELECT id FROM cities WHERE name = 'Surat') AS city,
             (SELECT id FROM categories WHERE code = 'FOOD') AS category`;
    const [user] = await db.sql<
      { id: string }[]
    >`INSERT INTO users (phone_e164) VALUES ('+919876543210') RETURNING id`;
    const [booking] = await db.sql<{ id: string }[]>`
      INSERT INTO bookings (user_id, city_id, category_id, tier, scheduled_start, scheduled_hours, venue_pincode,
                            venue_address, booker_name, booker_phone, ruleset_id)
      VALUES (${user?.id ?? ''}, ${ids?.city ?? ''}, ${ids?.category ?? ''}, 'PROFESSIONAL', '2026-11-17T09:30:00Z', 2,
              '395007', 'Vesu, Surat', 'Priya Sharma', '+919876543210', ${ids?.ruleset ?? ''})
      RETURNING id`;
    const [snap] = await db.sql<{ id: string }[]>`
      INSERT INTO booking_price_snapshots (booking_id, ruleset_id, ruleset_version, tier, city_tier, category_code, hours,
        base_rate_per_hour_paise, category_uplift_bps, emergency_multiplier_bps, surge_multiplier_bps,
        night_multiplier_bps, weekend_multiplier_bps, base_amount_paise, taxable_amount_paise, gst_rate_bps,
        gst_amount_paise, total_amount_paise, prices_include_gst, payout_share_bps, expected_payout_paise, breakdown)
      VALUES (${booking?.id ?? ''}, ${ids?.ruleset ?? ''}, '2026.10.01', 'PROFESSIONAL', 'TIER_1', 'FOOD', 2,
        425000, 11500, 10000, 10000, 10000, 10000, 977500, 977500, 1800, 175950, 1153450, false, 6000, 586500, '{}')
      RETURNING id`;
    await expect(
      db.sql`UPDATE booking_price_snapshots SET total_amount_paise = 1 WHERE id = ${snap?.id ?? ''}`,
    ).rejects.toThrow(/immutable/);
  });
});
