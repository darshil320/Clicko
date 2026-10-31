import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALERT_BOOKING_ID_SQL } from '../../modules/ops/ops-alerts.reader';
import { createScratchDb, type ScratchDb, TEST_DATABASE_URL } from '../../test-support/scratch-db';

/** The alert feed's WHERE, as ops-alerts.reader.ts writes it. */
const ALERT_FEED = `(e.event_type = 'ops.alert'
       AND coalesce(e.payload->>'source_event_type', '') NOT LIKE '%.needs_review')
    OR e.event_type LIKE '%.needs_review'`;

// Needs `pnpm db:up` and TEST_DATABASE_URL. Skipped (not failed) otherwise.
describe.runIf(TEST_DATABASE_URL)('performance indexes (migration 0014) match their reads', () => {
  let db: ScratchDb;

  beforeAll(async () => {
    db = await createScratchDb();
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  /** The plan of `query` with sequential scans priced out, so an index that can serve it does. */
  const plan = (query: string, params: postgres.ParameterOrJSON<never>[] = []): Promise<string> =>
    db.sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`;
      await tx`SET LOCAL enable_sort = off`;
      const rows = await tx.unsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (COSTS OFF) ${query}`,
        params,
      );
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    }) as Promise<string>;

  it('the alert feed reads newest first from domain_events_alert_feed_idx', async () => {
    expect(
      await plan(`SELECT e.id FROM domain_events e WHERE ${ALERT_FEED}
                  ORDER BY e.occurred_at DESC, e.id DESC LIMIT 100`),
    ).toContain('domain_events_alert_feed_idx');
  });

  it("the reader's booking-id expression is the one domain_events_alert_booking_idx indexes", async () => {
    expect(
      await plan(
        `SELECT e.id FROM domain_events e
          WHERE (${ALERT_FEED}) AND (${ALERT_BOOKING_ID_SQL}) = $1::uuid`,
        ['00000000-0000-0000-0000-000000000001'],
      ),
    ).toContain('domain_events_alert_booking_idx');
  });

  it('the booking board pages non-draft bookings from bookings_board_idx', async () => {
    expect(
      await plan(`SELECT b.id FROM bookings b WHERE b.status <> 'DRAFT'
                  ORDER BY b.scheduled_start DESC, b.id DESC LIMIT 50`),
    ).toContain('bookings_board_idx');
  });

  it('board search by name or phone substring uses bookings_search_trgm', async () => {
    expect(
      await plan(`SELECT b.id FROM bookings b
                  WHERE b.booker_name ILIKE '%asha%' OR b.booker_phone LIKE '%98765%'`),
    ).toContain('bookings_search_trgm');
  });

  it('the UTR confirm checks all UTRs in one probe of payouts_utr_idx', async () => {
    expect(
      await plan(`SELECT utr FROM payouts WHERE utr = ANY($1::text[])`, [['UTR1', 'UTR2']]),
    ).toContain('payouts_utr_idx');
  });

  it('open field reports come from assignment_events_reports_idx', async () => {
    expect(
      await plan(`SELECT count(*) FROM assignment_events
                  WHERE kind IN ('ACCESS_DENIED_REPORTED', 'UNSAFE_REPORTED')
                    AND booking_id = '00000000-0000-0000-0000-000000000001'`),
    ).toContain('assignment_events_reports_idx');
  });

  it('the dispatch sweeper scans open rounds from dispatch_rounds_open_idx', async () => {
    expect(
      await plan(`SELECT id FROM dispatch_rounds WHERE ended_at IS NULL
                  ORDER BY started_at LIMIT 100`),
    ).toContain('dispatch_rounds_open_idx');
  });
});
