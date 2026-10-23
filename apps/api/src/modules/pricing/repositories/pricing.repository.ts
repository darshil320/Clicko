import type { CityTier, EmergencyBand, PlanTier } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';
import type { PromoInput, Ruleset } from '../engine/types';

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const kmToMetres = (km: string | null): number | null =>
  km === null ? null : Math.round(Number(km) * 1000);
const halfHours = (hours: string): number => Math.round(Number(hours) * 2);
const isoDate = (d: Date | string): string =>
  typeof d === 'string' ? d : d.toISOString().slice(0, 10);

export type PromoRecord = Omit<
  PromoInput,
  'userRedemptions' | 'userBookingCount' | 'totalRedemptions'
>;

/** Loads a published ruleset into the engine's in-memory model. Read-only. */
@Injectable()
export class PricingRepository {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  /** For NEW quotes: the effective ruleset, restricted to categories/add-ons currently on sale. */
  async loadCurrent(now: Date): Promise<Ruleset | null> {
    const [row] = await this.sql<{ id: string }[]>`
      SELECT id FROM pricing_rulesets
      WHERE published_at IS NOT NULL AND effective_from <= ${now}
        AND (effective_to IS NULL OR effective_to > ${now})
      ORDER BY effective_from DESC LIMIT 1`;
    return row ? this.loadById(row.id, { activeCatalogueOnly: true }) : null;
  }

  /**
   * A ruleset exactly as published. Re-pricing an existing booking (extensions) must use this
   * WITHOUT the catalogue filter: deactivating a category later must not break bookings priced
   * under it (Invariant 17).
   */
  async loadById(
    id: string,
    opts: { activeCatalogueOnly?: boolean } = {},
  ): Promise<Ruleset | null> {
    const active = opts.activeCatalogueOnly === true;
    const sql = this.sql;
    const [rs] = await sql<
      {
        id: string;
        version: string;
        prices_include_gst: boolean;
        gst_rate_bps: number;
        sac_code: string;
      }[]
    >`SELECT id, version, prices_include_gst, gst_rate_bps, sac_code FROM pricing_rulesets WHERE id = ${id}`;
    if (!rs) return null;

    const [
      rates,
      uplifts,
      emergency,
      times,
      festivals,
      slabs,
      addons,
      addonPrices,
      extensions,
      deliverables,
    ] = await Promise.all([
      sql<
        {
          tier: PlanTier;
          city_tier: CityTier;
          rate_per_hour_paise: string;
          payout_share_bps: number;
          is_quote_only: boolean;
        }[]
      >`
          SELECT tier, city_tier, rate_per_hour_paise, payout_share_bps, is_quote_only FROM base_rates WHERE ruleset_id = ${id}`,
      sql<{ code: string; tier: PlanTier | null; multiplier_bps: number }[]>`
          SELECT c.code, u.tier, u.multiplier_bps FROM category_uplifts u JOIN categories c ON c.id = u.category_id
          WHERE u.ruleset_id = ${id} AND (c.is_active OR NOT ${active})`,
      sql<
        {
          band: EmergencyBand;
          multiplier_bps: number;
          capture_on_accept_only: boolean;
          is_guaranteed: boolean;
          auto_refund_minutes_before: number | null;
        }[]
      >`
          SELECT band, multiplier_bps, capture_on_accept_only, is_guaranteed, auto_refund_minutes_before
          FROM emergency_multipliers WHERE ruleset_id = ${id}`,
      sql<
        {
          kind: string;
          window_start: string | null;
          window_end: string | null;
          iso_dow: number[] | null;
          multiplier_bps: number;
        }[]
      >`
          SELECT kind, window_start::text, window_end::text, iso_dow, multiplier_bps FROM time_multipliers WHERE ruleset_id = ${id}`,
      sql<
        {
          label: string;
          date_from: string;
          date_to: string;
          city_id: string | null;
          multiplier_bps: number;
          is_peak_season: boolean;
        }[]
      >`
          SELECT label, date_from::text, date_to::text, city_id, multiplier_bps, is_peak_season
          FROM festival_calendar WHERE ruleset_id = ${id}`,
      sql<
        {
          city_tier: CityTier;
          zone: number;
          from_km: string;
          to_km: string | null;
          flat_paise: string;
          per_km_paise: string;
          overnight_paise: string;
        }[]
      >`
          SELECT city_tier, zone, from_km, to_km, flat_paise, per_km_paise, overnight_paise FROM travel_slabs WHERE ruleset_id = ${id}`,
      sql<
        {
          code: string;
          name: string;
          min_tier: PlanTier | null;
          requires_airspace_check: boolean;
        }[]
      >`
          SELECT code, name, min_tier, requires_airspace_check FROM addons WHERE is_active OR NOT ${active}`,
      sql<
        {
          code: string;
          tier: PlanTier | null;
          city_tier: CityTier | null;
          amount_paise: string;
          is_per_hour: boolean;
          payout_share_bps: number;
        }[]
      >`
          SELECT a.code, p.tier, p.city_tier, p.amount_paise, p.is_per_hour, p.payout_share_bps
          FROM addon_prices p JOIN addons a ON a.id = p.addon_id WHERE p.ruleset_id = ${id}`,
      sql<
        {
          tier: PlanTier;
          city_tier: CityTier;
          hourly_paise: string;
          waiting_grace_minutes: number;
          waiting_hourly_paise: string;
        }[]
      >`
          SELECT tier, city_tier, hourly_paise, waiting_grace_minutes, waiting_hourly_paise FROM extension_rates WHERE ruleset_id = ${id}`,
      sql<{ tier: PlanTier; min_hours: string; is_instant_bookable: boolean }[]>`
          SELECT tier, min_hours, is_instant_bookable FROM plan_deliverables WHERE ruleset_id = ${id}`,
    ]);

    const night = times.find((t) => t.kind === 'NIGHT');
    const weekend = times.find((t) => t.kind === 'WEEKEND');
    return {
      id: rs.id,
      version: rs.version,
      pricesIncludeGst: rs.prices_include_gst,
      gstRateBps: rs.gst_rate_bps,
      sacCode: rs.sac_code,
      baseRates: rates.map((r) => ({
        tier: r.tier,
        cityTier: r.city_tier,
        ratePerHourPaise: BigInt(r.rate_per_hour_paise),
        payoutShareBps: r.payout_share_bps,
        isQuoteOnly: r.is_quote_only,
      })),
      categoryUplifts: uplifts.map((u) => ({
        categoryCode: u.code,
        tier: u.tier,
        multiplierBps: u.multiplier_bps,
      })),
      emergency: emergency.map((e) => ({
        band: e.band,
        multiplierBps: e.multiplier_bps,
        captureOnAcceptOnly: e.capture_on_accept_only,
        isGuaranteed: e.is_guaranteed,
        autoRefundMinutesBefore: e.auto_refund_minutes_before,
      })),
      night:
        night?.window_start && night.window_end
          ? {
              windowStartMinute: toMinutes(night.window_start),
              windowEndMinute: toMinutes(night.window_end),
              multiplierBps: night.multiplier_bps,
            }
          : null,
      weekend: weekend?.iso_dow
        ? { isoDays: weekend.iso_dow, multiplierBps: weekend.multiplier_bps }
        : null,
      festivals: festivals.map((f) => ({
        label: f.label,
        dateFrom: isoDate(f.date_from),
        dateTo: isoDate(f.date_to),
        cityId: f.city_id,
        multiplierBps: f.multiplier_bps,
        isPeakSeason: f.is_peak_season,
      })),
      travelSlabs: slabs.map((s) => ({
        cityTier: s.city_tier,
        zone: s.zone as 0 | 1 | 2,
        fromMetres: kmToMetres(s.from_km) ?? 0,
        toMetres: kmToMetres(s.to_km),
        flatPaise: BigInt(s.flat_paise),
        perKmPaise: BigInt(s.per_km_paise),
        overnightPaise: BigInt(s.overnight_paise),
      })),
      addons: addons.map((a) => ({
        code: a.code,
        label: a.name,
        minTier: a.min_tier,
        requiresAirspaceCheck: a.requires_airspace_check,
      })),
      addonPrices: addonPrices.map((p) => ({
        addonCode: p.code,
        tier: p.tier,
        cityTier: p.city_tier,
        amountPaise: BigInt(p.amount_paise),
        isPerHour: p.is_per_hour,
        payoutShareBps: p.payout_share_bps,
      })),
      extensionRates: extensions.map((x) => ({
        tier: x.tier,
        cityTier: x.city_tier,
        hourlyPaise: BigInt(x.hourly_paise),
        waitingGraceMinutes: x.waiting_grace_minutes,
        waitingHourlyPaise: BigInt(x.waiting_hourly_paise),
      })),
      deliverables: deliverables.map((d) => ({
        tier: d.tier,
        minHalfHours: halfHours(d.min_hours),
        isInstantBookable: d.is_instant_bookable,
      })),
    };
  }

