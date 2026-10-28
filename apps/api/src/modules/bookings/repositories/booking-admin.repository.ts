import type { BookingStatus, EmergencyBand, PlanTier } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { IdSubquery } from '../../../infra/db/id-subquery';
import type { AdminBookingFacts, AdminBookingFilter, CitySet, Db } from '../bookings.types';
import { hoursFromNumeric } from '../hours';

interface Row {
  id: string;
  reference: string;
  status: BookingStatus;
  city_id: string;
  category_code: string;
  tier: PlanTier;
  emergency_band: EmergencyBand;
  scheduled_start: Date;
  scheduled_hours: string;
  booker_name: string;
  booker_phone: string;
  total_paise: string;
  advance_paise: string;
  balance_paise: string;
  amount_paid_paise: string;
  venue_address: string;
  venue_landmark: string | null;
  venue_pincode: string;
}

const toFacts = (r: Row): AdminBookingFacts => ({
  id: r.id,
  reference: r.reference,
  status: r.status,
  cityId: r.city_id,
  categoryCode: r.category_code,
  tier: r.tier,
  emergencyBand: r.emergency_band,
  scheduledStart: r.scheduled_start,
  scheduledHours: hoursFromNumeric(r.scheduled_hours),
  clientName: r.booker_name,
  clientPhone: r.booker_phone,
  totalPaise: BigInt(r.total_paise),
  advancePaise: BigInt(r.advance_paise),
  balancePaise: BigInt(r.balance_paise),
  amountPaidPaise: BigInt(r.amount_paid_paise),
  venueAddress: r.venue_address,
  venueLandmark: r.venue_landmark,
  venuePincode: r.venue_pincode.trim(),
});

const COLUMNS = `b.id, b.reference, b.status, b.city_id, cat.code AS category_code, b.tier,
  b.emergency_band, b.scheduled_start, b.scheduled_hours, b.booker_name, b.booker_phone,
  b.total_paise, b.advance_paise, b.balance_paise, b.amount_paid_paise, b.venue_address,
  b.venue_landmark, b.venue_pincode`;

/** `%`, `_` and `\` are literal in a search, not wildcards. */
const likeEscape = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The staff panel's reads of bookings (ADR-0025 D5). City scope, filters and the keyset cursor
 * are all SQL. Cross-context filters arrive as owner-built subqueries (IdSubquery), so this
 * module never names another module's table. Reads the catalogue for the category code only.
 */
@Injectable()
export class BookingAdminRepository {
  async page(db: Db, f: AdminBookingFilter): Promise<AdminBookingFacts[]> {
    const asc = f.order === 'ASC';
    const where = [
      db`b.status <> 'DRAFT'`,
      cityClause(db, f.scope),
      ...(f.cityId ? [db`b.city_id = ${f.cityId}`] : []),
      ...(f.statuses && f.statuses.length > 0 ? [db`b.status IN ${db([...f.statuses])}`] : []),
      ...(f.startsFrom ? [db`b.scheduled_start >= ${f.startsFrom}`] : []),
      ...(f.startsBefore ? [db`b.scheduled_start < ${f.startsBefore}`] : []),
      ...(f.search ? [searchClause(db, f.search)] : []),
      ...(f.within ? [db`b.id IN (${f.within})`] : []),
      ...(f.after
        ? [
            asc
              ? db`(b.scheduled_start, b.id) > (${f.after.scheduledStart}, ${f.after.id}::uuid)`
              : db`(b.scheduled_start, b.id) < (${f.after.scheduledStart}, ${f.after.id}::uuid)`,
          ]
        : []),
    ];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)}
      FROM bookings b JOIN categories cat ON cat.id = b.category_id
      WHERE ${and(db, where)}
      ORDER BY ${asc ? db`b.scheduled_start ASC, b.id ASC` : db`b.scheduled_start DESC, b.id DESC`}
      LIMIT ${f.limit}`;
    return rows.map(toFacts);
  }

  async byIds(db: Db, ids: readonly string[]): Promise<AdminBookingFacts[]> {
    if (ids.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)}
      FROM bookings b JOIN categories cat ON cat.id = b.category_id
      WHERE b.id IN ${db([...new Set(ids)])}`;
    return rows.map(toFacts);
  }

  async cityOf(db: Db, id: string): Promise<string | null> {
    const [row] = await db<{ city_id: string }[]>`SELECT city_id FROM bookings WHERE id = ${id}`;
    return row?.city_id ?? null;
  }

  /** `SELECT id FROM bookings WHERE …` for other modules to embed (see IdSubquery). */
  idsWhere(db: Db, scope: CitySet, statuses?: readonly BookingStatus[]): IdSubquery {
    const where = [
      cityClause(db, scope),
      ...(statuses && statuses.length > 0 ? [db`b.status IN ${db([...statuses])}`] : []),
    ];
    return db`SELECT id FROM bookings b WHERE ${and(db, where)}`;
  }
}

function and(db: Db, parts: readonly postgres.PendingQuery<postgres.Row[]>[]) {
  return parts.reduce((acc, part) => db`${acc} AND ${part}`, db`TRUE`);
}

function cityClause(db: Db, scope: CitySet) {
  if (scope === 'ALL') return db`TRUE`;
  if (scope.length === 0) return db`FALSE`;
  return db`b.city_id IN ${db([...scope])}`;
}

/**
 * Reference ("CLK-1004" or "1004"), booker / subject name, or phone digits. Phones only match in
 * the cities where the caller may see phones (READ_ONLY cannot reverse-look-up a number).
 */
function searchClause(db: Db, s: NonNullable<AdminBookingFilter['search']>) {
  const text = s.text.trim();
  const upper = text.toUpperCase();
  const name = `%${likeEscape(text)}%`;
  const digits = text.replace(/\D/g, '');
  const byPhone =
    digits.length >= 4 && s.phoneScope !== null
      ? db`OR ((b.booker_phone LIKE ${`%${digits}%`} OR b.subject_phone LIKE ${`%${digits}%`})
              AND ${cityClause(db, s.phoneScope)})`
      : db``;
  return db`(b.reference = ${upper} OR b.reference = ${`CLK-${upper}`}
    OR b.booker_name ILIKE ${name} OR b.subject_name ILIKE ${name} ${byPhone})`;
}
