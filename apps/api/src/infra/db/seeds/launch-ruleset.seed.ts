import type postgres from 'postgres';
import {
  ADDON_CATALOGUE,
  CATEGORY_CATALOGUE,
  LAUNCH_EFFECTIVE_FROM,
  LAUNCH_GST_RATE_BPS,
  LAUNCH_PRICES_INCLUDE_GST,
  LAUNCH_RULESET_VERSION,
  LAUNCH_SAC_CODE,
  launchRuleset,
} from '../../../modules/pricing/engine/launch-ruleset';

const hhmm = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** What each tier promises (doc 01 Screen 2, v0.2 §10/G-13, ADR-0005: photos only at launch). */
const DELIVERABLES = [
  {
    tier: 'BASIC',
    fph: 40,
    gear: 'APS-C or full-frame, 1 lens',
    dual: false,
    second: false,
    edit: false,
  },
  {
    tier: 'SEMI_PRO',
    fph: 50,
    gear: 'Full-frame, 2 lenses',
    dual: false,
    second: false,
    edit: false,
  },
  {
    tier: 'PROFESSIONAL',
    fph: 60,
    gear: 'Full-frame with lighting',
    dual: true,
    second: false,
    edit: false,
  },
  {
    tier: 'EXPERT',
    fph: 75,
    gear: 'Flagship full-frame, 3+ lenses, lighting',
    dual: true,
    second: false,
    edit: false,
  },
  {
    tier: 'SIGNATURE',
    fph: 80,
    gear: 'Flagship kit, full lighting, on-site backup',
    dual: true,
    second: true,
    edit: true,
  },
] as const;

/**
 * Seeds catalogue (categories, addons) and publishes ruleset 2026.10.01 from the
 * same fixture the engine tests use. Idempotent: an existing ruleset is left untouched.
 */