  async findPromo(code: string): Promise<PromoRecord | null> {
    const [p] = await this.sql<
      {
        code: string;
        discount_bps: number | null;
        discount_flat_paise: string | null;
        max_discount_paise: string | null;
        min_booking_paise: string;
        applies_to_tiers: PlanTier[] | null;
        applies_to_cities: string[] | null;
        first_booking_only: boolean;
        per_user_cap: number;
        total_redemption_cap: number | null;
        valid_from: Date;
        valid_to: Date;
        is_active: boolean;
      }[]
    >`
      SELECT code, discount_bps, discount_flat_paise, max_discount_paise, min_booking_paise, applies_to_tiers,
             applies_to_cities, first_booking_only, per_user_cap, total_redemption_cap, valid_from, valid_to, is_active
      FROM promo_codes WHERE upper(code) = upper(${code})`;
    if (!p) return null;
    return {
      code: p.code,
      discountBps: p.discount_bps,
      discountFlatPaise: p.discount_flat_paise === null ? null : BigInt(p.discount_flat_paise),
      maxDiscountPaise: p.max_discount_paise === null ? null : BigInt(p.max_discount_paise),
      minBookingPaise: BigInt(p.min_booking_paise),
      appliesToTiers: p.applies_to_tiers,
      appliesToCityIds: p.applies_to_cities,
      firstBookingOnly: p.first_booking_only,
      perUserCap: p.per_user_cap,
      totalRedemptionCap: p.total_redemption_cap,
      validFrom: p.valid_from,
      validTo: p.valid_to,
      isActive: p.is_active,
    };
  }
}
