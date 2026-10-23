import type { PlanTier } from '@clickco/contracts';
import type postgres from 'postgres';
import { pointAt } from './geo-offset';
import { LAUNCH_CITIES } from './launch-cities';

/**
 * DEVELOPMENT ONLY demo photographers (ADR-0010 "Dev data") so the ops console's dispatch desk can
 * run a full cascade. Fictional people. Phones are +91 99990 00xxx: no Indian mobile block is
 * guaranteed unallocated (TRAI), so they could belong to real people — harmless while the dev SMS
 * adapter only logs, and the seed refuses anything but a local development database. Verification
 * timestamps are set because an ACTIVE photographer must have passed manual verification
 * (pro_active_requires_verification). No ID numbers, PAN or bank details are seeded.
 */
type City = 'Surat' | 'Mumbai' | 'Vadodara';
type Cert = readonly [category: string, tier: PlanTier];

interface DevPro {
  readonly name: string;
  readonly city: City;
  /** Distance (km) and compass bearing from the city centre. */
  readonly km: number;
  readonly bearing: number;
  readonly maxTier: PlanTier;
  readonly radiusKm: number;
  readonly emergency: boolean;
  readonly certs: readonly Cert[];
  readonly drone?: true;
  /** shoots, rating bps (4.87 → 4870), ratings, acceptance bps, on-time bps, no-shows */
  readonly m: readonly [number, number, number, number, number, number];
}

const F = 'FOOD';
const W = 'WEDDING';
const P = 'PRODUCT';
const R = 'REAL_ESTATE';
const C = 'CORPORATE';

