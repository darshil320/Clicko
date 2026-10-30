import type { CityTier, EmergencyBand, PlanTier, PricingFestivalFields } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';
import {
  DRAFT_EFFECTIVE_FROM_SQL,
  DRAFT_EFFECTIVE_TO_SQL,
  draftVersion,
} from '../editor/lifecycle';
import type { RulesetContent, RulesetRecord } from '../editor/ruleset-content';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

/** Every table that hangs off a ruleset (schema §5). A draft copies all of them. */
export const RULESET_CHILD_TABLES = [
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

/** Columns a copy must not carry over: its own identity, parent and creation time. */
const NOT_COPIED = ['id', 'ruleset_id', 'created_at'];

const paise = (text: string): number => fromPaiseBigint(BigInt(text));
/** Every row write re-checks that its ruleset is an open draft: a published one never changes. */
const draftOnly = (tx: Tx, rulesetId: string) =>
  tx`EXISTS (SELECT 1 FROM pricing_rulesets p WHERE p.id = ${rulesetId}
             AND p.published_at IS NULL AND p.discarded_at IS NULL)`;
/** Identifiers from the catalogue or our own constant list, quoted as Postgres does. */
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const hhmm = (time: string | null): string | null => (time === null ? null : time.slice(0, 5));

interface RecordRow {
  id: string;
  version: string;
  label: string | null;
  effective_from: Date;
  effective_to: Date | null;
  published_at: Date | null;
  published_by: string | null;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  discarded_at: Date | null;
  discarded_by: string | null;
  based_on_id: string | null;
  based_on_version: string | null;
}

const toRecord = (r: RecordRow): RulesetRecord => ({
  id: r.id,
  version: r.version,
  label: r.label,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  publishedAt: r.published_at,
  publishedBy: r.published_by,
  createdAt: r.created_at,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
  discardedAt: r.discarded_at,
  discardedBy: r.discarded_by,
  basedOnId: r.based_on_id,
  basedOnVersion: r.based_on_version,
});

const RECORD_COLUMNS = `r.id, r.version, r.label, r.effective_from, r.effective_to, r.published_at,
  r.published_by, r.created_at, r.created_by, r.updated_at, r.discarded_at, r.discarded_by,
  r.based_on_id, b.version AS based_on_version`;

export interface BaseRateFacts {
  readonly id: string;
  readonly tier: PlanTier;
  readonly cityTier: CityTier;
  readonly ratePerHourPaise: number;
  readonly payoutShareBps: number;
  readonly isQuoteOnly: boolean;
}

export interface ExtensionFacts {
  readonly id: string;
  readonly hourlyPaise: number;
  readonly waitingHourlyPaise: number;
}

export interface FestivalFacts {
  readonly id: string;
  readonly label: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly cityId: string | null;
  readonly multiplierBps: number;
  readonly isPeakSeason: boolean;
}

/**
 * pricing_rulesets and its child tables for the editor (doc 05 §11, addendum 0010). Published
 * rulesets are only ever read here, except their window: a publish closes the previous one
 * (`effective_to`). The engine's read path stays PricingRepository.
 */
@Injectable()
export class RulesetEditorRepository {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  begin<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.sql.begin(work) as Promise<T>;
  }

  get db(): Db {
    return this.sql;
  }

  /** Serialises every draft/publish/cancel: one lifecycle change at a time. */
  async lockLifecycle(tx: Tx): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext('clickco:pricing_rulesets:lifecycle'))`;
  }

  async all(db: Db): Promise<RulesetRecord[]> {
    const rows = await db<RecordRow[]>`
      SELECT ${db.unsafe(RECORD_COLUMNS)}
      FROM pricing_rulesets r LEFT JOIN pricing_rulesets b ON b.id = r.based_on_id
      ORDER BY r.created_at DESC, r.id`;
    return rows.map(toRecord);
  }

  async find(db: Db, id: string): Promise<RulesetRecord | null> {
    const [row] = await db<RecordRow[]>`
      SELECT ${db.unsafe(RECORD_COLUMNS)}
      FROM pricing_rulesets r LEFT JOIN pricing_rulesets b ON b.id = r.based_on_id
      WHERE r.id = ${id}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, id: string): Promise<RulesetRecord | null> {
    const [row] = await tx<RecordRow[]>`
      SELECT ${tx.unsafe(RECORD_COLUMNS)}
      FROM pricing_rulesets r LEFT JOIN pricing_rulesets b ON b.id = r.based_on_id
      WHERE r.id = ${id} FOR UPDATE OF r`;
    return row ? toRecord(row) : null;
  }

  /** The ruleset new quotes use at `now` — the same rule as PricingRepository.loadCurrent. */
  async liveAt(db: Db, now: Date): Promise<RulesetRecord | null> {
    const [row] = await db<RecordRow[]>`
      SELECT ${db.unsafe(RECORD_COLUMNS)}
      FROM pricing_rulesets r LEFT JOIN pricing_rulesets b ON b.id = r.based_on_id
      WHERE r.published_at IS NOT NULL AND r.effective_from <= ${now}
        AND (r.effective_to IS NULL OR r.effective_to > ${now})
      ORDER BY r.effective_from DESC LIMIT 1`;
    return row ? toRecord(row) : null;
  }

  /** The one open-ended published ruleset (Invariant 18): live, or a scheduled one. Locked. */
  async lockOpenEnded(tx: Tx): Promise<RulesetRecord | null> {
    const [row] = await tx<RecordRow[]>`
      SELECT ${tx.unsafe(RECORD_COLUMNS)}
      FROM pricing_rulesets r LEFT JOIN pricing_rulesets b ON b.id = r.based_on_id
      WHERE r.published_at IS NOT NULL AND r.effective_to IS NULL
      FOR UPDATE OF r`;
    return row ? toRecord(row) : null;
  }

  /** The published ruleset a scheduled one will close (its effective_to is that start). Locked. */
  async lockClosedAt(tx: Tx, at: Date): Promise<RulesetRecord | null> {
    const [row] = await tx<RecordRow[]>`
      SELECT ${tx.unsafe(RECORD_COLUMNS)}
      FROM pricing_rulesets r LEFT JOIN pricing_rulesets b ON b.id = r.based_on_id
      WHERE r.published_at IS NOT NULL AND r.effective_to = ${at}
      FOR UPDATE OF r`;
    return row ? toRecord(row) : null;
  }

  async openDraftCount(db: Db): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pricing_rulesets
      WHERE published_at IS NULL AND discarded_at IS NULL`;
    return row?.n ?? 0;
  }

  /** Versions already used on one day: '2026.11.01', '2026.11.01.2' … */
  async versionsOn(tx: Tx, base: string): Promise<string[]> {
    const rows = await tx<{ version: string }[]>`
      SELECT version FROM pricing_rulesets
      WHERE version = ${base} OR version LIKE ${`${base}.%`}`;
    return rows.map((r) => r.version);
  }

  // ── Draft creation ────────────────────────────────────────────────────────

  /** A new unpublished row copying the source's settings, with the draft window. */
  async insertDraft(
    tx: Tx,
    d: {
      readonly id: string;
      readonly label: string | null;
      readonly fromId: string;
      readonly createdBy: string;
      readonly at: Date;
    },
  ): Promise<void> {
    await tx`
      INSERT INTO pricing_rulesets (id, version, label, effective_from, effective_to,
        prices_include_gst, gst_rate_bps, sac_code, created_at, updated_at, created_by, based_on_id)
      SELECT ${d.id}, ${draftVersion(d.id)}, ${d.label},
             ${tx.unsafe(DRAFT_EFFECTIVE_FROM_SQL)}, ${tx.unsafe(DRAFT_EFFECTIVE_TO_SQL)},
             prices_include_gst, gst_rate_bps, sac_code, ${d.at}, ${d.at}, ${d.createdBy}, id
      FROM pricing_rulesets WHERE id = ${d.fromId}`;
  }

  /**
   * Copies every child row of `fromId` to `toId`. The column lists come from the catalogue, so a
   * column added to a child table later is copied too — a draft is always a complete copy.
   */
  async copyChildren(tx: Tx, fromId: string, toId: string): Promise<void> {
    const columns = await tx<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ${tx([...RULESET_CHILD_TABLES])}
        AND column_name NOT IN ${tx(NOT_COPIED)}
        AND is_generated = 'NEVER' AND is_identity = 'NO'
      ORDER BY table_name, ordinal_position`;
    for (const table of RULESET_CHILD_TABLES) {
      const cols = columns
        .filter((c) => c.table_name === table)
        .map((c) => quoteIdent(c.column_name));
      if (cols.length === 0) throw new Error(`copyChildren: no columns found for ${table}`);
      const list = tx.unsafe(cols.join(', '));
      const name = tx.unsafe(quoteIdent(table));
      await tx`
        INSERT INTO ${name} (ruleset_id, ${list})
        SELECT ${toId}, ${list} FROM ${name} WHERE ruleset_id = ${fromId}`;
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async touch(tx: Tx, id: string): Promise<void> {
    await tx`UPDATE pricing_rulesets SET updated_at = now() WHERE id = ${id}`;
  }

  async discard(tx: Tx, id: string, by: string, at: Date): Promise<void> {
    await tx`
      UPDATE pricing_rulesets SET discarded_at = ${at}, discarded_by = ${by}
      WHERE id = ${id} AND published_at IS NULL AND discarded_at IS NULL`;
  }

  /** Closes a published ruleset at `at` (it stays effective until then). */
  async closeAt(tx: Tx, id: string, at: Date): Promise<void> {
    await tx`UPDATE pricing_rulesets SET effective_to = ${at} WHERE id = ${id}`;
  }

  async reopen(tx: Tx, id: string): Promise<void> {
    await tx`UPDATE pricing_rulesets SET effective_to = NULL WHERE id = ${id}`;
  }

  async publish(
    tx: Tx,
    id: string,
    p: {
      readonly version: string;
      readonly effectiveFrom: Date;
      readonly publishedAt: Date;
      readonly publishedBy: string;
    },
  ): Promise<void> {
    await tx`
      UPDATE pricing_rulesets
      SET version = ${p.version}, effective_from = ${p.effectiveFrom}, effective_to = NULL,
          published_at = ${p.publishedAt}, published_by = ${p.publishedBy}
      WHERE id = ${id} AND published_at IS NULL AND discarded_at IS NULL`;
  }

  /** A scheduled ruleset that never took effect goes back to being a draft. */
  async unpublish(tx: Tx, id: string): Promise<void> {
    await tx`
      UPDATE pricing_rulesets
      SET version = ${draftVersion(id)}, published_at = NULL, published_by = NULL,
          effective_from = ${tx.unsafe(DRAFT_EFFECTIVE_FROM_SQL)},
          effective_to = ${tx.unsafe(DRAFT_EFFECTIVE_TO_SQL)}
      WHERE id = ${id}`;
  }

  // ── Row edits (callers hold the draft's row lock) ─────────────────────────

  async baseRate(tx: Tx, rulesetId: string, rowId: string): Promise<BaseRateFacts | null> {
    const [r] = await tx<
      {
        id: string;
        tier: PlanTier;
        city_tier: CityTier;
        rate: string;
        payout_share_bps: number;
        is_quote_only: boolean;
      }[]
    >`
      SELECT id, tier, city_tier, rate_per_hour_paise::text AS rate, payout_share_bps, is_quote_only
      FROM base_rates WHERE id = ${rowId} AND ruleset_id = ${rulesetId} FOR UPDATE`;
    return r
      ? {
          id: r.id,
          tier: r.tier,
          cityTier: r.city_tier,
          ratePerHourPaise: paise(r.rate),
          payoutShareBps: r.payout_share_bps,
          isQuoteOnly: r.is_quote_only,
        }
      : null;
  }

  async setBaseRate(
    tx: Tx,
    rulesetId: string,
    rowId: string,
    ratePaise: number,
    shareBps: number,
  ): Promise<void> {
    await tx`
      UPDATE base_rates SET rate_per_hour_paise = ${ratePaise}, payout_share_bps = ${shareBps}
      WHERE id = ${rowId} AND ruleset_id = ${rulesetId} AND ${draftOnly(tx, rulesetId)}`;
  }

  async extensionByKey(
    tx: Tx,
    rulesetId: string,
    tier: PlanTier,
    cityTier: CityTier,
  ): Promise<ExtensionFacts | null> {
    const [r] = await tx<{ id: string; hourly: string; waiting: string }[]>`
      SELECT id, hourly_paise::text AS hourly, waiting_hourly_paise::text AS waiting
      FROM extension_rates
      WHERE ruleset_id = ${rulesetId} AND tier = ${tier} AND city_tier = ${cityTier} FOR UPDATE`;
    return r
      ? { id: r.id, hourlyPaise: paise(r.hourly), waitingHourlyPaise: paise(r.waiting) }
      : null;
  }

  async extension(tx: Tx, rulesetId: string, rowId: string): Promise<ExtensionFacts | null> {
    const [r] = await tx<{ id: string; hourly: string; waiting: string }[]>`
      SELECT id, hourly_paise::text AS hourly, waiting_hourly_paise::text AS waiting
      FROM extension_rates WHERE id = ${rowId} AND ruleset_id = ${rulesetId} FOR UPDATE`;
    return r
      ? { id: r.id, hourlyPaise: paise(r.hourly), waitingHourlyPaise: paise(r.waiting) }
      : null;
  }

  async setExtension(
    tx: Tx,
    rulesetId: string,
    rowId: string,
    hourly: number,
    waiting: number,
  ): Promise<void> {
    await tx`
      UPDATE extension_rates SET hourly_paise = ${hourly}, waiting_hourly_paise = ${waiting}
      WHERE id = ${rowId} AND ruleset_id = ${rulesetId} AND ${draftOnly(tx, rulesetId)}`;
  }

  async uplift(
    tx: Tx,
    rulesetId: string,
    rowId: string,
  ): Promise<{ readonly categoryCode: string; readonly multiplierBps: number } | null> {
    const [r] = await tx<{ code: string; multiplier_bps: number }[]>`
      SELECT c.code, u.multiplier_bps FROM category_uplifts u JOIN categories c ON c.id = u.category_id
      WHERE u.id = ${rowId} AND u.ruleset_id = ${rulesetId} FOR UPDATE OF u`;
    return r ? { categoryCode: r.code, multiplierBps: r.multiplier_bps } : null;
  }

  async setUplift(tx: Tx, rulesetId: string, rowId: string, bps: number): Promise<void> {
    await tx`UPDATE category_uplifts SET multiplier_bps = ${bps} WHERE id = ${rowId} AND ruleset_id = ${rulesetId} AND ${draftOnly(tx, rulesetId)}`;
  }

  async addonPrice(
    tx: Tx,
    rulesetId: string,
    rowId: string,
  ): Promise<{ readonly addonCode: string; readonly amountPaise: number } | null> {
    const [r] = await tx<{ code: string; amount: string }[]>`
      SELECT a.code, p.amount_paise::text AS amount FROM addon_prices p JOIN addons a ON a.id = p.addon_id
      WHERE p.id = ${rowId} AND p.ruleset_id = ${rulesetId} FOR UPDATE OF p`;
    return r ? { addonCode: r.code, amountPaise: paise(r.amount) } : null;
  }

  async setAddonPrice(tx: Tx, rulesetId: string, rowId: string, amount: number): Promise<void> {
    await tx`UPDATE addon_prices SET amount_paise = ${amount} WHERE id = ${rowId} AND ruleset_id = ${rulesetId} AND ${draftOnly(tx, rulesetId)}`;
  }

  async festival(tx: Tx, rulesetId: string, rowId: string): Promise<FestivalFacts | null> {
    const [r] = await tx<
      {
        id: string;
        label: string;
        date_from: string;
        date_to: string;
        city_id: string | null;
        multiplier_bps: number;
        is_peak_season: boolean;
      }[]
    >`
      SELECT id, label, date_from::text, date_to::text, city_id, multiplier_bps, is_peak_season
      FROM festival_calendar WHERE id = ${rowId} AND ruleset_id = ${rulesetId} FOR UPDATE`;
    return r
      ? {
          id: r.id,
          label: r.label,
          dateFrom: r.date_from,
          dateTo: r.date_to,
          cityId: r.city_id,
          multiplierBps: r.multiplier_bps,
          isPeakSeason: r.is_peak_season,
        }
      : null;
  }

  async insertFestival(tx: Tx, rulesetId: string, f: PricingFestivalFields): Promise<string> {
    const [r] = await tx<{ id: string }[]>`
      INSERT INTO festival_calendar (ruleset_id, label, date_from, date_to, city_id, multiplier_bps, is_peak_season)
      SELECT ${rulesetId}, ${f.label}, ${f.dateFrom}, ${f.dateTo}, ${f.cityId}, ${f.multiplierBps}, ${f.isPeakSeason}
      WHERE ${draftOnly(tx, rulesetId)}
      RETURNING id`;
    if (!r) throw new Error('insertFestival: the ruleset is not an open draft');
    return r.id;
  }

  async updateFestival(
    tx: Tx,
    rulesetId: string,
    rowId: string,
    f: PricingFestivalFields,
  ): Promise<void> {
    await tx`
      UPDATE festival_calendar
      SET label = ${f.label}, date_from = ${f.dateFrom}, date_to = ${f.dateTo}, city_id = ${f.cityId},
          multiplier_bps = ${f.multiplierBps}, is_peak_season = ${f.isPeakSeason}
      WHERE id = ${rowId} AND ruleset_id = ${rulesetId} AND ${draftOnly(tx, rulesetId)}`;
  }

  /** A row of a DRAFT only (callers check); a ruleset itself is never deleted. */
  async removeFestival(tx: Tx, rulesetId: string, rowId: string): Promise<void> {
    await tx`DELETE FROM festival_calendar WHERE id = ${rowId} AND ruleset_id = ${rulesetId} AND ${draftOnly(tx, rulesetId)}`;
  }

  // ── The whole rate card ───────────────────────────────────────────────────

  /** Every child row, money as paise numbers. Festival city names are filled by the caller. */
  async content(db: Db, id: string): Promise<RulesetContent | null> {
    const [settings] = await db<
      { prices_include_gst: boolean; gst_rate_bps: number; sac_code: string }[]
    >`SELECT prices_include_gst, gst_rate_bps, sac_code FROM pricing_rulesets WHERE id = ${id}`;
    if (!settings) return null;
    const [rates, uplifts, addons, extensions, festivals, emergency, times, slabs, deliverables] =
      await Promise.all([
        this.rates(db, id),
        this.uplifts(db, id),
        this.addons(db, id),
        this.extensions(db, id),
        this.festivals(db, id),
        this.emergency(db, id),
        this.times(db, id),
        this.slabs(db, id),
        this.deliverables(db, id),
      ]);
    return {
      settings: {
        pricesIncludeGst: settings.prices_include_gst,
        gstRateBps: settings.gst_rate_bps,
        sacCode: settings.sac_code,
      },
      baseRates: rates,
      categoryUplifts: uplifts,
      addonPrices: addons,
      extensionRates: extensions,
      festivals,
      emergency,
      timeMultipliers: times,
      travelSlabs: slabs,
      deliverables,
    };
  }

  private async rates(db: Db, id: string): Promise<RulesetContent['baseRates']> {
    const rows = await db<
      {
        id: string;
        tier: PlanTier;
        city_tier: CityTier;
        rate: string;
        payout_share_bps: number;
        is_quote_only: boolean;
      }[]
    >`
      SELECT id, tier, city_tier, rate_per_hour_paise::text AS rate, payout_share_bps, is_quote_only
      FROM base_rates WHERE ruleset_id = ${id} ORDER BY tier, city_tier`;
    return rows.map((r) => ({
      id: r.id,
      tier: r.tier,
      cityTier: r.city_tier,
      ratePerHourPaise: paise(r.rate),
      payoutShareBps: r.payout_share_bps,
      isQuoteOnly: r.is_quote_only,
    }));
  }

  private async uplifts(db: Db, id: string): Promise<RulesetContent['categoryUplifts']> {
    const rows = await db<
      { id: string; code: string; name: string; tier: PlanTier | null; multiplier_bps: number }[]
    >`
      SELECT u.id, c.code, c.name, u.tier, u.multiplier_bps
      FROM category_uplifts u JOIN categories c ON c.id = u.category_id
      WHERE u.ruleset_id = ${id} ORDER BY c.sort_order, c.code, u.tier NULLS FIRST`;
    return rows.map((r) => ({
      id: r.id,
      categoryCode: r.code,
      categoryName: r.name,
      tier: r.tier,
      multiplierBps: r.multiplier_bps,
    }));
  }

  private async addons(db: Db, id: string): Promise<RulesetContent['addonPrices']> {
    const rows = await db<
      {
        id: string;
        code: string;
        name: string;
        tier: PlanTier | null;
        city_tier: CityTier | null;
        amount: string;
        is_per_hour: boolean;
        payout_share_bps: number;
      }[]
    >`
      SELECT p.id, a.code, a.name, p.tier, p.city_tier, p.amount_paise::text AS amount,
             p.is_per_hour, p.payout_share_bps
      FROM addon_prices p JOIN addons a ON a.id = p.addon_id
      WHERE p.ruleset_id = ${id}
      ORDER BY a.sort_order, a.code, p.tier NULLS FIRST, p.city_tier NULLS FIRST`;
    return rows.map((r) => ({
      id: r.id,
      addonCode: r.code,
      addonName: r.name,
      tier: r.tier,
      cityTier: r.city_tier,
      amountPaise: paise(r.amount),
      isPerHour: r.is_per_hour,
      payoutShareBps: r.payout_share_bps,
    }));
  }

  private async extensions(db: Db, id: string): Promise<RulesetContent['extensionRates']> {
    const rows = await db<
      {
        id: string;
        tier: PlanTier;
        city_tier: CityTier;
        hourly: string;
        waiting: string;
        waiting_grace_minutes: number;
      }[]
    >`
      SELECT id, tier, city_tier, hourly_paise::text AS hourly,
             waiting_hourly_paise::text AS waiting, waiting_grace_minutes
      FROM extension_rates WHERE ruleset_id = ${id} ORDER BY tier, city_tier`;
    return rows.map((r) => ({
      id: r.id,
      tier: r.tier,
      cityTier: r.city_tier,
      hourlyPaise: paise(r.hourly),
      waitingHourlyPaise: paise(r.waiting),
      waitingGraceMinutes: r.waiting_grace_minutes,
    }));
  }

  private async festivals(db: Db, id: string): Promise<RulesetContent['festivals']> {
    const rows = await db<
      {
        id: string;
        label: string;
        date_from: string;
        date_to: string;
        city_id: string | null;
        multiplier_bps: number;
        is_peak_season: boolean;
      }[]
    >`
      SELECT id, label, date_from::text, date_to::text, city_id, multiplier_bps, is_peak_season
      FROM festival_calendar WHERE ruleset_id = ${id}
      ORDER BY date_from, date_to, label, city_id NULLS FIRST`;
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      dateFrom: r.date_from,
      dateTo: r.date_to,
      cityId: r.city_id,
      cityName: null,
      multiplierBps: r.multiplier_bps,
      isPeakSeason: r.is_peak_season,
    }));
  }

  private async emergency(db: Db, id: string): Promise<RulesetContent['emergency']> {
    const rows = await db<
      {
        band: EmergencyBand;
        multiplier_bps: number;
        capture_on_accept_only: boolean;
        is_guaranteed: boolean;
        auto_refund_minutes_before: number | null;
      }[]
    >`
      SELECT band, multiplier_bps, capture_on_accept_only, is_guaranteed, auto_refund_minutes_before
      FROM emergency_multipliers WHERE ruleset_id = ${id} ORDER BY band`;
    return rows.map((r) => ({
      band: r.band,
      multiplierBps: r.multiplier_bps,
      captureOnAcceptOnly: r.capture_on_accept_only,
      isGuaranteed: r.is_guaranteed,
      autoRefundMinutesBefore: r.auto_refund_minutes_before,
    }));
  }

  private async times(db: Db, id: string): Promise<RulesetContent['timeMultipliers']> {
    const rows = await db<
      {
        kind: string;
        multiplier_bps: number;
        window_start: string | null;
        window_end: string | null;
        iso_dow: number[] | null;
      }[]
    >`
      SELECT kind, multiplier_bps, window_start::text, window_end::text, iso_dow
      FROM time_multipliers WHERE ruleset_id = ${id} ORDER BY kind`;
    return rows
      .filter((r) => r.kind === 'NIGHT' || r.kind === 'WEEKEND')
      .map((r) => ({
        kind: r.kind as 'NIGHT' | 'WEEKEND',
        multiplierBps: r.multiplier_bps,
        windowStart: hhmm(r.window_start),
        windowEnd: hhmm(r.window_end),
        isoDays: r.iso_dow,
      }));
  }

  private async slabs(db: Db, id: string): Promise<RulesetContent['travelSlabs']> {
    const rows = await db<
      {
        city_tier: CityTier;
        zone: number;
        from_km: string;
        to_km: string | null;
        flat: string;
        per_km: string;
        overnight: string;
      }[]
    >`
      SELECT city_tier, zone, from_km::text, to_km::text, flat_paise::text AS flat,
             per_km_paise::text AS per_km, overnight_paise::text AS overnight
      FROM travel_slabs WHERE ruleset_id = ${id} ORDER BY city_tier, zone`;
    return rows.map((r) => ({
      cityTier: r.city_tier,
      zone: r.zone,
      fromKm: Number(r.from_km),
      toKm: r.to_km === null ? null : Number(r.to_km),
      flatPaise: paise(r.flat),
      perKmPaise: paise(r.per_km),
      overnightPaise: paise(r.overnight),
    }));
  }

  private async deliverables(db: Db, id: string): Promise<RulesetContent['deliverables']> {
    const rows = await db<
      {
        tier: PlanTier;
        frames_per_hour: number;
        gear_class: string;
        dual_card_required: boolean;
        second_shooter_included: boolean;
        raw_included: boolean;
        jpeg_included: boolean;
        video_included: boolean;
        edit_included: boolean;
        delivery_hours: number;
        min_hours: string;
        is_instant_bookable: boolean;
      }[]
    >`
      SELECT tier, frames_per_hour, gear_class, dual_card_required, second_shooter_included,
             raw_included, jpeg_included, video_included, edit_included, delivery_hours,
             min_hours::text, is_instant_bookable
      FROM plan_deliverables WHERE ruleset_id = ${id} ORDER BY tier`;
    return rows.map((r) => ({
      tier: r.tier,
      framesPerHour: r.frames_per_hour,
      gearClass: r.gear_class,
      dualCardRequired: r.dual_card_required,
      secondShooterIncluded: r.second_shooter_included,
      rawIncluded: r.raw_included,
      jpegIncluded: r.jpeg_included,
      videoIncluded: r.video_included,
      editIncluded: r.edit_included,
      deliveryHours: r.delivery_hours,
      minHours: Number(r.min_hours),
      isInstantBookable: r.is_instant_bookable,
    }));
  }
}
