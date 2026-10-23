import { Injectable } from '@nestjs/common';
import type { Db } from '../dispatch.types';

/** A photographer from the pool, with the opaque base location the photographers module returned. */
export interface PooledLocation {
  readonly id: string;
  /** Geography text (hex EWKB) as Postgres printed it. */
  readonly baseLocation: string;
  readonly serviceRadiusKm: number;
}

export interface ReachQuery {
  readonly bookingId: string;
  /** Geography text (hex EWKB): the venue, or its pincode centroid / city centre fallback. */
  readonly venue: string;
  readonly pool: readonly PooledLocation[];
  /** The wave's own limit; null = city-wide (own service radius only). */
  readonly waveRadiusKm: number | null;
  readonly blockedFrom: Date;
  readonly blockedUntil: Date;
  /** First wave number of the current run: anyone offered since then is not offered again. */
  readonly runFromWave: number;
}

export interface Reachable {
  readonly photographerId: string;
  readonly distanceKm: number;
  /** min(own service radius, wave radius) — what proximity is measured against. */
  readonly reachKm: number;
}

/**
 * THE geo query (apps/api/CLAUDE.md: PostGIS only in dispatch/repositories). Takes the pool from
 * PhotographersService and keeps those within reach of the venue (ST_DWithin on geography, metres)
 * who are not already booked in the window, not already offered in this run, and did not cancel
 * on / no-show this booking before.
 */
@Injectable()
export class EligibilityRepository {
  async reachable(db: Db, q: ReachQuery): Promise<Reachable[]> {
    if (q.pool.length === 0) return [];
    const wave = q.waveRadiusKm;
    const rows = await db<{ photographer_id: string; distance_km: number; reach_km: number }[]>`
      WITH venue AS (SELECT ${q.venue}::geography AS g),
      pool AS (
        SELECT p.id, p.loc::geography AS loc,
               least(p.radius_km, coalesce(${wave}::float8, p.radius_km)) AS reach_km
        FROM unnest(${q.pool.map((p) => p.id)}::uuid[],
                    ${q.pool.map((p) => p.baseLocation)}::text[],
                    ${q.pool.map((p) => p.serviceRadiusKm)}::float8[]) AS p(id, loc, radius_km)
      )
      SELECT pool.id AS photographer_id, ST_Distance(pool.loc, venue.g) / 1000.0 AS distance_km,
             pool.reach_km
      FROM pool CROSS JOIN venue
      WHERE ST_DWithin(pool.loc, venue.g, pool.reach_km * 1000.0)
        AND NOT EXISTS (
          SELECT 1 FROM assignments a
          WHERE a.photographer_id = pool.id AND a.status IN ('ASSIGNED', 'EN_ROUTE', 'ACTIVE', 'COMPLETED')
            AND tstzrange(a.blocked_from, a.blocked_until, '[)')
                && tstzrange(${q.blockedFrom}, ${q.blockedUntil}, '[)'))
        AND NOT EXISTS (
          SELECT 1 FROM dispatch_attempts da JOIN dispatch_rounds dr ON dr.id = da.round_id
          WHERE da.booking_id = ${q.bookingId} AND da.photographer_id = pool.id
            AND dr.wave >= ${q.runFromWave})
        AND NOT EXISTS (
          SELECT 1 FROM assignments x
          WHERE x.booking_id = ${q.bookingId} AND x.photographer_id = pool.id
            AND x.status IN ('RELEASED', 'ABANDONED'))
      ORDER BY distance_km, pool.id`;
    return rows.map((r) => ({
      photographerId: r.photographer_id,
      distanceKm: r.distance_km,
      reachKm: r.reach_km,
    }));
  }
}
