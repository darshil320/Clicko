import type { AreaStatus, CityTier, PlanTier } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';

export interface AreaRecord {
  readonly pincode: string;
  readonly status: AreaStatus;
  readonly areaName: string | null;
  readonly travelZone: 0 | 1 | 2;
  readonly city: { readonly id: string; readonly name: string; readonly tier: CityTier };
}

export interface WaitlistInsert {
  readonly phone: string;
  readonly fullName: string;
  readonly pincode: string;
  readonly cityId: string | null;
  readonly cityNameRaw: string | null;
  readonly intendedDate: string | null;
  readonly intendedTier: PlanTier | null;
}

export interface ServiceabilityRepository {
  findArea(pincode: string): Promise<AreaRecord | null>;
  /** Waiting entries for the city when known, otherwise for the pincode. */
  countWaiting(cityId: string | null, pincode: string): Promise<number>;
  countForPhoneSince(phone: string, since: Date): Promise<number>;
  /** Idempotent on (phone, pincode, intended date) — the waitlist_dedupe_uq index. */
  insertWaitlist(entry: WaitlistInsert): Promise<void>;
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
      }[]
    >`
      SELECT a.pincode, a.status, a.area_name, a.travel_zone,
             c.id AS city_id, c.name AS city_name, c.tier AS city_tier
      FROM serviceable_areas a JOIN cities c ON c.id = a.city_id
      WHERE a.pincode = ${pincode}`;
    if (!row) return null;
    return {
      pincode: row.pincode,
      status: row.status,
      areaName: row.area_name,
      travelZone: row.travel_zone as 0 | 1 | 2,
      city: { id: row.city_id, name: row.city_name, tier: row.city_tier },
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

  async insertWaitlist(e: WaitlistInsert): Promise<void> {
    await this.sql`
      INSERT INTO waitlist_entries (phone_e164, full_name, pincode, city_id, city_name_raw, intended_date, intended_tier)
      VALUES (${e.phone}, ${e.fullName}, ${e.pincode}, ${e.cityId}, ${e.cityNameRaw},
              ${e.intendedDate}, ${e.intendedTier})
      ON CONFLICT (phone_e164, pincode, coalesce(intended_date, '1900-01-01')) DO NOTHING`;
  }
}
