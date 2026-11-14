import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAUNCH_RULESET_VERSION } from '../../../modules/pricing/engine/launch-ruleset';
import type { Ruleset } from '../../../modules/pricing/engine/types';
import {
  VIDEO_EFFECTIVE_FROM,
  VIDEO_RULESET_VERSION,
  videoRuleset,
} from '../../../modules/pricing/engine/video-ruleset';
import { PricingRepository } from '../../../modules/pricing/repositories/pricing.repository';
import { RulesetEditorRepository } from '../../../modules/pricing/repositories/ruleset-editor.repository';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { seedLaunchCities } from '../seed';
import { seedLaunchRuleset } from './launch-ruleset.seed';
import { seedVideoRuleset } from './video-ruleset.seed';

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
    addonPrices: sortBy(
      r.addonPrices,
      (x) => `${x.addonCode}:${x.tier ?? '-'}:${x.cityTier ?? '-'}:${x.minQuantity}`,
    ),
    extensionRates: sortBy(r.extensionRates, (x) => x.tier + x.cityTier),
    deliverables: sortBy(r.deliverables, (x) => x.tier),
  };
}

const AFTER = new Date('2026-11-15T00:00:00Z');
const BEFORE = new Date('2026-11-13T00:00:00Z');
/** A seed run before the card's start: it starts on 14 Nov as written. */
const EARLY = new Date('2026-11-01T00:00:00Z');

async function cityIds(db: ScratchDb) {
  const cities = await db.sql<{ id: string; name: string }[]>`SELECT id, name FROM cities`;
  const id = (n: string) => cities.find((c) => c.name === n)?.id ?? '';
  return { surat: id('Surat'), mumbai: id('Mumbai'), vadodara: id('Vadodara') };
}