export const DEV_PHOTOGRAPHERS: readonly DevPro[] = [
  // Surat (12)
  {
    name: 'Hetal Patel',
    city: 'Surat',
    km: 1.5,
    bearing: 20,
    maxTier: 'EXPERT',
    radiusKm: 15,
    emergency: true,
    certs: [
      [F, 'EXPERT'],
      [P, 'PROFESSIONAL'],
    ],
    m: [142, 4870, 118, 9100, 9600, 0],
  },
  {
    name: 'Jignesh Desai',
    city: 'Surat',
    km: 3.2,
    bearing: 110,
    maxTier: 'PROFESSIONAL',
    radiusKm: 12,
    emergency: false,
    certs: [[F, 'PROFESSIONAL']],
    m: [64, 4620, 51, 7800, 9000, 1],
  },
  {
    name: 'Krupa Shah',
    city: 'Surat',
    km: 4.8,
    bearing: 200,
    maxTier: 'EXPERT',
    radiusKm: 20,
    emergency: true,
    certs: [
      [W, 'EXPERT'],
      [C, 'EXPERT'],
    ],
    m: [211, 4910, 190, 8800, 9700, 0],
  },
  {
    name: 'Mihir Mehta',
    city: 'Surat',
    km: 6.1,
    bearing: 290,
    maxTier: 'SEMI_PRO',
    radiusKm: 10,
    emergency: false,
    certs: [[W, 'SEMI_PRO']],
    m: [23, 4400, 19, 6500, 8200, 0],
  },
  {
    name: 'Nidhi Joshi',
    city: 'Surat',
    km: 7.4,
    bearing: 60,
    maxTier: 'PROFESSIONAL',
    radiusKm: 15,
    emergency: false,
    certs: [
      [R, 'PROFESSIONAL'],
      [P, 'PROFESSIONAL'],
    ],
    m: [48, 4710, 40, 8400, 9300, 0],
  },
  {
    name: 'Parth Naik',
    city: 'Surat',
    km: 9.0,
    bearing: 150,
    maxTier: 'BASIC',
    radiusKm: 12,
    emergency: false,
    certs: [],
    m: [6, 4300, 5, 7000, 8000, 0],
  },
  {
    name: 'Riddhi Chauhan',
    city: 'Surat',
    km: 10.5,
    bearing: 240,
    maxTier: 'EXPERT',
    radiusKm: 25,
    emergency: false,
    certs: [
      [F, 'EXPERT'],
      [W, 'EXPERT'],
      [P, 'EXPERT'],
    ],
    drone: true,
    m: [176, 4840, 150, 8600, 9500, 0],
  },
  {
    name: 'Sagar Rana',
    city: 'Surat',
    km: 12.3,
    bearing: 330,
    maxTier: 'PROFESSIONAL',
    radiusKm: 15,
    emergency: false,
    certs: [[C, 'PROFESSIONAL']],
    m: [37, 4550, 30, 7200, 8800, 2],
  },
  {
    name: 'Tanvi Bhatt',
    city: 'Surat',
    km: 14.0,
    bearing: 90,
    maxTier: 'SEMI_PRO',
    radiusKm: 18,
    emergency: false,
    certs: [],
    m: [12, 4600, 10, 8000, 9000, 0],
  },
  {
    name: 'Utsav Modi',
    city: 'Surat',
    km: 16.2,
    bearing: 180,
    maxTier: 'PROFESSIONAL',
    radiusKm: 20,
    emergency: false,
    certs: [[F, 'PROFESSIONAL']],
    m: [29, 4500, 22, 6900, 8700, 0],
  },
  {
    name: 'Vidhi Gandhi',
    city: 'Surat',
    km: 18.5,
    bearing: 270,
    maxTier: 'EXPERT',
    radiusKm: 25,
    emergency: false,
    certs: [[W, 'EXPERT']],
    m: [98, 4780, 84, 8100, 9200, 1],
  },
  {
    name: 'Yash Thakkar',
    city: 'Surat',
    km: 20.0,
    bearing: 10,
    maxTier: 'BASIC',
    radiusKm: 25,
    emergency: false,
    certs: [],
    m: [0, 0, 0, 0, 0, 0],
  },
  // Mumbai (6)
  {
    name: 'Aditi Kulkarni',
    city: 'Mumbai',
    km: 2.1,
    bearing: 340,
    maxTier: 'EXPERT',
    radiusKm: 15,
    emergency: true,
    certs: [
      [F, 'EXPERT'],
      [C, 'EXPERT'],
    ],
    m: [254, 4890, 221, 9000, 9600, 0],
  },
  {
    name: 'Rohit Deshmukh',
    city: 'Mumbai',
    km: 5.6,
    bearing: 30,
    maxTier: 'PROFESSIONAL',
    radiusKm: 12,
    emergency: false,
    certs: [[P, 'PROFESSIONAL']],
    m: [71, 4650, 60, 7700, 9100, 0],
  },
  {
    name: 'Sneha Pawar',
    city: 'Mumbai',
    km: 8.3,
    bearing: 160,
    maxTier: 'EXPERT',
    radiusKm: 20,
    emergency: false,
    certs: [[W, 'EXPERT']],
    m: [133, 4820, 117, 8300, 9400, 1],
  },
  {
    name: 'Imran Shaikh',
    city: 'Mumbai',
    km: 11.7,
    bearing: 210,
    maxTier: 'SEMI_PRO',
    radiusKm: 15,
    emergency: false,
    certs: [[W, 'SEMI_PRO']],
    m: [19, 4450, 14, 7100, 8500, 0],
  },
  {
    name: 'Kavita Iyer',
    city: 'Mumbai',
    km: 15.4,
    bearing: 75,
    maxTier: 'PROFESSIONAL',
    radiusKm: 18,
    emergency: false,
    certs: [
      [R, 'PROFESSIONAL'],
      [F, 'PROFESSIONAL'],
    ],
    m: [44, 4700, 36, 8200, 9000, 0],
  },
  {
    name: 'Nikhil Sawant',
    city: 'Mumbai',
    km: 19.2,
    bearing: 300,
    maxTier: 'BASIC',
    radiusKm: 20,
    emergency: false,
    certs: [],
    m: [3, 4200, 2, 6000, 7500, 0],
  },
  // Vadodara (4)
  {
    name: 'Bhavesh Solanki',
    city: 'Vadodara',
    km: 2.7,
    bearing: 50,
    maxTier: 'PROFESSIONAL',
    radiusKm: 15,
    emergency: false,
    certs: [
      [F, 'PROFESSIONAL'],
      [P, 'PROFESSIONAL'],
    ],
    m: [41, 4680, 33, 8000, 9200, 0],
  },
  {
    name: 'Dhara Parmar',
    city: 'Vadodara',
    km: 6.9,
    bearing: 140,
    maxTier: 'EXPERT',
    radiusKm: 20,
    emergency: false,
    certs: [[W, 'EXPERT']],
    m: [87, 4800, 73, 8500, 9300, 0],
  },
  {
    name: 'Ketan Vyas',
    city: 'Vadodara',
    km: 11.1,
    bearing: 230,
    maxTier: 'SEMI_PRO',
    radiusKm: 15,
    emergency: false,
    certs: [],
    m: [15, 4500, 11, 7400, 8600, 1],
  },
  {
    name: 'Mansi Trivedi',
    city: 'Vadodara',
    km: 17.8,
    bearing: 320,
    maxTier: 'PROFESSIONAL',
    radiusKm: 25,
    emergency: false,
    certs: [[C, 'PROFESSIONAL']],
    m: [26, 4600, 20, 7600, 8900, 0],
  },
];

