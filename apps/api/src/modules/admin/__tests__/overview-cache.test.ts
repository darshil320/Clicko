import { describe, expect, it } from 'vitest';
import type { Env } from '../../../config/env';
import type { StaffCaller } from '../access/staff-context';
import type { AlertFeedService } from '../desks/alert-feed.service';
import { OverviewRegistry } from '../overview/overview.registry';
import {
  OVERVIEW_CACHE_TTL_MS,
  OverviewService,
  overviewScopeKey,
} from '../overview/overview.service';

const NOW = new Date('2026-10-31T09:30:00.000Z');

/** A Map-backed stand-in for the ioredis commands the cache uses. */
function fakeRedis(opts: { readonly failing?: boolean } = {}) {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const client = {
    async get(key: string) {
      if (opts.failing) throw new Error('redis down');
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, _px: 'PX', ms: number) {
      if (opts.failing) throw new Error('redis down');
      store.set(key, value);
      ttls.set(key, ms);
      return 'OK';
    },
  };
  return { client, store, ttls };
}

const caller = (grants: StaffCaller['grants']): StaffCaller => ({
  id: 'staff-1',
  email: 'ops@clickco.test',
  fullName: 'Ops',
  grants,
  scope: 'ALL',
});

const OPS = caller([{ id: 'g1', role: 'OPS_AGENT', cityId: null }]);

function build(redis: ReturnType<typeof fakeRedis>, failing = false) {
  const registry = new OverviewRegistry();
  let calls = 0;
  registry.register({
    key: 'qa.waiting',
    desk: 'qa',
    count: async () => {
      calls += 1;
      if (failing) throw new Error('count failed');
      return calls;
    },
    tile: { label: 'Waiting for QA', hint: 'h', order: 10 },
  });
  const feed = { list: async () => ({ items: [] }) } as unknown as AlertFeedService;
  const service = new OverviewService(
    registry,
    feed,
    () => NOW,
    redis.client as never,
    { QUEUE_PREFIX: 'clickco-test' } as Env,
  );
  return { service, calls: () => calls };
}

const qa = (o: { tiles: readonly { key: string; value: number | null }[] }) =>
  o.tiles.find((t) => t.key === 'qa.waiting')?.value;

describe('GET /admin/overview cache (performance audit, ADR-0027 D6)', () => {
  it('keys by grants regardless of order, and separates different grants', () => {
    const a = overviewScopeKey([
      { id: '1', role: 'OPS_AGENT', cityId: null },
      { id: '2', role: 'CITY_MANAGER', cityId: 'surat' },
    ]);
    const b = overviewScopeKey([
      { id: '9', role: 'CITY_MANAGER', cityId: 'surat' },
      { id: '8', role: 'OPS_AGENT', cityId: null },
    ]);
    expect(a).toBe(b);
    expect(overviewScopeKey([{ id: '1', role: 'CITY_MANAGER', cityId: 'mumbai' }])).not.toBe(
      overviewScopeKey([{ id: '1', role: 'CITY_MANAGER', cityId: 'surat' }]),
    );
  });

  it('counts once per scope within the TTL and serves the cached answer', async () => {
    const redis = fakeRedis();
    const { service, calls } = build(redis);
    const first = await service.overview(OPS);
    const second = await service.overview(
      caller([{ id: 'other', role: 'OPS_AGENT', cityId: null }]),
    );
    expect(calls()).toBe(1);
    expect(second).toEqual(first);
    const [key] = [...redis.ttls.keys()];
    expect(key).toMatch(/^clickco-test:admin-overview:[0-9a-f]{64}$/);
    expect(redis.ttls.get(key as string)).toBe(OVERVIEW_CACHE_TTL_MS);
  });

  it('counts again for a different scope', async () => {
    const redis = fakeRedis();
    const { service, calls } = build(redis);
    await service.overview(OPS);
    const surat = await service.overview(
      caller([{ id: 'g2', role: 'CITY_MANAGER', cityId: '00000000-0000-0000-0000-000000000001' }]),
    );
    expect(calls()).toBe(2);
    expect(qa(surat)).toBe(2);
  });

  it('never caches an incomplete answer', async () => {
    const redis = fakeRedis();
    const { service } = build(redis, true);
    expect((await service.overview(OPS)).incomplete).toBe(true);
    expect(redis.store.size).toBe(0);
  });

  it('ignores a corrupt cache entry and recounts', async () => {
    const redis = fakeRedis();
    const { service, calls } = build(redis);
    await service.overview(OPS);
    for (const key of redis.store.keys()) redis.store.set(key, '{"tiles":"nope"}');
    expect(qa(await service.overview(OPS))).toBe(2);
    expect(calls()).toBe(2);
  });

  it('still answers when Redis is down', async () => {
    const { service, calls } = build(fakeRedis({ failing: true }));
    expect(qa(await service.overview(OPS))).toBe(1);
    expect(qa(await service.overview(OPS))).toBe(2);
    expect(calls()).toBe(2);
  });
});
