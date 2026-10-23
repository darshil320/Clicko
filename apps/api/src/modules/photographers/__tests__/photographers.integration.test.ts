import type { PlanTier } from '@clickco/contracts';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedLaunchCities } from '../../../infra/db/seed';
import { seedLaunchRuleset } from '../../../infra/db/seeds/launch-ruleset.seed';
import {
  insertPhotographer,
  type ProSeed,
  proPhone,
} from '../../../test-support/photographer-fixtures';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { PhotographersService } from '../photographers.service';
import type { PoolCriteria } from '../photographers.types';
import { PhotographersRepository } from '../repositories/photographers.repository';

// Sunday 15 Nov 2026, 12:00–14:00 IST; blocked window ±90 min.
const START = new Date('2026-11-15T06:30:00.000Z');
const END = new Date('2026-11-15T08:30:00.000Z');
const MIN = 60_000;

describe.runIf(TEST_DATABASE_URL)('PhotographersService.dispatchPool (hard filters)', () => {
  let db: ScratchDb;
  let service: PhotographersService;
  let suratId: string;
  let foodId: string;
  let portraitId: string;
  let seq = 0;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    await seedLaunchRuleset(db.sql);
    service = new PhotographersService(new PhotographersRepository(), db.sql);
    const [surat] = await db.sql<{ id: string }[]>`SELECT id FROM cities WHERE name = 'Surat'`;
    const cats = await db.sql<{ id: string; code: string }[]>`SELECT id, code FROM categories`;
    suratId = surat?.id ?? '';
    foodId = cats.find((c) => c.code === 'FOOD')?.id ?? '';
    portraitId = cats.find((c) => c.code === 'PORTRAIT')?.id ?? '';
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  const criteria = (over: Partial<PoolCriteria> = {}): PoolCriteria => ({
    cityId: suratId,
    tier: 'PROFESSIONAL',
    categoryId: foodId,
    certRequiredFrom: 'PROFESSIONAL',
    shootStart: START,
    shootEnd: END,
    blockedFrom: new Date(START.getTime() - 90 * MIN),
    blockedUntil: new Date(END.getTime() + 90 * MIN),
    emergencyOnly: false,
    needsDroneCredentials: false,
    ...over,
  });

  const certified = (tier: PlanTier = 'EXPERT') => [{ code: 'FOOD', tier }];
  const pro = (s: Partial<ProSeed> = {}) =>
    insertPhotographer(db.sql, { phone: proPhone(++seq), categories: certified(), ...s });
  const poolIds = async (over: Partial<PoolCriteria> = {}) =>
    (await service.dispatchPool(db.sql, criteria(over))).map((m) => m.id);

  it('includes an ACTIVE, certified, in-city photographer, with location and metrics', async () => {
    const id = await pro({ metrics: { ratingAvgBps: 4800, ratingCount: 12 } });
    const member = (await service.dispatchPool(db.sql, criteria())).find((m) => m.id === id);
    expect(member).toMatchObject({ id, serviceRadiusKm: 25 });
    expect(member?.baseLocation).toMatch(/^0101000020E6100000/i);
    expect(member?.metrics).toMatchObject({ ratingAvgBps: 4800, ratingCount: 12 });
  });

  it('excludes anyone not ACTIVE', async () => {
    const id = await pro({ status: 'PAUSED' });
    expect(await poolIds()).not.toContain(id);
  });

  it('excludes other cities', async () => {
    const id = await pro({ city: 'Mumbai' });
    expect(await poolIds()).not.toContain(id);
  });

  it('excludes a max tier below the booking tier', async () => {
    const id = await pro({ maxTier: 'SEMI_PRO' });
    expect(await poolIds()).not.toContain(id);
  });

  it('requires category certification at ≥ the booking tier when the category demands it', async () => {
    const none = await pro({ categories: [] });
    const below = await pro({ categories: certified('SEMI_PRO') });
    const exact = await pro({ categories: certified('PROFESSIONAL') });
    const ids = await poolIds();
    expect(ids).not.toContain(none);
    expect(ids).not.toContain(below);
    expect(ids).toContain(exact);
  });

  it('ignores certification when the category does not require it at this tier', async () => {
    const id = await pro({ categories: [] });
    expect(await poolIds({ categoryId: portraitId, certRequiredFrom: null })).toContain(id);
    expect(await poolIds({ certRequiredFrom: 'EXPERT' })).toContain(id);
  });

  it('ignores a revoked certification', async () => {
    const id = await pro();
    await db.sql`UPDATE photographer_categories SET revoked_at = now() WHERE photographer_id = ${id}`;
    expect(await poolIds()).not.toContain(id);
  });

  it('emergency bands only reach photographers who opted in', async () => {
    const optedIn = await pro({ acceptsEmergency: true });
    const not = await pro({ acceptsEmergency: false });
    const ids = await poolIds({ emergencyOnly: true });
    expect(ids).toContain(optedIn);
    expect(ids).not.toContain(not);
  });

  it('a DRONE add-on needs approved DRONE_RPC and DRONE_UIN', async () => {
    const both = await pro({ drone: 'BOTH' });
    const rpcOnly = await pro({ drone: 'RPC_ONLY' });
    const none = await pro();
    const ids = await poolIds({ needsDroneCredentials: true });
    expect(ids).toContain(both);
    expect(ids).not.toContain(rpcOnly);
    expect(ids).not.toContain(none);
    expect(await poolIds()).toContain(none);
  });

  it('an expired drone document no longer counts', async () => {
    const id = await pro({ drone: 'BOTH' });
    await db.sql`UPDATE photographer_documents SET expires_on = '2026-11-01'
                 WHERE photographer_id = ${id} AND kind = 'DRONE_UIN'`;
    expect(await poolIds({ needsDroneCredentials: true })).not.toContain(id);
  });

  it('excludes a block overlapping the buffered window, not one that ends before it', async () => {
    const overlapping = await pro({
      blocks: [
        { from: new Date(END.getTime() + 60 * MIN), until: new Date(END.getTime() + 5 * 60 * MIN) },
      ],
    });
    const before = await pro({
      blocks: [
        {
          from: new Date(START.getTime() - 6 * 60 * MIN),
          until: new Date(START.getTime() - 90 * MIN),
        },
      ],
    });
    const ids = await poolIds();
    expect(ids).not.toContain(overlapping);
    expect(ids).toContain(before);
  });

  it('honours weekly availability in IST; no rows means always available', async () => {
    const sundays = await pro({ availability: [{ dow: 7, from: '10:00', to: '18:00' }] });
    const mondays = await pro({ availability: [{ dow: 1, from: '09:00', to: '21:00' }] });
    const tooShort = await pro({ availability: [{ dow: 7, from: '12:30', to: '18:00' }] });
    const always = await pro({ availability: [] });
    const ids = await poolIds();
    expect(ids).toContain(sundays);
    expect(ids).not.toContain(mondays);
    expect(ids).not.toContain(tooShort);
    expect(ids).toContain(always);
  });

  it('excludes a photographer with no base location (distance cannot be measured)', async () => {
    const id = await pro({ km: null });
    expect(await poolIds()).not.toContain(id);
  });
});

describe.runIf(TEST_DATABASE_URL)('PhotographersService lookups', () => {
  let db: ScratchDb;
  let service: PhotographersService;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    await seedLaunchRuleset(db.sql);
    service = new PhotographersService(new PhotographersRepository(), db.sql);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('finds only ACTIVE photographers by phone and by id', async () => {
    const active = await insertPhotographer(db.sql, { phone: proPhone(9001), name: 'Kavya Desai' });
    const paused = await insertPhotographer(db.sql, { phone: proPhone(9002), status: 'PAUSED' });
    expect(await service.findActiveByPhone(proPhone(9001))).toMatchObject({
      id: active,
      fullName: 'Kavya Desai',
    });
    expect(await service.findActiveByPhone(proPhone(9002))).toBeNull();
    expect(await service.findActiveByPhone(proPhone(9003))).toBeNull();
    expect(await service.findActiveById(active)).not.toBeNull();
    expect(await service.findActiveById(paused)).toBeNull();
    expect((await service.displayNames([active, paused])).get(active)).toBe('Kavya Desai');
  });
});
