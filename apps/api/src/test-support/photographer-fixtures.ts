import type { PlanTier } from '@clickco/contracts';
import type postgres from 'postgres';
import { type LatLng, pointAt } from '../infra/db/seeds/geo-offset';
import { LAUNCH_CITIES } from '../infra/db/seeds/launch-cities';

/** Integration-test helpers: photographers with the facts dispatch filters on. */

export interface ProSeed {
  readonly phone: string;
  readonly name?: string;
  readonly city?: 'Surat' | 'Mumbai' | 'Vadodara';
  readonly status?: 'ACTIVE' | 'PAUSED' | 'APPLICANT';
  readonly maxTier?: PlanTier;
  readonly radiusKm?: number;
  /** Distance and bearing from the city centre; null = no base location on file. */
  readonly km?: number | null;
  readonly bearing?: number;
  readonly acceptsEmergency?: boolean;
  readonly categories?: ReadonlyArray<{ readonly code: string; readonly tier: PlanTier }>;
  readonly availability?: ReadonlyArray<{
    readonly dow: number;
    readonly from: string;
    readonly to: string;
  }>;
  readonly blocks?: ReadonlyArray<{ readonly from: Date; readonly until: Date }>;
  /** Approved DRONE_RPC + DRONE_UIN; 'RPC_ONLY' approves just the pilot certificate. */
  readonly drone?: 'BOTH' | 'RPC_ONLY';
  readonly metrics?: {
    readonly ratingAvgBps?: number | null;
    readonly ratingCount?: number;
    readonly acceptanceRateBps?: number | null;
    readonly onTimeUploadRateBps?: number | null;
    readonly noShowCount?: number;
  };
}

export function cityCentre(name: string): LatLng {
  const city = LAUNCH_CITIES.find((c) => c.name === name);
  if (!city) throw new Error(`cityCentre: unknown city ${name}`);
  return city.centre;
}

async function reviewerId(sql: postgres.Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO staff_users (email, full_name, password_hash, is_active)
    VALUES ('test-reviewer@clickco.invalid', 'Test reviewer', '!', false)
    ON CONFLICT (lower(email)) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id`;
  if (!row) throw new Error('reviewerId: no row');
  return row.id;
}

async function insertCore(sql: postgres.Sql, s: ProSeed): Promise<string> {
  const city = s.city ?? 'Surat';
  const point = s.km === null ? null : pointAt(cityCentre(city), s.km ?? 2, s.bearing ?? 0);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO photographers (
      phone_e164, full_name, city_id, base_location, status, max_tier, service_radius_km,
      accepts_emergency, identity_confirmed_at, police_verification_at, pan_verified_at,
      bank_verified_at, onboarded_at)
    SELECT ${s.phone}, ${s.name ?? 'Test Photographer'}, c.id,
           ${point ? sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography` : null},
           ${s.status ?? 'ACTIVE'}, ${s.maxTier ?? 'EXPERT'}, ${s.radiusKm ?? 25},
           ${s.acceptsEmergency ?? false}, now(), current_date, now(), now(), now()
    FROM cities c WHERE c.name = ${city}
    RETURNING id`;
  if (!row) throw new Error(`insertPhotographer: city ${city} not seeded`);
  return row.id;
}

export async function insertPhotographer(sql: postgres.Sql, s: ProSeed): Promise<string> {
  const id = await insertCore(sql, s);
  for (const c of s.categories ?? []) {
    await sql`
      INSERT INTO photographer_categories (photographer_id, category_id, certified_tier)
      SELECT ${id}, cat.id, ${c.tier} FROM categories cat WHERE cat.code = ${c.code}`;
  }
  for (const a of s.availability ?? []) {
    await sql`
      INSERT INTO photographer_availability (photographer_id, iso_dow, start_time, end_time)
      VALUES (${id}, ${a.dow}, ${a.from}, ${a.to})`;
  }
  for (const b of s.blocks ?? []) {
    await sql`
      INSERT INTO photographer_blocks (photographer_id, blocked_from, blocked_until, reason)
      VALUES (${id}, ${b.from}, ${b.until}, 'test block')`;
  }
  if (s.drone) {
    const kinds = s.drone === 'BOTH' ? ['DRONE_RPC', 'DRONE_UIN'] : ['DRONE_RPC'];
    const reviewer = await reviewerId(sql);
    for (const kind of kinds) {
      await sql`
        INSERT INTO photographer_documents (photographer_id, kind, storage_key, review_status, reviewed_by, reviewed_at)
        VALUES (${id}, ${kind}, ${`test/${id}/${kind}`}, 'APPROVED', ${reviewer}, now())`;
    }
  }
  if (s.metrics) {
    const m = s.metrics;
    await sql`
      INSERT INTO photographer_metrics (photographer_id, rating_avg_bps, rating_count,
        acceptance_rate_bps, on_time_upload_rate_bps, no_show_count)
      VALUES (${id}, ${m.ratingAvgBps ?? null}, ${m.ratingCount ?? 0}, ${m.acceptanceRateBps ?? null},
              ${m.onTimeUploadRateBps ?? null}, ${m.noShowCount ?? 0})`;
  }
  return id;
}

/** A unique, valid +91 98xx test number (never the demo numbers used elsewhere). */
export function proPhone(n: number): string {
  return `+91983300${String(n).padStart(4, '0')}`;
}
