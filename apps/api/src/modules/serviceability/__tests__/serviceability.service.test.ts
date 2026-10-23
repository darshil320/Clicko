import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AreaRecord,
  ServiceabilityRepository,
  WaitlistInsert,
} from '../repositories/serviceability.repository';
import { ServiceabilityService } from '../serviceability.service';

const NOW = new Date('2026-11-02T10:00:00.000Z');
const SURAT = {
  id: '5c2d7a90-1e3f-4b6a-8c9d-2e4f6a8b0c12',
  name: 'Surat',
  state: 'Gujarat',
  tier: 'TIER_1' as const,
};
const CHENNAI = {
  id: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  name: 'Chennai',
  state: 'Tamil Nadu',
  tier: 'METRO' as const,
};

class FakeRepo implements ServiceabilityRepository {
  areas = new Map<string, AreaRecord>([
    ['395007', { pincode: '395007', status: 'LIVE', areaName: 'Vesu', travelZone: 0, city: SURAT }],
    ['394270', { pincode: '394270', status: 'PILOT', areaName: null, travelZone: 1, city: SURAT }],
    [
      '600001',
      { pincode: '600001', status: 'WAITLIST', areaName: null, travelZone: 0, city: CHENNAI },
    ],
    [
      '999999',
      { pincode: '999999', status: 'BLOCKED', areaName: null, travelZone: 0, city: CHENNAI },
    ],
  ]);
  entries: Array<WaitlistInsert & { createdAt: Date }> = [];

  async countForPhoneSince(phone: string, since: Date) {
    return this.entries.filter((e) => e.phone === phone && e.createdAt >= since).length;
  }

  async findArea(pincode: string) {
    return this.areas.get(pincode) ?? null;
  }
  async countWaiting(cityId: string | null, pincode: string) {
    return this.entries.filter((e) => (cityId ? e.cityId === cityId : e.pincode === pincode))
      .length;
  }
  async insertWaitlist(entry: WaitlistInsert) {
    const dupe = this.entries.some(
      (e) =>
        e.phone === entry.phone &&
        e.pincode === entry.pincode &&
        e.intendedDate === entry.intendedDate,
    );
    if (!dupe) this.entries = [...this.entries, { ...entry, createdAt: NOW }];
  }
  async cityNames(cityIds: readonly string[]) {
    const all = [...this.areas.values()].map((a) => a.city);
    return new Map(all.filter((c) => cityIds.includes(c.id)).map((c) => [c.id, c.name]));
  }
}

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
  return 200;
};

describe('ServiceabilityService.check', () => {
  let repo: FakeRepo;
  let service: ServiceabilityService;
  beforeEach(() => {
    repo = new FakeRepo();
    service = new ServiceabilityService(repo, () => NOW);
  });

  it('lets a LIVE pincode book with its travel zone', async () => {
    expect(await service.check('395007')).toEqual({
      bookable: true,
      pincode: '395007',
      status: 'LIVE',
      areaName: 'Vesu',
      city: { id: SURAT.id, name: SURAT.name, tier: SURAT.tier },
      travelZone: 0,
      limitedAvailability: false,
    });
  });

  it('lets a PILOT pincode book with a limited-availability flag', async () => {
    const r = await service.check('394270');
    expect(r.bookable && r.limitedAvailability).toBe(true);
  });

  it('sends a WAITLIST pincode to the waitlist with the city queue size', async () => {
    await service.join({ phone: '+919876543210', fullName: 'Ananya Iyer', pincode: '600001' });
    expect(await service.check('600001')).toEqual({
      bookable: false,
      pincode: '600001',
      status: 'WAITLIST',
      cityName: 'Chennai',
      canJoinWaitlist: true,
      waitingCount: 1,
    });
  });

  it('treats an unknown pincode as waitlist-able, not as an error', async () => {
    const r = await service.check('110001');
    expect(r).toMatchObject({
      bookable: false,
      status: 'UNKNOWN',
      canJoinWaitlist: true,
      cityName: null,
    });
  });

  it('declines a BLOCKED pincode without offering the waitlist', async () => {
    expect(await service.check('999999')).toMatchObject({
      bookable: false,
      canJoinWaitlist: false,
    });
  });
});

describe('ServiceabilityService.join', () => {
  let repo: FakeRepo;
  let service: ServiceabilityService;
  beforeEach(() => {
    repo = new FakeRepo();
    service = new ServiceabilityService(repo, () => NOW);
  });

  it('records the city for a known pincode and returns the queue size', async () => {
    const res = await service.join({
      phone: '+919876543210',
      fullName: 'Ananya Iyer',
      pincode: '600001',
    });
    expect(res).toEqual({ joined: true, waitingCount: 1 });
    expect(repo.entries[0]?.cityId).toBe(CHENNAI.id);
  });

  it('is idempotent for the same phone, pincode and date', async () => {
    const body = {
      phone: '+919876543210',
      fullName: 'Ananya Iyer',
      pincode: '600001',
      intendedDate: '2027-03-01',
    };
    await service.join(body);
    expect(await service.join(body)).toEqual({ joined: true, waitingCount: 1 });
  });

  it('refuses the waitlist for a pincode that is already bookable', async () => {
    expect(
      await statusOf(service.join({ phone: '+919876543210', fullName: 'A', pincode: '395007' })),
    ).toBe(409);
  });

  it('refuses the waitlist for a BLOCKED pincode', async () => {
    expect(
      await statusOf(service.join({ phone: '+919876543210', fullName: 'A', pincode: '999999' })),
    ).toBe(422);
  });

  it('rejects an intended date in the past or more than 18 months ahead', async () => {
    const base = { phone: '+919876543210', fullName: 'A', pincode: '600001' };
    expect(await statusOf(service.join({ ...base, intendedDate: '2026-11-01' }))).toBe(422);
    expect(await statusOf(service.join({ ...base, intendedDate: '2028-06-01' }))).toBe(422);
    expect(await statusOf(service.join({ ...base, intendedDate: '2026-11-02' }))).toBe(200);
  });

  it('caps waitlist joins per phone per day', async () => {
    const base = { phone: '+919876543210', fullName: 'A' };
    for (const pincode of ['600001', '600002', '600003']) {
      expect(await statusOf(service.join({ ...base, pincode }))).toBe(200);
    }
    expect(await statusOf(service.join({ ...base, pincode: '600004' }))).toBe(429);
  });

  it('resolves a bookable venue for pricing, including its state', async () => {
    expect(await service.resolveVenue('395007')).toEqual({
      pincode: '395007',
      cityId: SURAT.id,
      cityName: SURAT.name,
      cityTier: 'TIER_1',
      state: 'Gujarat',
      travelZone: 0,
    });
  });

  it('names cities by id for other modules', async () => {
    expect(await service.cityNames([SURAT.id, 'unknown'])).toEqual(
      new Map([[SURAT.id, SURAT.name]]),
    );
  });

  it('refuses to resolve a waitlist or unknown pincode for pricing', async () => {
    expect(await statusOf(service.resolveVenue('600001'))).toBe(422);
    expect(await statusOf(service.resolveVenue('110001'))).toBe(422);
  });
});