/** +91 99990 00NNN — a fictional-looking block clear of the numbers tests and demos use. */
export const devPhone = (index: number): string =>
  `+919999000${String(101 + index).padStart(3, '0')}`;

async function reviewerId(tx: postgres.TransactionSql): Promise<string> {
  // Inactive placeholder with an unusable password hash: it only signs the seeded document reviews.
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO staff_users (email, full_name, password_hash, is_active)
    VALUES ('dev-seed-reviewer@clickco.invalid', 'Dev seed reviewer', '!', false)
    ON CONFLICT (lower(email)) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id`;
  if (!row) throw new Error('dev seed: reviewer insert returned nothing');
  return row.id;
}

async function insertOne(
  tx: postgres.TransactionSql,
  p: DevPro,
  phone: string,
): Promise<string | null> {
  const centre = LAUNCH_CITIES.find((c) => c.name === p.city)?.centre;
  if (!centre) throw new Error(`dev seed: unknown city ${p.city}`);
  const at = pointAt(centre, p.km, p.bearing);
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO photographers (phone_e164, full_name, city_id, base_location, status, max_tier,
      service_radius_km, accepts_emergency, identity_confirmed_at, police_verification_at,
      police_verification_expires, pan_verified_at, bank_verified_at, onboarded_at, internal_notes)
    SELECT ${phone}, ${p.name}, c.id, ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography,
           'ACTIVE', ${p.maxTier}, ${p.radiusKm}, ${p.emergency}, now(), current_date,
           current_date + 365, now(), now(), now(), 'dev seed — fictional'
    FROM cities c WHERE c.name = ${p.city}
    ON CONFLICT (phone_e164) DO NOTHING
    RETURNING id`;
  return row?.id ?? null;
}

async function insertDetails(tx: postgres.TransactionSql, id: string, p: DevPro, reviewer: string) {
  for (const [code, tier] of p.certs) {
    await tx`INSERT INTO photographer_categories (photographer_id, category_id, certified_tier)
             SELECT ${id}, cat.id, ${tier} FROM categories cat WHERE cat.code = ${code}`;
  }
  await tx`INSERT INTO photographer_gear (photographer_id, kind, make_model, sensor_format, supports_dual_card)
           VALUES (${id}, 'BODY', ${p.maxTier === 'BASIC' ? 'Canon EOS R10' : 'Sony A7 IV'},
                   ${p.maxTier === 'BASIC' ? 'APS_C' : 'FULL_FRAME'}, ${p.maxTier !== 'BASIC'}),
                  (${id}, 'LENS', '24-70mm f/2.8', NULL, NULL)`;
  if (p.drone) {
    await tx`INSERT INTO photographer_gear (photographer_id, kind, make_model) VALUES (${id}, 'DRONE', 'DJI Mini 4 Pro')`;
    for (const kind of ['DRONE_RPC', 'DRONE_UIN']) {
      await tx`INSERT INTO photographer_documents (photographer_id, kind, storage_key, review_status,
                 reviewed_by, reviewed_at, expires_on)
               VALUES (${id}, ${kind}, ${`dev-seed/${id}/${kind}.pdf`}, 'APPROVED', ${reviewer}, now(),
                       current_date + 365)`;
    }
  }
  const [shoots, rating, ratings, accept, onTime, noShows] = p.m;
  await tx`INSERT INTO photographer_metrics (photographer_id, shoots_completed, rating_avg_bps,
             rating_count, acceptance_rate_bps, on_time_upload_rate_bps, no_show_count)
           VALUES (${id}, ${shoots}, ${ratings > 0 ? rating : null}, ${ratings},
                   ${shoots > 0 ? accept : null}, ${shoots > 0 ? onTime : null}, ${noShows})`;
}

/** Idempotent: a phone that already exists is left exactly as it is (ON CONFLICT DO NOTHING). */
export async function seedDevPhotographers(sql: postgres.Sql): Promise<{ inserted: number }> {
  return sql.begin(async (tx) => {
    const reviewer = await reviewerId(tx);
    let inserted = 0;
    for (const [i, p] of DEV_PHOTOGRAPHERS.entries()) {
      const id = await insertOne(tx, p, devPhone(i));
      if (!id) continue;
      await insertDetails(tx, id, p, reviewer);
      inserted += 1;
    }
    return { inserted };
  });
}