describe.runIf(TEST_DATABASE_URL)('videography ruleset seed (ADR-0034)', () => {
  let db: ScratchDb;
  let repo: PricingRepository;

  beforeAll(async () => {
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    await seedLaunchRuleset(db.sql);
    expect(await seedVideoRuleset(db.sql, EARLY)).toMatchObject({ created: true });
    repo = new PricingRepository(db.sql);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('publishes 2026.11.14 and loads back exactly the fixture', async () => {
    const loaded = await repo.loadCurrent(AFTER);

    expect(loaded?.version).toBe(VIDEO_RULESET_VERSION);
    const expected = videoRuleset(loaded?.id ?? '', await cityIds(db));
    expect(normalise(loaded as Ruleset)).toEqual(normalise(expected));
  });

  it('closes 2026.10.01 at the video card’s start and leaves its prices untouched (Invariant 17)', async () => {
    const [launch] = await db.sql<{ effective_to: Date }[]>`
      SELECT effective_to FROM pricing_rulesets WHERE version = ${LAUNCH_RULESET_VERSION}`;
    expect(launch?.effective_to.toISOString()).toBe(new Date(VIDEO_EFFECTIVE_FROM).toISOString());

    const earlier = await repo.loadCurrent(BEFORE);
    expect(earlier?.version).toBe(LAUNCH_RULESET_VERSION);
    expect(earlier?.addonPrices.filter((p) => p.addonCode === 'VIDEOGRAPHER')).toEqual([
      expect.objectContaining({ tier: null, amountPaise: 200_000n, minQuantity: 1 }),
    ]);
    expect(earlier?.addonPrices.some((p) => p.addonCode === 'REELS')).toBe(false);
  });

  it('records the based-on ruleset, as an editor publish does', async () => {
    const [row] = await db.sql<{ based_on: string }[]>`
      SELECT b.version AS based_on FROM pricing_rulesets r
      JOIN pricing_rulesets b ON b.id = r.based_on_id WHERE r.version = ${VIDEO_RULESET_VERSION}`;
    expect(row?.based_on).toBe(LAUNCH_RULESET_VERSION);
  });

  it('leaves the editor’s publish trail: a domain event and a SYSTEM audit row', async () => {
    const [rs] = await db.sql<{ id: string }[]>`
      SELECT id FROM pricing_rulesets WHERE version = ${VIDEO_RULESET_VERSION}`;
    const events = await db.sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM domain_events
      WHERE event_type = 'pricing.ruleset_published' AND aggregate_id = ${rs?.id ?? ''}`;
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      version: VIDEO_RULESET_VERSION,
      previous_version: LAUNCH_RULESET_VERSION,
      published_by: null,
    });
    const audits = await db.sql`
      SELECT 1 FROM audit_logs
      WHERE actor_kind = 'SYSTEM' AND action = 'pricing.publish' AND entity_id = ${rs?.id ?? ''}`;
    expect(audits).toHaveLength(1);
  });

  it('seeding twice changes nothing', async () => {
    expect(await seedVideoRuleset(db.sql, EARLY)).toEqual({
      created: false,
      reason: 'ALREADY_PRESENT',
    });
  });

  it('refuses a second ordinary price row for the same add-on scope', async () => {
    const [rs] = await db.sql<{ id: string }[]>`
      SELECT id FROM pricing_rulesets WHERE version = ${VIDEO_RULESET_VERSION}`;
    await expect(
      db.sql`INSERT INTO addon_prices (ruleset_id, addon_id, amount_paise, min_quantity)
             SELECT ${rs?.id ?? ''}, id, 1, 5 FROM addons WHERE code = 'REELS'`,
    ).rejects.toThrow(/addon_prices_uq/);
  });

  it('refuses a quantity break below 1 and an add-on that requires itself', async () => {
    await expect(
      db.sql`UPDATE addon_prices SET min_quantity = 0 WHERE min_quantity = 5`,
    ).rejects.toThrow(/addon_price_min_quantity/);
    await expect(
      db.sql`UPDATE addons SET requires_addon_id = id WHERE code = 'REELS'`,
    ).rejects.toThrow(/addon_requires_other/);
  });
});

describe.runIf(TEST_DATABASE_URL)('videography ruleset seed over a staff-published ruleset', () => {
  let db: ScratchDb;

  beforeAll(async () => {
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    await seedLaunchRuleset(db.sql);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  /** Publishes a copy of the current ruleset from `from` with Basic metro at ₹2,100/hr. */
  async function publishStaffRuleset(version: string, from: string): Promise<void> {
    const editor = new RulesetEditorRepository(db.sql);
    await db.sql.begin(async (tx) => {
      const [current] = await tx<{ id: string }[]>`
        SELECT id FROM pricing_rulesets WHERE published_at IS NOT NULL AND effective_to IS NULL`;
      await tx`UPDATE pricing_rulesets SET effective_to = ${from} WHERE id = ${current?.id ?? ''}`;
      const [next] = await tx<{ id: string }[]>`
        INSERT INTO pricing_rulesets (version, effective_from, prices_include_gst, published_at, based_on_id)
        VALUES (${version}, ${from}, false, now(), ${current?.id ?? ''}) RETURNING id`;
      await editor.copyChildren(tx, current?.id ?? '', next?.id ?? '');
      await tx`UPDATE base_rates SET rate_per_hour_paise = 210000
               WHERE ruleset_id = ${next?.id ?? ''} AND tier = 'BASIC' AND city_tier = 'METRO'`;
    });
  }

  it('keeps a photography rate staff published before the video card', async () => {
    await publishStaffRuleset('2026.11.01', '2026-11-01T00:00:00+05:30');

    expect(await seedVideoRuleset(db.sql, EARLY)).toMatchObject({ created: true });

    const loaded = await new PricingRepository(db.sql).loadCurrent(AFTER);
    expect(loaded?.version).toBe(VIDEO_RULESET_VERSION);
    const basicMetro = loaded?.baseRates.find((r) => r.tier === 'BASIC' && r.cityTier === 'METRO');
    expect(basicMetro?.ratePerHourPaise).toBe(210_000n);
    expect(loaded?.addonPrices.filter((p) => p.addonCode === 'REELS')).toHaveLength(2);
  });

  it('never backdates: a seed run after 14 Nov starts the card at that moment', async () => {
    const fresh = await createScratchDb();
    try {
      await seedLaunchCities(fresh.sql);
      await seedLaunchRuleset(fresh.sql);
      const late = new Date('2026-12-03T05:00:00Z');

      expect(await seedVideoRuleset(fresh.sql, late)).toEqual({
        created: true,
        effectiveFrom: late,
      });

      const rows = await fresh.sql<{ version: string; from: Date; to: Date | null }[]>`
        SELECT version, effective_from AS from, effective_to AS to FROM pricing_rulesets
        ORDER BY effective_from`;
      expect(
        rows.map((r) => [r.version, r.from.toISOString(), r.to?.toISOString() ?? null]),
      ).toEqual([
        [LAUNCH_RULESET_VERSION, '2026-09-30T18:30:00.000Z', late.toISOString()],
        [VIDEO_RULESET_VERSION, late.toISOString(), null],
      ]);
    } finally {
      await fresh.drop();
    }
  }, 60_000);

  it('never overwrites an ops edit to the videographer’s minimum tier', async () => {
    const fresh = await createScratchDb();
    try {
      await seedLaunchCities(fresh.sql);
      await seedLaunchRuleset(fresh.sql);
      await fresh.sql`UPDATE addons SET min_tier = 'PROFESSIONAL' WHERE code = 'VIDEOGRAPHER'`;

      await seedVideoRuleset(fresh.sql, EARLY);

      const [row] = await fresh.sql<{ min_tier: string }[]>`
        SELECT min_tier FROM addons WHERE code = 'VIDEOGRAPHER'`;
      expect(row?.min_tier).toBe('PROFESSIONAL');
    } finally {
      await fresh.drop();
    }
  }, 60_000);

  it('never rewrites history when a later ruleset is already published', async () => {
    const fresh = await createScratchDb();
    try {
      await seedLaunchCities(fresh.sql);
      await seedLaunchRuleset(fresh.sql);
      await fresh.sql`UPDATE pricing_rulesets SET effective_to = '2026-11-20T00:00:00+05:30'`;
      await fresh.sql`
        INSERT INTO pricing_rulesets (version, effective_from, prices_include_gst, published_at)
        VALUES ('2026.11.20', '2026-11-20T00:00:00+05:30', false, now())`;

      expect(await seedVideoRuleset(fresh.sql, EARLY)).toEqual({
        created: false,
        reason: 'SUPERSEDED',
      });
      const [count] = await fresh.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pricing_rulesets WHERE version = ${VIDEO_RULESET_VERSION}`;
      expect(count?.n).toBe(0);
      // Nothing of the card leaks into the live catalogue when it is skipped.
      expect(await fresh.sql`SELECT 1 FROM addons WHERE code = 'REELS'`).toHaveLength(0);
    } finally {
      await fresh.drop();
    }
  }, 60_000);
});
