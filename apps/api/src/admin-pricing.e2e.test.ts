import type { StaffRole } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PricingDeskService } from './modules/admin/desks/pricing-desk.service';
import { LAUNCH_RULESET_VERSION } from './modules/pricing/engine/launch-ruleset';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { insertClient, tokenFor } from './test-support/onsite-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import {
  bootstrapStaff,
  cityIdOf,
  codeFor,
  signIn,
  staffToken,
} from './test-support/staff-fixtures';

/** Monday 5 Oct 2026, 10:00 IST — the launch rate card (from 1 Oct) is live, no festival yet. */
const NOW = new Date('2026-10-05T04:30:00.000Z');
const DAY = 86_400_000;
/** Wednesday 14 Oct, 4:30 pm IST: lead > 48 h, daytime, weekday, before wedding season. */
const START = '2026-10-14T11:00:00.000Z';
const STEP = 31_000;

/** Every table that hangs off a ruleset (schema §5) — a draft copies all of them. */
const CHILD_TABLES = [
  'base_rates',
  'category_uplifts',
  'emergency_multipliers',
  'time_multipliers',
  'festival_calendar',
  'travel_slabs',
  'addon_prices',
  'extension_rates',
  'plan_deliverables',
] as const;

let keySeq = 0;
const idem = () => `admin-pricing-${String(++keySeq).padStart(6, '0')}`;

/**
 * ADR-0026 D4 / doc 05 §11 end to end: a draft is a complete copy of the live ruleset; edits
 * touch only the draft; the diff lists exactly what changed; the calculator prices the draft
 * with the real engine next to live; publishing needs FINANCE + a fresh authenticator code
 * (replay-guarded), closes the previous ruleset, audits the full before/after and emits an
 * outbox event; bookings keep their ruleset; nothing is ever deleted.
 */
