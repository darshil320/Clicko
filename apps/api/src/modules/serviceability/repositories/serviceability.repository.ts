import type { AreaStatus, CityTier, PlanTier } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';
import type { AreaLabel, VenuePoints } from '../serviceability.types';

export type { AreaLabel, VenuePoints } from '../serviceability.types';

export interface AreaRecord {
  readonly pincode: string;
  readonly status: AreaStatus;
  readonly areaName: string | null;
  readonly travelZone: 0 | 1 | 2;
  readonly city: {
    readonly id: string;
    readonly name: string;
    readonly state: string;
    readonly tier: CityTier;
  };
}

export interface WaitlistInsert {
  readonly phone: string;
  readonly fullName: string;
  readonly pincode: string;
  readonly cityId: string | null;
  readonly cityNameRaw: string | null;
  readonly intendedDate: string | null;
  readonly intendedTier: PlanTier | null;
  /** The client's /24 or /64 (sourceNetwork), null if unknown. Never the full address. */
  readonly sourceNet: string | null;
}

export interface ServiceabilityRepository {
  findArea(pincode: string): Promise<AreaRecord | null>;
  /** Waiting entries for the city when known, otherwise for the pincode. */
  countWaiting(cityId: string | null, pincode: string): Promise<number>;
  countForPhoneSince(phone: string, since: Date): Promise<number>;
  /** Waitlist joins for a pincode since a time (abuse limit, audit Web M3). */
  countForPincodeSince(pincode: string, since: Date): Promise<number>;
  /** Waitlist joins from a source network (CIDR) since a time (abuse limit, audit Web M3). */
  countForNetworkSince(sourceNet: string, since: Date): Promise<number>;
  /**
   * Idempotent on (phone, pincode, intended date) — the waitlist_dedupe_uq index. Every entry is
   * stored unverified (phone_verified_at NULL) and is never messaged until verified (addendum 0013).
   */
  insertWaitlist(entry: WaitlistInsert): Promise<void>;
  /** Display names for city ids (other modules never read the cities table themselves). */
  cityNames(cityIds: readonly string[]): Promise<Map<string, string>>;
  /** Cities by name; `ids` null = every city (the staff panel's pickers, ADR-0025). */
  cities(ids: readonly string[] | null): Promise<CitySummary[]>;
  /** The pincode centroid and its city's centre as raw geography text (hex EWKB); null if unknown. */
  venuePoints(pincode: string): Promise<VenuePoints | null>;
  /** Area + city names for pincodes (photographer offers show the area, never the address). */
  areaLabels(pincodes: readonly string[]): Promise<Map<string, AreaLabel>>;
}

export interface CitySummary {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly status: AreaStatus;
  /** Drives the rate card (the pricing editor's calculator). */
  readonly tier: CityTier;
}

export const SERVICEABILITY_REPOSITORY = Symbol('SERVICEABILITY_REPOSITORY');

@Injectable()
export class PgServiceabilityRepository implements ServiceabilityRepository {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  async findArea(pincode: string): Promise<AreaRecord | null> {
    const [row] = await this.sql<
      {
        pincode: string;
        status: AreaStatus;
        area_name: string | null;
        travel_zone: number;
        city_id: string;
        city_name: string;
        city_tier: CityTier;
        city_state: string;
      }[]
    >`
      SELECT a.pincode, a.status, a.area_name, a.travel_zone,
             c.id AS city_id, c.name AS city_name, c.tier AS city_tier, c.state AS city_state
      FROM serviceable_areas a JOIN cities c ON c.id = a.city_id
      WHERE a.pincode = ${pincode}`;
    if (!row) return null;
    return {
      pincode: row.pincode,
      status: row.status,
      areaName: row.area_name,
      travelZone: row.travel_zone as 0 | 1 | 2,
      city: { id: row.city_id, name: row.city_name, state: row.city_state, tier: row.city_tier },
    };
  }

  async countWaiting(cityId: string | null, pincode: string): Promise<number> {
    const [row] = cityId
      ? await this.sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM waitlist_entries WHERE city_id = ${cityId} AND notified_at IS NULL`
      : await this.sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM waitlist_entries WHERE pincode = ${pincode} AND notified_at IS NULL`;
    return row?.n ?? 0;
  }

  async countForPhoneSince(phone: string, since: Date): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM waitlist_entries WHERE phone_e164 = ${phone} AND created_at >= ${since}`;
    return row?.n ?? 0;
  }

  async countForPincodeSince(pincode: string, since: Date): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM waitlist_entries WHERE pincode = ${pincode} AND created_at >= ${since}`;
    return row?.n ?? 0;
  }

  async countForNetworkSince(sourceNet: string, since: Date): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM waitlist_entries
      WHERE source_net = ${sourceNet}::cidr AND created_at >= ${since}`;
    return row?.n ?? 0;
  }

  async insertWaitlist(e: WaitlistInsert): Promise<void> {
    await this.sql`
      INSERT INTO waitlist_entries (phone_e164, full_name, pincode, city_id, city_name_raw, intended_date,
                                    intended_tier, source_net)
      VALUES (${e.phone}, ${e.fullName}, ${e.pincode}, ${e.cityId}, ${e.cityNameRaw},
              ${e.intendedDate}, ${e.intendedTier}, ${e.sourceNet}::cidr)
      ON CONFLICT (phone_e164, pincode, coalesce(intended_date, '1900-01-01')) DO NOTHING`;
  }

  async venuePoints(pincode: string): Promise<VenuePoints | null> {
    const [row] = await this.sql<{ centroid: string | null; centre: string }[]>`
      SELECT a.centroid::text AS centroid, c.centre::text AS centre
      FROM serviceable_areas a JOIN cities c ON c.id = a.city_id WHERE a.pincode = ${pincode}`;
    return row ? { centroid: row.centroid, cityCentre: row.centre } : null;
  }

  async areaLabels(pincodes: readonly string[]): Promise<Map<string, AreaLabel>> {
    if (pincodes.length === 0) return new Map();
    const rows = await this.sql<{ pincode: string; area_name: string | null; city_name: string }[]>`
      SELECT a.pincode, a.area_name, c.name AS city_name
      FROM serviceable_areas a JOIN cities c ON c.id = a.city_id
      WHERE a.pincode IN ${this.sql([...new Set(pincodes)])}`;
    return new Map(rows.map((r) => [r.pincode, { areaName: r.area_name, cityName: r.city_name }]));
  }

  async cityNames(cityIds: readonly string[]): Promise<Map<string, string>> {
    if (cityIds.length === 0) return new Map();
    const rows = await this.sql<{ id: string; name: string }[]>`
      SELECT id, name FROM cities WHERE id IN ${this.sql([...new Set(cityIds)])}`;
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async cities(ids: readonly string[] | null): Promise<CitySummary[]> {
    if (ids !== null && ids.length === 0) return [];
    return this.sql<CitySummary[]>`
      SELECT id, name, state, status, tier FROM cities
      WHERE ${ids === null ? this.sql`TRUE` : this.sql`id IN ${this.sql([...new Set(ids)])}`}
      ORDER BY name, id`;
  }
}
