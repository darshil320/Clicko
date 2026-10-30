import { describe, expect, it, vi } from 'vitest';
import { createAdminApiClient } from '../admin-client.js';
import { pricingPreviewParams } from '../admin-pricing-client.js';
import { isApiError } from '../errors.js';
import { fail, memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const CITY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ROW = '9f1b5e3c-4d6a-4eaf-9b32-3c4d5e6f7081';

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: UUID,
  state: 'DRAFT',
  version: null,
  label: 'Diwali rates',
  effectiveFrom: null,
  effectiveTo: null,
  publishedAt: null,
  publishedBy: null,
  createdAt: '2026-10-30T10:00:00+05:30',
  createdBy: 'Aisha Khan',
  updatedAt: '2026-10-30T10:05:00+05:30',
  discardedAt: null,
  discardedBy: null,
  basedOn: { id: UUID_2, version: '2026.10.01' },
  changeCount: 2,
  ...overrides,
});

const ruleset = {
  summary: summary(),
  pricesIncludeGst: false,
  gstRateBps: 1800,
  sacCode: '998383',
  baseRates: [
    {
      id: ROW,
      tier: 'PROFESSIONAL',
      cityTier: 'TIER_1',
      ratePerHourPaise: 425000,
      payoutShareBps: 6000,
      isQuoteOnly: false,
    },
  ],
  categoryUplifts: [],
  addonPrices: [],
  extensionRates: [],
  festivals: [],
  emergency: [],
  timeMultipliers: [],
  travelSlabs: [],
};

function client(reply: Parameters<typeof mockFetch>[0]) {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  const api = createAdminApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired: vi.fn() });
  return { api, calls };
}