describe.runIf(TEST_DATABASE_URL)('the pricing editor', () => {
  let e2e: E2eApp;
  const secrets = new Map<string, string>();
  const staff = {} as Record<
    'admin' | 'finance' | 'financeSurat' | 'cmSurat' | 'readOnly' | 'ops',
    string
  >;
  let liveId: string;
  let surat: string;
  let draft: Json;

  const as = async (who: keyof typeof staff) => staffToken(e2e, staff[who]);
  const get = async (who: keyof typeof staff, path: string) =>
    e2e.call('GET', path, { token: await as(who) });
  /** The draft's updated_at as a reviewer last saw it (what a publish must name). */
  const reviewedAt = async (id: string) => {
    const [row] = await e2e.db.sql<{ updated_at: Date }[]>`
      SELECT updated_at FROM pricing_rulesets WHERE id = ${id}`;
    return row?.updated_at.toISOString() ?? new Date(0).toISOString();
  };
  /** Publish bodies name the reviewed draft version unless a test sets it. */
  const withReview = async (path: string, body: unknown) => {
    const m = /\/admin\/pricing\/rulesets\/([0-9a-f-]{36})\/publish$/.exec(path);
    if (!m?.[1] || typeof body !== 'object' || body === null || 'expectedUpdatedAt' in body) {
      return body;
    }
    return { ...body, expectedUpdatedAt: await reviewedAt(m[1]) };
  };
  const post = async (who: keyof typeof staff, path: string, body?: unknown, key = idem()) => {
    const sent = await withReview(path, body);
    return e2e.call('POST', path, {
      token: await as(who),
      idempotencyKey: key,
      ...(sent === undefined ? {} : { body: sent }),
    });
  };
  /** The finance authenticator's code at the app clock, one step after the last one used. */
  const freshCode = () => {
    e2e.advance(STEP);
    return codeFor(e2e, secrets.get('finance@clickco.test') as string);
  };
  const auditRows = (action: string) =>
    e2e.db.sql<{ actor_id: string; entity_id: string; before_state: Json; after_state: Json }[]>`
      SELECT actor_id, entity_id, before_state, after_state FROM audit_logs
      WHERE action = ${action} ORDER BY id`;
  const events = (type: string) =>
    e2e.db.sql<{ aggregate_id: string; payload: Json }[]>`
      SELECT aggregate_id, payload FROM domain_events WHERE event_type = ${type} ORDER BY occurred_at`;
  const rowsOf = async (table: string, rulesetId: string) =>
    (
      await e2e.db.sql<{ r: string }[]>`
        SELECT (to_jsonb(t) - 'id' - 'ruleset_id' - 'created_at')::text AS r
        FROM ${e2e.db.sql(table)} t WHERE ruleset_id = ${rulesetId} ORDER BY 1`
    ).map((x) => x.r);
  const rowId = (rows: Json[], match: (r: Json) => boolean): string => {
    const found = rows.find(match);
    if (!found) throw new Error('rowId: no such row');
    return found.id as string;
  };
  const publicQuote = async () =>
    e2e.call('POST', '/pricing/quote', {
      body: {
        tier: 'PROFESSIONAL',
        categoryCode: 'FOOD',
        pincode: '395007',
        scheduledStart: START,
        hours: 2,
      },
    });
  const previewPath = (id: string) =>
    `/admin/pricing/rulesets/${id}/preview?tier=PROFESSIONAL&categoryCode=FOOD&cityId=${surat}&hours=2&scheduledStart=${encodeURIComponent(START)}`;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
    surat = await cityIdOf(e2e, 'Surat');
    const make = async (key: keyof typeof staff, role: StaffRole, cityId: string | null = null) => {
      const made = await bootstrapStaff(e2e, `${key}@clickco.test`, role, cityId);
      staff[key] = made.id;
      return made;
    };
    await make('admin', 'SUPER_ADMIN');
    const finance = await make('finance', 'FINANCE');
    await make('financeSurat', 'FINANCE', surat);
    await make('cmSurat', 'CITY_MANAGER', surat);
    await make('readOnly', 'READ_ONLY');
    await make('ops', 'OPS_AGENT');
    // Enrols the finance authenticator through the real sign-in (the step-up secret).
    await signIn(e2e, secrets, 'finance@clickco.test', finance.password);
    const [live] = await e2e.db.sql<{ id: string }[]>`
      SELECT id FROM pricing_rulesets WHERE version = ${LAUNCH_RULESET_VERSION}`;
    liveId = live?.id as string;
  }, 120_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('the overview', () => {
    it('shows the live version to finance, city managers and read-only; not to ops', async () => {
      for (const who of ['finance', 'cmSurat', 'readOnly', 'admin'] as const) {
        const res = await get(who, '/admin/pricing/rulesets');
        expect(res.status, who).toBe(200);
        expect(res.json.data.live).toMatchObject({
          id: liveId,
          state: 'LIVE',
          version: LAUNCH_RULESET_VERSION,
          effectiveTo: null,
        });
        expect(res.json.data.drafts).toEqual([]);
        expect(res.json.data.scheduled).toBeNull();
      }
      expect((await get('ops', '/admin/pricing/rulesets')).status).toBe(403);
    });
  });

  describe('drafts', () => {
    it('only finance (and super admin) may start one', async () => {
      for (const who of ['readOnly', 'cmSurat', 'ops'] as const) {
        expect((await post(who, '/admin/pricing/rulesets/drafts', {})).status, who).toBe(403);
      }
    });

    it('is a complete copy of the live ruleset and every child row, unpublished', async () => {
      const res = await post('finance', '/admin/pricing/rulesets/drafts', {
        label: 'Food and Pro rates',
      });
      expect(res.status).toBe(200);
      draft = res.json.data;
      expect(draft.summary).toMatchObject({
        state: 'DRAFT',
        version: null,
        label: 'Food and Pro rates',
        effectiveFrom: null,
        publishedAt: null,
        createdBy: 'Test FINANCE',
        basedOn: { id: liveId, version: LAUNCH_RULESET_VERSION },
        changeCount: 0,
      });
      expect(draft.baseRates).toHaveLength(20);
      for (const table of CHILD_TABLES) {
        const [live, copy] = await Promise.all([
          rowsOf(table, liveId),
          rowsOf(table, draft.summary.id),
        ]);
        expect(live.length, table).toBeGreaterThan(0);
        expect(copy, table).toEqual(live);
      }
      const [row] = await e2e.db.sql<{ published_at: Date | null; created_by: string }[]>`
        SELECT published_at, created_by FROM pricing_rulesets WHERE id = ${draft.summary.id}`;
      expect(row).toEqual({ published_at: null, created_by: staff.finance });
      expect(await auditRows('pricing.draft_create')).toEqual([
        expect.objectContaining({ actor_id: staff.finance, entity_id: draft.summary.id }),
      ]);
      expect((await events('pricing.draft_created')).map((e) => e.aggregate_id)).toEqual([
        draft.summary.id,
      ]);
    });

    it('never prices a booking: the public quote still uses the live version', async () => {
      const quote = await publicQuote();
      expect(quote.json.data).toMatchObject({
        rulesetVersion: LAUNCH_RULESET_VERSION,
        totalPaise: 1153450,
      });
    });

    it('cannot copy a draft', async () => {
      const res = await post('finance', '/admin/pricing/rulesets/drafts', {
        fromRulesetId: draft.summary.id,
      });
      expect(res.status).toBe(422);
      expect(res.json.error.code).toBe('DRAFT_SOURCE_NOT_PUBLISHED');
    });
  });

  describe('editing a draft', () => {
    it('changes only the draft, records before/after, and keeps extensions in step', async () => {
      const proTier1 = rowId(
        draft.baseRates,
        (r) => r.tier === 'PROFESSIONAL' && r.cityTier === 'TIER_1',
      );
      const food = rowId(draft.categoryUplifts, (r) => r.categoryCode === 'FOOD');
      const drone = rowId(draft.addonPrices, (r) => r.addonCode === 'DRONE');
      const valentines = rowId(draft.festivals, (r) => String(r.label).startsWith('Valentine'));
      const res = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/edits`, {
        changes: [
          {
            kind: 'BASE_RATE',
            id: proTier1,
            ratePerHourPaise: 450000,
            payoutShareBps: 6000,
          },
          { kind: 'CATEGORY_UPLIFT', id: food, multiplierBps: 12000 },
          { kind: 'ADDON_PRICE', id: drone, amountPaise: 500000 },
          {
            kind: 'FESTIVAL_ADD',
            festival: {
              label: 'Surat Food Week',
              dateFrom: '2026-12-01',
              dateTo: '2026-12-07',
              cityId: surat,
              multiplierBps: 11000,
              isPeakSeason: false,
            },
          },
          { kind: 'FESTIVAL_REMOVE', id: valentines },
        ],
      });
      expect(res.status).toBe(200);
      draft = res.json.data;
      expect(draft.baseRates.find((r: Json) => r.id === proTier1)).toMatchObject({
        ratePerHourPaise: 450000,
      });
      expect(
        draft.extensionRates.find(
          (r: Json) => r.tier === 'PROFESSIONAL' && r.cityTier === 'TIER_1',
        ),
      ).toMatchObject({ hourlyPaise: 450000, waitingHourlyPaise: 270000 });
      expect(draft.festivals.some((f: Json) => f.label === 'Surat Food Week')).toBe(true);
      expect(draft.festivals.some((f: Json) => f.id === valentines)).toBe(false);

      const [live] = await e2e.db.sql<{ rate: string }[]>`
        SELECT rate_per_hour_paise AS rate FROM base_rates
        WHERE ruleset_id = ${liveId} AND tier = 'PROFESSIONAL' AND city_tier = 'TIER_1'`;
      expect(live?.rate).toBe('425000');

      const [audit] = await auditRows('pricing.draft_edit');
      expect(audit?.entity_id).toBe(draft.summary.id);
      expect(audit?.before_state.changes[0]).toMatchObject({ ratePerHourPaise: 425000 });
      expect(audit?.after_state.changes[0]).toMatchObject({ ratePerHourPaise: 450000 });
    });

    it('refuses rows of another ruleset, out-of-range values and non-finance callers', async () => {
      const liveRow = await e2e.db.sql<{ id: string }[]>`
        SELECT id FROM category_uplifts WHERE ruleset_id = ${liveId} LIMIT 1`;
      const foreign = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/edits`, {
        changes: [{ kind: 'CATEGORY_UPLIFT', id: liveRow[0]?.id, multiplierBps: 15000 }],
      });
      expect(foreign.status).toBe(404);
      expect(foreign.json.error.code).toBe('ROW_NOT_FOUND');

      const food = rowId(draft.categoryUplifts, (r) => r.categoryCode === 'FOOD');
      const tooHigh = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/edits`, {
        changes: [{ kind: 'CATEGORY_UPLIFT', id: food, multiplierBps: 40000 }],
      });
      expect(tooHigh.status).toBe(400);

      const basic = rowId(draft.baseRates, (r) => r.tier === 'BASIC' && r.cityTier === 'METRO');
      const zero = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/edits`, {
        changes: [{ kind: 'BASE_RATE', id: basic, ratePerHourPaise: 0, payoutShareBps: 6200 }],
      });
      expect(zero.status).toBe(422);
      expect(zero.json.error.code).toBe('RATE_ZERO');

      const readOnly = await post('readOnly', `/admin/pricing/rulesets/${draft.summary.id}/edits`, {
        changes: [{ kind: 'CATEGORY_UPLIFT', id: food, multiplierBps: 15000 }],
      });
      expect(readOnly.status).toBe(403);
    });

    it('never edits a published ruleset', async () => {
      const liveDetail = await get('finance', `/admin/pricing/rulesets/${liveId}`);
      const row = rowId(liveDetail.json.data.categoryUplifts, (r) => r.categoryCode === 'FOOD');
      const res = await post('finance', `/admin/pricing/rulesets/${liveId}/edits`, {
        changes: [{ kind: 'CATEGORY_UPLIFT', id: row, multiplierBps: 15000 }],
      });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('NOT_A_DRAFT');
    });
  });

  describe('the diff against live', () => {
    it('lists exactly the changed rows with before and after', async () => {
      const res = await get('readOnly', `/admin/pricing/rulesets/${draft.summary.id}/diff`);
      expect(res.status).toBe(200);
      const diff = res.json.data;
      expect(diff.against).toEqual({ id: liveId, version: LAUNCH_RULESET_VERSION });
      expect(diff.liveChangedSinceCopy).toBe(false);
      const bySection = (section: string) =>
        (diff.rows as Json[]).filter((r) => r.section === section);
      expect(bySection('BASE_RATE')).toEqual([
        expect.objectContaining({
          key: 'BASE_RATE:PROFESSIONAL:TIER_1',
          change: 'CHANGED',
          fields: [
            {
              field: 'ratePerHourPaise',
              label: 'Hourly rate',
              value: { unit: 'PAISE', before: 425000, after: 450000 },
            },
          ],
        }),
      ]);
      expect(bySection('EXTENSION_RATE')).toHaveLength(1);
      expect(bySection('CATEGORY_UPLIFT')[0]?.fields[0]?.value).toEqual({
        unit: 'BPS',
        before: 11500,
        after: 12000,
      });
      expect(bySection('ADDON_PRICE')[0]?.fields[0]?.value).toEqual({
        unit: 'PAISE',
        before: 450000,
        after: 500000,
      });
      expect(
        bySection('FESTIVAL')
          .map((r) => r.change)
          .sort(),
      ).toEqual(['ADDED', 'REMOVED']);
      expect(diff.rows).toHaveLength(6);

      const overview = await get('finance', '/admin/pricing/rulesets');
      expect(overview.json.data.drafts[0]).toMatchObject({ id: draft.summary.id, changeCount: 6 });
    });
  });

  describe('the live calculator', () => {
    it('prices the draft with the engine, next to live, without creating anything', async () => {
      const bookingsBefore = await e2e.db.sql`SELECT count(*)::int AS n FROM bookings`;
      const res = await get('cmSurat', previewPath(draft.summary.id));
      expect(res.status).toBe(200);
      const preview = res.json.data;
      expect(preview.city).toMatchObject({ id: surat, name: 'Surat', tier: 'TIER_1' });
      // Live: ₹4,250 × 2 h × 1.15 = ₹9,775 + 18% GST.
      expect(preview.live.result).toMatchObject({
        kind: 'QUOTE',
        subtotalPaise: 977500,
        totalPaise: 1153450,
        expectedPayoutPaise: 586500,
      });
      // Draft: ₹4,500 × 2 h × 1.20 = ₹10,800 + 18% GST.
      expect(preview.ruleset).toMatchObject({ rulesetId: draft.summary.id, version: null });
      expect(preview.ruleset.result).toMatchObject({
        kind: 'QUOTE',
        subtotalPaise: 1080000,
        totalPaise: 1274400,
        expectedPayoutPaise: 648000,
      });
      expect(await e2e.db.sql`SELECT count(*)::int AS n FROM bookings`).toEqual(bookingsBefore);
    });

    it('shows an engine rejection instead of failing', async () => {
      const res = await get(
        'finance',
        previewPath(draft.summary.id).replace('categoryCode=FOOD', 'categoryCode=UNDERWATER'),
      );
      expect(res.status).toBe(200);
      expect(res.json.data.ruleset.result).toMatchObject({
        kind: 'REJECTED',
        code: 'UNKNOWN_CATEGORY',
      });
    });
  });

  describe('publishing', () => {
    let bookingId: string;

    it('is refused to anyone but finance and super admin', async () => {
      for (const who of ['readOnly', 'cmSurat', 'ops'] as const) {
        const res = await post(who, `/admin/pricing/rulesets/${draft.summary.id}/publish`, {
          code: '123456',
          effectiveFrom: null,
        });
        expect(res.status, who).toBe(403);
      }
    });

    it('refuses a city-limited finance grant: prices apply in every city', async () => {
      const res = await post('financeSurat', '/admin/pricing/rulesets/drafts', {});
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe('PRICING_NEEDS_ALL_CITIES');
      expect((await get('financeSurat', '/admin/pricing/rulesets')).status).toBe(200);
    });

    it('refuses a publish of a draft that changed after it was reviewed', async () => {
      const res = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/publish`, {
        code: '000000',
        effectiveFrom: null,
        expectedUpdatedAt: new Date(0).toISOString(),
      });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('DRAFT_CHANGED_SINCE_REVIEW');
      expect(await auditRows('staff.step_up_failed')).toHaveLength(0);
    });

    it('needs a valid authenticator code, and refuses a code already used', async () => {
      const wrong = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/publish`, {
        code: '000000',
        effectiveFrom: null,
      });
      expect(wrong.status).toBe(422);
      expect(wrong.json.error.code).toBe('STEP_UP_CODE_INVALID');
      expect(await auditRows('staff.step_up_failed')).toHaveLength(1);

      // The sign-in used the current step: the same code is a replay.
      const replay = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/publish`, {
        code: codeFor(e2e, secrets.get('finance@clickco.test') as string),
        effectiveFrom: null,
      });
      expect(replay.status).toBe(422);
      expect(replay.json.error.code).toBe('STEP_UP_CODE_USED');
      expect(await auditRows('staff.step_up_failed')).toHaveLength(2);

      const [row] = await e2e.db.sql<{ published_at: Date | null }[]>`
        SELECT published_at FROM pricing_rulesets WHERE id = ${draft.summary.id}`;
      expect(row?.published_at).toBeNull();
    });

    it('refuses a start in the past or too far ahead before spending the code', async () => {
      const past = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/publish`, {
        code: '000000',
        effectiveFrom: new Date(e2e.now().getTime() - 60_000).toISOString(),
      });
      expect(past.status).toBe(422);
      expect(past.json.error.code).toBe('EFFECTIVE_FROM_PAST');
      const far = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/publish`, {
        code: '000000',
        effectiveFrom: new Date(e2e.now().getTime() + 120 * DAY).toISOString(),
      });
      expect(far.status).toBe(422);
      expect(far.json.error.code).toBe('EFFECTIVE_FROM_TOO_FAR');
      expect(await auditRows('staff.step_up_failed')).toHaveLength(2);
    });

    it('schedules a change: live until then, closed at its start; quotes still use live', async () => {
      const at = new Date(NOW.getTime() + 2 * DAY);
      const res = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/publish`, {
        code: freshCode(),
        effectiveFrom: at.toISOString(),
      });
      expect(res.status).toBe(200);
      expect(res.json.data.published).toMatchObject({
        id: draft.summary.id,
        state: 'SCHEDULED',
        version: '2026.10.07',
        publishedBy: 'Test FINANCE',
      });
      expect(Date.parse(res.json.data.published.effectiveFrom)).toBe(at.getTime());
      expect(res.json.data.replaced).toMatchObject({ id: liveId, state: 'LIVE' });
      expect(Date.parse(res.json.data.replaced.effectiveTo)).toBe(at.getTime());

      const overview = await get('readOnly', '/admin/pricing/rulesets');
      expect(overview.json.data.live.id).toBe(liveId);
      expect(overview.json.data.scheduled.id).toBe(draft.summary.id);
      expect(overview.json.data.drafts).toEqual([]);
      expect((await publicQuote()).json.data.rulesetVersion).toBe(LAUNCH_RULESET_VERSION);

      const [audit] = await auditRows('pricing.publish');
      expect(audit?.actor_id).toBe(staff.finance);
      expect(audit?.before_state.ruleset.version).toBe(LAUNCH_RULESET_VERSION);
      expect(audit?.after_state.ruleset.version).toBe('2026.10.07');
      expect(audit?.after_state.stepUp).toBe('TOTP');
      expect(
        ((audit?.after_state.content.baseRates ?? []) as Json[]).find(
          (r) => r.tier === 'PROFESSIONAL' && r.cityTier === 'TIER_1',
        )?.ratePerHourPaise,
      ).toBe(450000);
      expect(audit?.before_state.content.baseRates).toHaveLength(20);
      const [event] = await events('pricing.ruleset_published');
      expect(event).toMatchObject({
        aggregate_id: draft.summary.id,
        payload: { version: '2026.10.07', previous_ruleset_id: liveId },
      });
    });

    it('allows one scheduled change at a time', async () => {
      const second = await post('finance', '/admin/pricing/rulesets/drafts', {});
      expect(second.status).toBe(200);
      const res = await post(
        'finance',
        `/admin/pricing/rulesets/${second.json.data.summary.id}/publish`,
        { code: '000000', effectiveFrom: null },
      );
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('CHANGE_ALREADY_SCHEDULED');
      const discard = await post(
        'finance',
        `/admin/pricing/rulesets/${second.json.data.summary.id}/discard`,
      );
      expect(discard.status).toBe(200);
    });

    it('cancels a scheduled change back to a draft and reopens live', async () => {
      const res = await post(
        'finance',
        `/admin/pricing/rulesets/${draft.summary.id}/cancel-schedule`,
      );
      expect(res.status).toBe(200);
      expect(res.json.data.ruleset).toMatchObject({
        id: draft.summary.id,
        state: 'DRAFT',
        version: null,
        effectiveFrom: null,
      });
      const overview = await get('finance', '/admin/pricing/rulesets');
      expect(overview.json.data.live).toMatchObject({ id: liveId, effectiveTo: null });
      expect(overview.json.data.scheduled).toBeNull();
      expect(await auditRows('pricing.schedule_cancel')).toHaveLength(1);
    });

    it('publishes now: new quotes use it, an existing quoted booking keeps its price', async () => {
      const client = await insertClient(e2e, '+919999270001');
      const userToken = await tokenFor(e2e, 'USER', client);
      const created = await e2e.call('POST', '/bookings', {
        token: userToken,
        idempotencyKey: idem(),
        body: {
          tier: 'PROFESSIONAL',
          categoryCode: 'FOOD',
          pincode: '395007',
          scheduledStart: START,
          hours: 2,
          venueAddress: '4 Athwalines, Surat',
          booker: { name: 'Rohan Shah', phone: '+919999270001' },
          modelReleaseConsent: false,
          acceptedTermsVersion: '2.0',
        },
      });
      expect(created.status).toBe(201);
      bookingId = created.json.data.booking.id as string;

      const res = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/publish`, {
        code: freshCode(),
        effectiveFrom: null,
      });
      expect(res.status).toBe(200);
      expect(res.json.data.published).toMatchObject({ state: 'LIVE', version: '2026.10.05' });
      expect(res.json.data.replaced).toMatchObject({ id: liveId, state: 'CLOSED' });

      const quote = await publicQuote();
      expect(quote.json.data).toMatchObject({ rulesetVersion: '2026.10.05', totalPaise: 1274400 });

      const [booking] = await e2e.db.sql<{ ruleset_id: string; total_paise: string }[]>`
        SELECT s.ruleset_id, b.total_paise FROM bookings b
        JOIN booking_price_snapshots s ON s.booking_id = b.id
        WHERE b.id = ${bookingId}`;
      expect(booking).toEqual({ ruleset_id: liveId, total_paise: '1153450' });
      // The quote is honoured until it expires: the client can still pay the old price.
      const pay = await e2e.call('POST', `/bookings/${bookingId}/pay`, {
        token: userToken,
        idempotencyKey: idem(),
      });
      expect(pay.status).toBeLessThan(300);
    });

    it('cannot publish the same draft twice', async () => {
      const res = await post('finance', `/admin/pricing/rulesets/${draft.summary.id}/publish`, {
        code: '000000',
        effectiveFrom: null,
      });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('ALREADY_PUBLISHED');
    });
  });

  describe('never delete — close', () => {
    it('keeps every ruleset: closed, live and discarded all remain', async () => {
      const rows = await e2e.db.sql<{ state: string }[]>`
        SELECT CASE
          WHEN discarded_at IS NOT NULL THEN 'DISCARDED'
          WHEN published_at IS NULL THEN 'DRAFT'
          WHEN effective_to IS NULL THEN 'OPEN'
          ELSE 'CLOSED' END AS state
        FROM pricing_rulesets ORDER BY created_at`;
      expect(rows.map((r) => r.state).sort()).toEqual(['CLOSED', 'DISCARDED', 'OPEN']);
      const overview = await get('readOnly', '/admin/pricing/rulesets');
      expect(overview.json.data.history.map((h: Json) => h.state).sort()).toEqual([
        'CLOSED',
        'DISCARDED',
      ]);
    });

    it('a discarded draft cannot be edited or published', async () => {
      const [discarded] = await e2e.db.sql<{ id: string }[]>`
        SELECT id FROM pricing_rulesets WHERE discarded_at IS NOT NULL`;
      const detail = await get('finance', `/admin/pricing/rulesets/${discarded?.id}`);
      expect(detail.json.data.summary.state).toBe('DISCARDED');
      const food = rowId(detail.json.data.categoryUplifts, (r) => r.categoryCode === 'FOOD');
      const edit = await post('finance', `/admin/pricing/rulesets/${discarded?.id}/edits`, {
        changes: [{ kind: 'CATEGORY_UPLIFT', id: food, multiplierBps: 15000 }],
      });
      expect(edit.status).toBe(409);
      expect(edit.json.error.code).toBe('DRAFT_DISCARDED');
    });

    it('rolls back by copying an old version into a new draft (super admin)', async () => {
      const res = await post('admin', '/admin/pricing/rulesets/drafts', {
        label: 'Back to launch',
        fromRulesetId: liveId,
      });
      expect(res.status).toBe(200);
      expect(res.json.data.summary.basedOn).toEqual({
        id: liveId,
        version: LAUNCH_RULESET_VERSION,
      });
      const diff = await get('admin', `/admin/pricing/rulesets/${res.json.data.summary.id}/diff`);
      expect(diff.json.data.liveChangedSinceCopy).toBe(true);
      expect(diff.json.data.rows).toHaveLength(6);
    });

    it('counts drafts awaiting publish for the Today page', async () => {
      expect(await e2e.get(PricingDeskService).overviewCount()).toBe(1);
    });
  });
});