export async function seedLaunchRuleset(sql: postgres.Sql): Promise<{ created: boolean }> {
  return sql.begin(async (tx) => {
    for (const c of CATEGORY_CATALOGUE) {
      await tx`
        INSERT INTO categories (code, name, cert_required_from, sort_order)
        VALUES (${c.code}, ${c.name}, ${c.certFrom}, ${c.sort}) ON CONFLICT (code) DO NOTHING`;
    }
    for (const [i, a] of ADDON_CATALOGUE.entries()) {
      await tx`
        INSERT INTO addons (code, name, requires_drone_credentials, requires_airspace_check, min_tier, sort_order)
        VALUES (${a.code}, ${a.label}, ${a.requiresDroneCredentials}, ${a.requiresAirspaceCheck}, ${a.minTier}, ${i})
        ON CONFLICT (code) DO NOTHING`;
    }
    const [existing] =
      await tx`SELECT id FROM pricing_rulesets WHERE version = ${LAUNCH_RULESET_VERSION}`;
    if (existing) return { created: false };

    const cities = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM cities WHERE name IN ('Surat', 'Mumbai', 'Vadodara')`;
    const cityId = (name: string) => {
      const found = cities.find((c) => c.name === name);
      if (!found) throw new Error(`seed: run the city seed first (${name} missing)`);
      return found.id;
    };
    const [rs] = await tx<{ id: string }[]>`
      INSERT INTO pricing_rulesets (version, label, effective_from, prices_include_gst, gst_rate_bps, sac_code, published_at)
      VALUES (${LAUNCH_RULESET_VERSION}, 'Launch rate card (doc 05 §5)', ${LAUNCH_EFFECTIVE_FROM},
              ${LAUNCH_PRICES_INCLUDE_GST}, ${LAUNCH_GST_RATE_BPS}, ${LAUNCH_SAC_CODE}, now())
      RETURNING id`;
    if (!rs) throw new Error('seed: ruleset insert returned nothing');
    const r = launchRuleset(rs.id, {
      surat: cityId('Surat'),
      mumbai: cityId('Mumbai'),
      vadodara: cityId('Vadodara'),
    });

    for (const b of r.baseRates) {
      await tx`INSERT INTO base_rates (ruleset_id, tier, city_tier, rate_per_hour_paise, payout_share_bps, is_quote_only)
               VALUES (${r.id}, ${b.tier}, ${b.cityTier}, ${b.ratePerHourPaise.toString()}, ${b.payoutShareBps}, ${b.isQuoteOnly})`;
    }
    for (const u of r.categoryUplifts) {
      await tx`INSERT INTO category_uplifts (ruleset_id, category_id, tier, multiplier_bps)
               SELECT ${r.id}, id, ${u.tier}, ${u.multiplierBps} FROM categories WHERE code = ${u.categoryCode}`;
    }
    for (const e of r.emergency) {
      await tx`INSERT INTO emergency_multipliers (ruleset_id, band, multiplier_bps, capture_on_accept_only, is_guaranteed, auto_refund_minutes_before)
               VALUES (${r.id}, ${e.band}, ${e.multiplierBps}, ${e.captureOnAcceptOnly}, ${e.isGuaranteed}, ${e.autoRefundMinutesBefore})`;
    }
    if (r.night) {
      await tx`INSERT INTO time_multipliers (ruleset_id, kind, window_start, window_end, multiplier_bps)
               VALUES (${r.id}, 'NIGHT', ${hhmm(r.night.windowStartMinute)}, ${hhmm(r.night.windowEndMinute)},
                       ${r.night.multiplierBps})`;
    }
    if (r.weekend) {
      await tx`INSERT INTO time_multipliers (ruleset_id, kind, iso_dow, multiplier_bps)
               VALUES (${r.id}, 'WEEKEND', ${r.weekend.isoDays}::smallint[], ${r.weekend.multiplierBps})`;
    }
    for (const f of r.festivals) {
      await tx`INSERT INTO festival_calendar (ruleset_id, label, date_from, date_to, city_id, multiplier_bps, is_peak_season)
               VALUES (${r.id}, ${f.label}, ${f.dateFrom}, ${f.dateTo}, ${f.cityId}, ${f.multiplierBps}, ${f.isPeakSeason})`;
    }
    for (const s of r.travelSlabs) {
      await tx`INSERT INTO travel_slabs (ruleset_id, city_tier, zone, from_km, to_km, flat_paise, per_km_paise, overnight_paise)
               VALUES (${r.id}, ${s.cityTier}, ${s.zone}, ${s.fromMetres / 1000}, ${s.toMetres === null ? null : s.toMetres / 1000},
                       ${s.flatPaise.toString()}, ${s.perKmPaise.toString()}, ${s.overnightPaise.toString()})`;
    }
    for (const p of r.addonPrices) {
      await tx`INSERT INTO addon_prices (ruleset_id, addon_id, tier, city_tier, amount_paise, is_per_hour, payout_share_bps)
               SELECT ${r.id}, id, ${p.tier}, ${p.cityTier}, ${p.amountPaise.toString()}, ${p.isPerHour}, ${p.payoutShareBps}
               FROM addons WHERE code = ${p.addonCode}`;
    }
    for (const x of r.extensionRates) {
      await tx`INSERT INTO extension_rates (ruleset_id, tier, city_tier, hourly_paise, waiting_grace_minutes, waiting_hourly_paise)
               VALUES (${r.id}, ${x.tier}, ${x.cityTier}, ${x.hourlyPaise.toString()}, ${x.waitingGraceMinutes}, ${x.waitingHourlyPaise.toString()})`;
    }
    for (const d of DELIVERABLES) {
      const rule = r.deliverables.find((x) => x.tier === d.tier);
      await tx`INSERT INTO plan_deliverables (ruleset_id, tier, frames_per_hour, gear_class, dual_card_required,
                 second_shooter_included, video_included, edit_included, min_hours, is_instant_bookable)
               VALUES (${r.id}, ${d.tier}, ${d.fph}, ${d.gear}, ${d.dual}, ${d.second}, false, ${d.edit},
                       ${(rule?.minHalfHours ?? 4) / 2}, ${rule?.isInstantBookable ?? true})`;
    }
    return { created: true };
  });
}