async function rejection(run: Promise<unknown> | (() => Promise<unknown>)) {
  try {
    await (typeof run === 'function' ? run() : run);
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('adminPricingRoutes (ADR-0026 D4)', () => {
  it('reads the overview and one rate card with the staff token', async () => {
    const { api, calls } = client((call) =>
      call.url.endsWith('/rulesets')
        ? ok({
            live: summary({ state: 'LIVE', version: '2026.10.01' }),
            scheduled: null,
            drafts: [],
            history: [],
          })
        : ok(ruleset),
    );
    const overview = await api.pricing.overview();
    expect(overview.live?.version).toBe('2026.10.01');
    const card = await api.pricing.get(UUID);
    expect(card.baseRates[0]?.ratePerHourPaise).toBe(425000);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', `${BASE}/admin/pricing/rulesets`],
      ['GET', `${BASE}/admin/pricing/rulesets/${UUID}`],
    ]);
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
  });

  it('creates a draft and edits it with an Idempotency-Key, defaults applied', async () => {
    const { api, calls } = client(() => ok(ruleset));
    await api.pricing.createDraft({ label: '  Diwali rates ' }, { idempotencyKey: KEY });
    expect(calls[0]?.url).toBe(`${BASE}/admin/pricing/rulesets/drafts`);
    expect(calls[0]?.body).toEqual({ label: 'Diwali rates', fromRulesetId: null });
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY);

    await api.pricing.edit(
      UUID,
      { changes: [{ kind: 'BASE_RATE', id: ROW, ratePerHourPaise: 450000, payoutShareBps: 6000 }] },
      { idempotencyKey: KEY },
    );
    expect(calls[1]?.url).toBe(`${BASE}/admin/pricing/rulesets/${UUID}/edits`);
    expect(calls[1]?.body).toEqual({
      changes: [
        {
          kind: 'BASE_RATE',
          id: ROW,
          ratePerHourPaise: 450000,
          payoutShareBps: 6000,
          syncExtension: true,
        },
      ],
    });
  });

  it('refuses out-of-range edits and a malformed code before any request', async () => {
    const { api, calls } = client(() => ok(ruleset));
    const uplift = await rejection(() =>
      api.pricing.edit(
        UUID,
        { changes: [{ kind: 'CATEGORY_UPLIFT', id: ROW, multiplierBps: 40000 }] },
        { idempotencyKey: KEY },
      ),
    );
    expect(uplift.code).toBe('INVALID_INPUT');
    const festival = await rejection(() =>
      api.pricing.edit(
        UUID,
        {
          changes: [
            {
              kind: 'FESTIVAL_ADD',
              festival: {
                label: 'Diwali',
                dateFrom: '2026-11-11',
                dateTo: '2026-11-06',
                cityId: null,
                multiplierBps: 12500,
                isPeakSeason: true,
              },
            },
          ],
        },
        { idempotencyKey: KEY },
      ),
    );
    expect(festival.message).toBe('The last day must be on or after the first day');
    const code = await rejection(() =>
      api.pricing.publish(
        UUID,
        { code: '12345', expectedUpdatedAt: '2026-10-30T10:05:00+05:30' },
        { idempotencyKey: KEY },
      ),
    );
    expect(code.message).toBe('Enter the 6-digit code from your authenticator app');
    const badId = await rejection(() => api.pricing.get('../staff'));
    expect(badId.code).toBe('INVALID_ID');
    expect(calls).toHaveLength(0);
  });

  it('publishes now or later with the code, and surfaces the server reason', async () => {
    const published = {
      published: summary({
        state: 'SCHEDULED',
        version: '2026.11.01',
        effectiveFrom: '2026-11-01T00:00:00+05:30',
      }),
      replaced: summary({ id: UUID_2, state: 'LIVE', version: '2026.10.01', changeCount: null }),
    };
    const { api, calls } = client((call) =>
      (call.body as { code: string }).code === '000000'
        ? fail(422, 'STEP_UP_CODE_INVALID', 'That code is not right.')
        : ok(published),
    );
    const res = await api.pricing.publish(
      UUID,
      {
        code: ' 123456 ',
        effectiveFrom: '2026-11-01T00:00:00+05:30',
        expectedUpdatedAt: '2026-10-30T10:05:00+05:30',
      },
      { idempotencyKey: KEY },
    );
    expect(res.published.version).toBe('2026.11.01');
    expect(calls[0]?.url).toBe(`${BASE}/admin/pricing/rulesets/${UUID}/publish`);
    expect(calls[0]?.body).toEqual({
      code: '123456',
      effectiveFrom: '2026-11-01T00:00:00+05:30',
      expectedUpdatedAt: '2026-10-30T10:05:00+05:30',
    });

    const wrong = await rejection(() =>
      api.pricing.publish(
        UUID,
        { code: '000000', expectedUpdatedAt: '2026-10-30T10:05:00+05:30' },
        { idempotencyKey: KEY },
      ),
    );
    expect(wrong).toMatchObject({ status: 422, code: 'STEP_UP_CODE_INVALID' });
    expect(calls[1]?.body).toEqual({
      code: '000000',
      effectiveFrom: null,
      expectedUpdatedAt: '2026-10-30T10:05:00+05:30',
    });
  });

  it('discards a draft and cancels a schedule', async () => {
    const { api, calls } = client(() => ok({ ruleset: summary({ state: 'DISCARDED' }) }));
    await api.pricing.discard(UUID, { idempotencyKey: KEY });
    await api.pricing.cancelSchedule(UUID, { idempotencyKey: KEY });
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/admin/pricing/rulesets/${UUID}/discard`,
      `${BASE}/admin/pricing/rulesets/${UUID}/cancel-schedule`,
    ]);
  });
});

describe('pricingPreviewParams', () => {
  it('builds the calculator query, repeating add-ons', () => {
    const params = pricingPreviewParams({
      tier: 'PROFESSIONAL',
      categoryCode: 'FOOD',
      cityId: CITY,
      hours: 2.5,
      scheduledStart: '2026-11-14T16:30:00+05:30',
      addons: ['DRONE', 'LIGHTING_KIT'],
      travelDistanceKm: 18,
    });
    expect(params.toString()).toBe(
      `tier=PROFESSIONAL&categoryCode=FOOD&cityId=${CITY}&hours=2.5&scheduledStart=2026-11-14T16%3A30%3A00%2B05%3A30&addons=DRONE&addons=LIGHTING_KIT&travelDistanceKm=18`,
    );
  });

  it('refuses a duration that is not a half-hour step', () => {
    expect(() =>
      pricingPreviewParams({
        tier: 'BASIC',
        categoryCode: 'FOOD',
        cityId: CITY,
        hours: 2.25,
        scheduledStart: '2026-11-14T16:30:00+05:30',
      }),
    ).toThrow();
  });

  it('the preview call validates its answer against the contract', async () => {
    const { api, calls } = client(() => ok({ city: { id: CITY, name: 'Surat' } }));
    const err = await rejection(() =>
      api.pricing.preview(UUID, {
        tier: 'PROFESSIONAL',
        categoryCode: 'FOOD',
        cityId: CITY,
        hours: 2,
        scheduledStart: '2026-11-14T16:30:00+05:30',
      }),
    );
    expect(err.kind).toBe('INVALID_RESPONSE');
    expect(calls[0]?.url).toContain(`/admin/pricing/rulesets/${UUID}/preview?tier=PROFESSIONAL`);
  });
});
