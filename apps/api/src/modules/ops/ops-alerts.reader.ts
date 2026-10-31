import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import type { IdSubquery } from '../../infra/db/id-subquery';

/** An ops alert or review flag (ADR-0025 D5 alert feed), read from the outbox. */
export interface AlertRecord {
  /** domain_events.id — the keyset position. */
  readonly seq: string;
  readonly eventId: string;
  /** `ops.alert`, `booking.needs_review` or `payment.needs_review`. */
  readonly type: string;
  /** A review's reason, or the event an ops alert was raised for. */
  readonly reason: string | null;
  readonly severity: string | null;
  readonly bookingId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

interface Row {
  seq: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  booking_id: string | null;
  occurred_at: Date;
}

export interface AlertPageQuery {
  /** Only alerts on these bookings (the caller's cities); null = every alert, incl. system ones. */
  readonly bookings: IdSubquery | null;
  readonly after?: { readonly occurredAt: Date; readonly seq: string };
  /** Only alerts at or after this instant (the overview's last-24-hours count). */
  readonly since?: Date;
  readonly limit: number;
}

export interface ReviewPageQuery {
  /** Only reviews on these bookings (the caller's cities); null = every review, incl. system ones. */
  readonly bookings: IdSubquery | null;
  /** Event ids already settled (built by the module that owns the settlements). */
  readonly settled: IdSubquery;
  readonly status: 'OPEN' | 'SETTLED' | 'ALL';
  readonly after?: { readonly occurredAt: Date; readonly seq: string };
  readonly limit: number;
}

/**
 * The alert's booking: the aggregate, or a payment event's `booking_id` when it is a UUID. This
 * text must match migration 0014's `domain_events_alert_booking_idx` expression exactly — the UUID
 * pattern is an inlined constant, never a bind parameter, or the planner cannot use the index
 * (ops-alerts.reader.test.ts checks the two stay in step).
 */
export const ALERT_BOOKING_ID_SQL = `CASE WHEN e.aggregate_kind = 'booking' THEN e.aggregate_id
                  WHEN e.payload->>'booking_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN (e.payload->>'booking_id')::uuid
             END`;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const toRecord = (r: Row): AlertRecord => {
  const isAlert = r.event_type === 'ops.alert';
  return {
    seq: String(r.seq),
    eventId: r.event_id,
    type: r.event_type,
    reason: isAlert ? str(r.payload.source_event_type) : str(r.payload.reason),
    severity: isAlert ? str(r.payload.severity) : null,
    bookingId: r.booking_id,
    details: r.payload,
    occurredAt: r.occurred_at,
  };
};

/**
 * Reads `ops.alert` and `*.needs_review` events (ADR-0025 D5). An ops alert raised FOR a review
 * is skipped: the review itself is listed. The booking is the aggregate, or a payment event's
 * `booking_id`. Settling alerts is S10, so every one counts as open until then.
 */
@Injectable()
export class OpsAlertsReader {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  async page(q: AlertPageQuery): Promise<AlertRecord[]> {
    const db = this.sql;
    const scope = q.bookings ? db`a.booking_id IN (${q.bookings})` : db`TRUE`;
    const after = q.after
      ? db`(a.occurred_at, a.seq) < (${q.after.occurredAt}, ${q.after.seq}::bigint)`
      : db`TRUE`;
    const since = q.since ? db`a.occurred_at >= ${q.since}` : db`TRUE`;
    const rows = await db<Row[]>`
      SELECT a.* FROM (${this.alerts()}) a
      WHERE ${scope} AND ${after} AND ${since}
      ORDER BY a.occurred_at DESC, a.seq DESC
      LIMIT ${q.limit}`;
    return rows.map(toRecord);
  }

  async forBookings(bookingIds: readonly string[]): Promise<Map<string, AlertRecord[]>> {
    if (bookingIds.length === 0) return new Map();
    const db = this.sql;
    const rows = await db<Row[]>`
      SELECT a.* FROM (${this.alerts()}) a
      WHERE a.booking_id IN ${db([...new Set(bookingIds)])}
      ORDER BY a.occurred_at DESC, a.seq DESC`;
    const out = new Map<string, AlertRecord[]>();
    for (const record of rows.map(toRecord)) {
      const id = record.bookingId as string;
      out.set(id, [...(out.get(id) ?? []), record]);
    }
    return out;
  }

  /**
   * ADR-0026 D2 — review items: the `*.needs_review` events only, newest first. `settled` is the
   * refunds module's subquery of settled event ids (review_resolutions), so OPEN / SETTLED filter
   * in SQL without this module reading that table.
   */
  async reviewPage(q: ReviewPageQuery): Promise<AlertRecord[]> {
    const db = this.sql;
    const rows = await db<Row[]>`
      SELECT a.* FROM (${this.reviews()}) a
      WHERE ${this.reviewFilter(q)}
        AND ${q.after ? db`(a.occurred_at, a.seq) < (${q.after.occurredAt}, ${q.after.seq}::bigint)` : db`TRUE`}
      ORDER BY a.occurred_at DESC, a.seq DESC
      LIMIT ${q.limit}`;
    return rows.map(toRecord);
  }

  /** Open review items in scope — the Today page and the nav count (ADR-0026 D8). */
  async reviewCount(q: Omit<ReviewPageQuery, 'after' | 'limit'>): Promise<number> {
    const [row] = await this.sql<{ n: string }[]>`
      SELECT count(*) AS n FROM (${this.reviews()}) a WHERE ${this.reviewFilter(q)}`;
    return Number(row?.n ?? 0);
  }

  /** One review item by its event id (any status); null when it is not a review. */
  async review(eventId: string): Promise<AlertRecord | null> {
    const [row] = await this.sql<Row[]>`
      SELECT a.* FROM (${this.reviews()}) a WHERE a.event_id = ${eventId}`;
    return row ? toRecord(row) : null;
  }

  private reviewFilter(q: Omit<ReviewPageQuery, 'after' | 'limit'>) {
    const db = this.sql;
    const scope = q.bookings ? db`a.booking_id IN (${q.bookings})` : db`TRUE`;
    const status =
      q.status === 'OPEN'
        ? db`a.event_id::uuid NOT IN (${q.settled})`
        : q.status === 'SETTLED'
          ? db`a.event_id::uuid IN (${q.settled})`
          : db`TRUE`;
    return db`${scope} AND ${status}`;
  }

  private reviews() {
    return this.sql`
      SELECT e.id AS seq, e.event_id::text AS event_id, e.event_type, e.payload, e.occurred_at,
             ${this.sql.unsafe(ALERT_BOOKING_ID_SQL)} AS booking_id
      FROM domain_events e
      WHERE e.event_type LIKE '%.needs_review'`;
  }

  /** Booking ids with any alert or review — the board's needs-attention filter. */
  bookingsNeedingAttention(): IdSubquery {
    return this.sql`SELECT a.booking_id FROM (${this.alerts()}) a WHERE a.booking_id IS NOT NULL`;
  }

  private alerts() {
    return this.sql`
      SELECT e.id AS seq, e.event_id::text AS event_id, e.event_type, e.payload, e.occurred_at,
             ${this.sql.unsafe(ALERT_BOOKING_ID_SQL)} AS booking_id
      FROM domain_events e
      WHERE (e.event_type = 'ops.alert'
             AND coalesce(e.payload->>'source_event_type', '') NOT LIKE '%.needs_review')
         OR e.event_type LIKE '%.needs_review'`;
  }
}
