import { PlanTier } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import { availabilityNeeds } from '../ist-window';
import type {
  AcceptAvailability,
  Db,
  NewPenalty,
  PhotographerIdentity,
  PoolCriteria,
  PoolMember,
} from '../photographers.types';

const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

interface PoolRow {
  id: string;
  full_name: string;
  service_radius_km: number;
  base_location: string;
  has_metrics: boolean;
  rating_avg_bps: number | null;
  rating_count: number | null;
  acceptance_rate_bps: number | null;
  on_time_upload_rate_bps: number | null;
  no_show_count: number | null;
}

const toMember = (r: PoolRow): PoolMember => ({
  id: r.id,
  fullName: r.full_name,
  serviceRadiusKm: r.service_radius_km,
  baseLocation: r.base_location,
  metrics: r.has_metrics
    ? {
        ratingAvgBps: r.rating_avg_bps,
        ratingCount: r.rating_count ?? 0,
        acceptanceRateBps: r.acceptance_rate_bps,
        onTimeUploadRateBps: r.on_time_upload_rate_bps,
        noShowCount: r.no_show_count ?? 0,
      }
    : null,
});

const tierRank = (t: PlanTier): number => PlanTier.options.indexOf(t);

/** True when the category requires certification at (or below) the booking's tier. */
export function certificationRequired(tier: PlanTier, from: PlanTier | null): boolean {
  return from !== null && tierRank(tier) >= tierRank(from);
}

/**
 * Read side of the photographer tables (photographers, photographer_categories,
 * photographer_documents, photographer_availability, photographer_blocks, photographer_metrics).
 * No spatial predicates here: distance lives in dispatch/repositories (apps/api/CLAUDE.md).
 */
@Injectable()
export class PhotographersRepository {
  async dispatchPool(db: Db, c: PoolCriteria): Promise<PoolMember[]> {
    const needs = availabilityNeeds(c.shootStart, c.shootEnd);
    const shootDate = IST_DATE.format(c.shootEnd);
    const certRequired = certificationRequired(c.tier, c.certRequiredFrom);
    const droneDoc = (kind: string) => db`EXISTS (
      SELECT 1 FROM photographer_documents d
      WHERE d.photographer_id = p.id AND d.kind = ${kind} AND d.review_status = 'APPROVED'
        AND d.purged_at IS NULL AND (d.expires_on IS NULL OR d.expires_on >= ${shootDate}::date))`;
    const rows = await db<PoolRow[]>`
      SELECT p.id, p.full_name, p.service_radius_km::float8 AS service_radius_km,
             p.base_location::text AS base_location, (m.photographer_id IS NOT NULL) AS has_metrics,
             m.rating_avg_bps, m.rating_count, m.acceptance_rate_bps, m.on_time_upload_rate_bps,
             m.no_show_count
      FROM photographers p
      LEFT JOIN photographer_metrics m ON m.photographer_id = p.id
      WHERE p.status = 'ACTIVE' AND p.city_id = ${c.cityId}
        AND p.max_tier >= ${c.tier}::plan_tier
        AND p.base_location IS NOT NULL
        AND (${!c.emergencyOnly} OR p.accepts_emergency)
        AND (${!certRequired} OR EXISTS (
          SELECT 1 FROM photographer_categories pc
          WHERE pc.photographer_id = p.id AND pc.category_id = ${c.categoryId}
            AND pc.revoked_at IS NULL AND pc.certified_tier >= ${c.tier}::plan_tier))
        AND (${!c.needsDroneCredentials} OR (${droneDoc('DRONE_RPC')} AND ${droneDoc('DRONE_UIN')}))
        AND NOT EXISTS (
          SELECT 1 FROM photographer_blocks b WHERE b.photographer_id = p.id
            AND tstzrange(b.blocked_from, b.blocked_until, '[)')
                && tstzrange(${c.blockedFrom}, ${c.blockedUntil}, '[)'))
        AND (
          NOT EXISTS (SELECT 1 FROM photographer_availability a0 WHERE a0.photographer_id = p.id)
          OR NOT EXISTS (
            SELECT 1 FROM unnest(${needs.map((n) => n.isoDow)}::smallint[],
                                 ${needs.map((n) => n.from)}::time[],
                                 ${needs.map((n) => n.to)}::time[]) AS need(dow, t_from, t_to)
            WHERE NOT EXISTS (
              SELECT 1 FROM photographer_availability a
              WHERE a.photographer_id = p.id AND a.iso_dow = need.dow
                AND a.start_time <= need.t_from AND a.end_time >= need.t_to)))
      ORDER BY p.id`;
    return rows.map(toMember);
  }

  async findActiveByPhone(db: Db, phone: string): Promise<PhotographerIdentity | null> {
    const [row] = await db<{ id: string; full_name: string; city_id: string }[]>`
      SELECT id, full_name, city_id FROM photographers
      WHERE phone_e164 = ${phone} AND status = 'ACTIVE'`;
    return row ? { id: row.id, fullName: row.full_name, cityId: row.city_id } : null;
  }

  async findActiveById(db: Db, id: string): Promise<PhotographerIdentity | null> {
    const [row] = await db<{ id: string; full_name: string; city_id: string }[]>`
      SELECT id, full_name, city_id FROM photographers WHERE id = ${id} AND status = 'ACTIVE'`;
    return row ? { id: row.id, fullName: row.full_name, cityId: row.city_id } : null;
  }

  /** ACTIVE, and no personal block overlapping the window (assignments are the EXCLUDE's job). */
  async availabilityAt(db: Db, id: string, from: Date, until: Date): Promise<AcceptAvailability> {
    const [row] = await db<{ active: boolean; blocked: boolean }[]>`
      SELECT p.status = 'ACTIVE' AS active,
             EXISTS (SELECT 1 FROM photographer_blocks b WHERE b.photographer_id = p.id
                       AND tstzrange(b.blocked_from, b.blocked_until, '[)')
                           && tstzrange(${from}, ${until}, '[)')) AS blocked
      FROM photographers p WHERE p.id = ${id}`;
    if (!row?.active) return 'INACTIVE';
    return row.blocked ? 'BLOCKED' : 'OK';
  }

  /** Earlier un-waived penalties of a kind (v0.2 §9 escalates no-shows by occurrence). */
  async penaltyCount(db: Db, id: string, kind: string): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM photographer_penalties
      WHERE photographer_id = ${id} AND kind = ${kind} AND NOT waived`;
    return row?.n ?? 0;
  }

  async insertPenalty(
    db: Db,
    p: NewPenalty & { severity: number; deactivationDays: number | null },
  ): Promise<void> {
    await db`
      INSERT INTO photographer_penalties (photographer_id, booking_id, kind, severity,
                                          deactivation_days, note, created_at)
      VALUES (${p.photographerId}, ${p.bookingId}, ${p.kind}, ${p.severity}, ${p.deactivationDays},
              ${p.note}, ${p.at})`;
  }

  async displayNames(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await db<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM photographers WHERE id IN ${db([...new Set(ids)])}`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }
}
