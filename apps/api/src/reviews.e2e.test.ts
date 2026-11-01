import type { BookingStatus, StaffRole } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingsService } from './modules/bookings/bookings.service';
import { walkTo } from './modules/media/__tests__/media-fixtures';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { acceptOffer, bookAndPay, insertClient, tokenFor } from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff, cityIdOf, staffToken } from './test-support/staff-fixtures';

const NOW = new Date('2026-12-07T04:30:00.000Z');
const DAY = 86_400_000;
let keySeq = 0;
const idem = () => `reviews-e2e-${String(++keySeq).padStart(6, '0')}`;

/** After check-out, the rest of the way to DELIVERED through the state machine (no media). */
const TO_DELIVERED: readonly BookingStatus[] = [
  'UPLOADING',
  'PROCESSING',
  'QA',
  'BALANCE_PENDING',
  'DELIVERED',
];

/**
 * ADR-0027 D4 end to end: a client rates a delivered booking and the photographer's metrics
 * follow; edits for 7 days, refused after; links and phone numbers never published; reports from
 * both apps reach the moderation desk, where a hide unpublishes the review and the rating is
 * recomputed; a blocked photographer is never offered the client's next booking; the desk's
 * roles and cities.
 */
describe.runIf(TEST_DATABASE_URL)('reviews and UGC safety (ADR-0027 D4)', () => {
  let e2e: E2eApp;
  const staff = {} as Record<
    'admin' | 'qm' | 'support' | 'cmSurat' | 'cmMumbai' | 'ops' | 'finance' | 'readOnly',
    string
  >;
  let proA: string;
  let proB: string;
  let clientX: string;
  let clientY: string;
  let bookingX: string;
  let bookingY: string;
  let reviewX: string;
  let reviewY: string;
  const reports = {} as Record<
    'proOnReview' | 'xOnReview' | 'yOnPro' | 'proOnY' | 'proOnReviewX',
    string
  >;

  const as = (who: keyof typeof staff) => staffToken(e2e, staff[who]);
  /** One second per write, so reports and decisions have distinct times (the desk's sort key). */
  const tick = () => e2e.advance(1_000);
  const desk = async (who: keyof typeof staff, path: string) =>
    e2e.call('GET', `/admin/moderation${path}`, { token: await as(who) });
  const decide = async (who: keyof typeof staff, reportId: string, body: Json) => {
    tick();
    return e2e.call('POST', `/admin/moderation/reports/${reportId}/decide`, {
      token: await as(who),
      idempotencyKey: idem(),
      body,
    });
  };
  const client = async (userId: string, method: string, path: string, body?: Json) => {
    if (method === 'POST') tick();
    return e2e.call(method, path, {
      token: await tokenFor(e2e, 'USER', userId),
      ...(body === undefined ? {} : { body }),
    });
  };
  const pro = async (proId: string, path: string, body: Json) => {
    tick();
    return e2e.call('POST', path, { token: await tokenFor(e2e, 'PHOTOGRAPHER', proId), body });
  };
  const metrics = async (photographerId: string) =>
    (
      await e2e.db.sql<{ rating_avg_bps: number | null; rating_count: number }[]>`
        SELECT rating_avg_bps, rating_count FROM photographer_metrics
        WHERE photographer_id = ${photographerId}`
    )[0] ?? null;
  const events = (type: string) =>
    e2e.db.sql<{ aggregate_id: string; payload: Json }[]>`
      SELECT aggregate_id, payload FROM domain_events WHERE event_type = ${type} ORDER BY id`;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    const surat = await cityIdOf(e2e, 'Surat');
    const mumbai = await cityIdOf(e2e, 'Mumbai');
    const make = async (key: keyof typeof staff, role: StaffRole, cityId: string | null = null) => {
      staff[key] = (await bootstrapStaff(e2e, `${key}@clickco.test`, role, cityId)).id;
    };
    await make('admin', 'SUPER_ADMIN');
    await make('qm', 'QUALITY_MANAGER');
    await make('support', 'SUPPORT');
    await make('cmSurat', 'CITY_MANAGER', surat);
    await make('cmMumbai', 'CITY_MANAGER', mumbai);
    await make('ops', 'OPS_AGENT');
    await make('finance', 'FINANCE');
    await make('readOnly', 'READ_ONLY');

    const food = [{ code: 'FOOD', tier: 'EXPERT' as const }];
    proA = await insertPhotographer(e2e.db.sql, {
      phone: '+919999189101',
      name: 'Asha Patel',
      km: 2,
      categories: food,
    });
    proB = await insertPhotographer(e2e.db.sql, {
      phone: '+919999189102',
      name: 'Bina Mehta',
      km: 3,
      bearing: 90,
      categories: food,
    });
    clientX = await insertClient(e2e, '+919999289101');
    clientY = await insertClient(e2e, '+919999289102');

    const bookings = e2e.get(BookingsService);
    const deliver = async (userId: string, startInDays: number) => {
      const start = new Date(e2e.now().getTime() + startInDays * DAY);
      const booking = await bookAndPay(e2e, userId, start);
      const id = booking.id as string;
      const assignmentId = await acceptOffer(e2e, proA, id);
      await walkTo(e2e, id, assignmentId, 'CHECKED_OUT', 1);
      for (const to of TO_DELIVERED) {
        const now = e2e.now();
        await e2e.db.sql.begin(async (tx) => {
          await bookings.transition(tx, {
            bookingId: id,
            to,
            actor: { kind: 'SYSTEM', id: null },
            occurredAt: now,
            reason: 'reviews test fixture',
          });
          if (to === 'DELIVERED') await bookings.recordDelivered(tx, id, now);
        });
      }
      return id;
    };
    bookingX = await deliver(clientX, 6);
    bookingY = await deliver(clientY, 10);
    await drainOutbox(e2e);
  }, 240_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('a review feeds the photographer’s metrics', () => {
    it('nothing to read before the client writes one', async () => {
      const r = await client(clientX, 'GET', `/bookings/${bookingX}/review`);
      expect(r.status).toBe(200);
      expect(r.json.data).toBeNull();
    });

    it('only the owner of a delivered booking can rate it', async () => {
      const other = await client(clientY, 'POST', `/bookings/${bookingX}/review`, { rating: 1 });
      expect(other.status).toBe(404);
      expect(other.json.error.code).toBe('BOOKING_NOT_FOUND');
      const bad = await client(clientX, 'POST', `/bookings/${bookingX}/review`, { rating: 6 });
      expect(bad.status).toBe(400);
    });

    it('5 stars → review.submitted → rating 5.0 from 1 review', async () => {
      const r = await client(clientX, 'POST', `/bookings/${bookingX}/review`, {
        rating: 5,
        comment: 'Lovely candid shots, very patient with the kids',
      });
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({
        bookingId: bookingX,
        rating: 5,
        comment: 'Lovely candid shots, very patient with the kids',
        isPublished: true,
        canEdit: true,
        editableUntil: new Date(e2e.now().getTime() + 7 * DAY).toISOString(),
      });
      reviewX = r.json.data.id;
      expect((await events('review.submitted')).at(-1)?.payload).toMatchObject({
        review_id: reviewX,
        photographer_id: proA,
        rating: 5,
      });
      await drainOutbox(e2e);
      expect(await metrics(proA)).toEqual({ rating_avg_bps: 5000, rating_count: 1 });
    });

    it('strips links, emails and phone numbers from the published comment', async () => {
      const r = await client(clientY, 'POST', `/bookings/${bookingY}/review`, {
        rating: 2,
        comment:
          'Late and rude. Call 98765 43210 or mail asha.clicks@gmail.com, see https://asha.photos/deal or wa.me/919876543210 for a refund',
      });
      expect(r.status).toBe(200);
      expect(r.json.data.comment).toBe('Late and rude. Call or mail , see or for a refund');
      reviewY = r.json.data.id;
      const [row] = await e2e.db.sql<{ comment: string }[]>`
        SELECT comment FROM reviews WHERE id = ${reviewY}`;
      expect(row?.comment).not.toMatch(/\d{5}|@|https?:|wa\.me/);
      await drainOutbox(e2e);
      expect(await metrics(proA)).toEqual({ rating_avg_bps: 3500, rating_count: 2 });
    });
  });

  describe('editing for 7 days', () => {
    it('an edit within the window changes the rating and the metrics follow', async () => {
      e2e.advance(2 * DAY);
      const r = await client(clientX, 'POST', `/bookings/${bookingX}/review`, {
        rating: 4,
        comment: 'Lovely candid shots',
      });
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({ id: reviewX, rating: 4, comment: 'Lovely candid shots' });
      expect((await events('review.edited')).at(-1)?.payload).toMatchObject({
        review_id: reviewX,
        rating: 4,
        previous_rating: 5,
      });
      await drainOutbox(e2e);
      expect(await metrics(proA)).toEqual({ rating_avg_bps: 3000, rating_count: 2 });
      const [computed] = await e2e.db.sql<{ computed_at: Date }[]>`
        SELECT computed_at FROM photographer_metrics WHERE photographer_id = ${proA}`;
      expect(computed?.computed_at).toEqual(e2e.now());
      const mine = await client(clientX, 'GET', `/bookings/${bookingX}/review`);
      expect(mine.json.data).toMatchObject({ rating: 4, canEdit: true });
    });

    it('after 7 days the API answers 409 REVIEW_EDIT_WINDOW_CLOSED and nothing changes', async () => {
      e2e.advance(5 * DAY + 60_000);
      const r = await client(clientX, 'POST', `/bookings/${bookingX}/review`, { rating: 1 });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('REVIEW_EDIT_WINDOW_CLOSED');
      const mine = await client(clientX, 'GET', `/bookings/${bookingX}/review`);
      expect(mine.json.data).toMatchObject({ rating: 4, canEdit: false });
    });
  });

  describe('reports from both apps', () => {
    it('the photographer reports the review about them', async () => {
      const r = await pro(proA, '/pro/reports', {
        targetKind: 'REVIEW',
        targetId: reviewY,
        reason: 'ABUSIVE',
        note: 'This client was never there on time',
      });
      expect(r.status).toBe(201);
      expect(r.json.data.status).toBe('OPEN');
      reports.proOnReview = r.json.data.id;
      const again = await pro(proA, '/pro/reports', {
        targetKind: 'REVIEW',
        targetId: reviewY,
        reason: 'SPAM',
      });
      expect(again.status).toBe(409);
      expect(again.json.error.code).toBe('REPORT_ALREADY_OPEN');
    });

    it('while a report on it is open, the author cannot change the review', async () => {
      const edit = await client(clientY, 'POST', `/bookings/${bookingY}/review`, {
        rating: 5,
        comment: 'Wonderful!',
      });
      expect(edit.status).toBe(409);
      expect(edit.json.error.code).toBe('REVIEW_UNDER_MODERATION');
      const [row] = await e2e.db.sql<{ rating: number }[]>`
        SELECT rating FROM reviews WHERE id = ${reviewY}`;
      expect(row?.rating).toBe(2);
    });

    it('another client reports the same review; its author cannot', async () => {
      const r = await client(clientX, 'POST', '/reports', {
        targetKind: 'REVIEW',
        targetId: reviewY,
        reason: 'FALSE_INFORMATION',
      });
      expect(r.status).toBe(201);
      reports.xOnReview = r.json.data.id;
      const own = await client(clientY, 'POST', '/reports', {
        targetKind: 'REVIEW',
        targetId: reviewY,
        reason: 'OTHER',
      });
      expect(own.status).toBe(422);
      expect(own.json.error.code).toBe('CANNOT_REPORT_YOURSELF');
    });

    it('a client reports their photographer; a photographer their client — about a shared booking', async () => {
      const onPro = await client(clientY, 'POST', '/reports', {
        targetKind: 'PHOTOGRAPHER',
        targetId: proA,
        bookingId: bookingY,
        reason: 'UNSAFE_BEHAVIOUR',
      });
      expect(onPro.status).toBe(201);
      reports.yOnPro = onPro.json.data.id;
      const onClient = await pro(proA, '/pro/reports', {
        targetKind: 'USER',
        targetId: clientY,
        bookingId: bookingY,
        reason: 'HARASSMENT',
      });
      expect(onClient.status).toBe(201);
      reports.proOnY = onClient.json.data.id;

      // Not someone you shared that booking with: answered like a missing booking.
      const wrongBooking = await pro(proA, '/pro/reports', {
        targetKind: 'USER',
        targetId: clientY,
        bookingId: bookingX,
        reason: 'HARASSMENT',
      });
      expect(wrongBooking.status).toBe(404);
      const neverAssigned = await pro(proB, '/pro/reports', {
        targetKind: 'USER',
        targetId: clientY,
        bookingId: bookingY,
        reason: 'HARASSMENT',
      });
      expect(neverAssigned.status).toBe(404);
      const noBooking = await client(clientY, 'POST', '/reports', {
        targetKind: 'PHOTOGRAPHER',
        targetId: proA,
        reason: 'SPAM',
      });
      expect(noBooking.status).toBe(400);
    });

    it('a reporter is capped per day (429)', async () => {
      const surat = await cityIdOf(e2e, 'Surat');
      for (let i = 0; i < 9; i++) {
        await e2e.db.sql`
          INSERT INTO moderation_reports (reporter_kind, reporter_id, target_kind, target_id,
                                          city_id, reason, created_at)
          VALUES ('USER', ${clientX}, 'USER', gen_random_uuid(), ${surat}, 'SPAM', ${e2e.now()})`;
      }
      const r = await client(clientX, 'POST', '/reports', {
        targetKind: 'REVIEW',
        targetId: reviewX,
        reason: 'SPAM',
      });
      expect(r.status).toBe(429);
      expect(r.json.error.code).toBe('RATE_LIMITED');
      await e2e.db.sql`
        DELETE FROM moderation_reports WHERE reporter_id = ${clientX} AND reason = 'SPAM'`;
    });

    it('the cap holds when reports arrive together (counted inside the transaction)', async () => {
      const surat = await cityIdOf(e2e, 'Surat');
      // proA already filed 2 today (proOnReview, proOnY): 7 more leaves room for exactly one.
      for (let i = 0; i < 7; i++) {
        await e2e.db.sql`
          INSERT INTO moderation_reports (reporter_kind, reporter_id, target_kind, target_id,
                                          city_id, reason, created_at)
          VALUES ('PHOTOGRAPHER', ${proA}, 'USER', gen_random_uuid(), ${surat}, 'SPAM',
                  ${e2e.now()})`;
      }
      tick();
      const token = await tokenFor(e2e, 'PHOTOGRAPHER', proA);
      const both = await Promise.all(
        [
          { targetKind: 'REVIEW', targetId: reviewX, reason: 'SPAM' },
          { targetKind: 'USER', targetId: clientX, bookingId: bookingX, reason: 'SPAM' },
        ].map((body) => e2e.call('POST', '/pro/reports', { token, body })),
      );
      expect(both.map((r) => r.status).sort()).toEqual([201, 429]);
      await e2e.db.sql`
        DELETE FROM moderation_reports WHERE reporter_id = ${proA} AND reason = 'SPAM'`;
    });

    it('a REVIEW report keeps the review as it stood when filed', async () => {
      const r = await pro(proA, '/pro/reports', {
        targetKind: 'REVIEW',
        targetId: reviewX,
        reason: 'FALSE_INFORMATION',
      });
      expect(r.status).toBe(201);
      reports.proOnReviewX = r.json.data.id;
      const [row] = await e2e.db.sql<{ reported_rating: number; reported_comment: string }[]>`
        SELECT reported_rating, reported_comment FROM moderation_reports
        WHERE id = ${reports.proOnReviewX}`;
      expect(row).toEqual({ reported_rating: 4, reported_comment: 'Lovely candid shots' });
    });

    it('every report is an outbox event', async () => {
      const opened = (await events('report.opened')).map((e) => e.aggregate_id);
      expect(opened).toEqual(expect.arrayContaining(Object.values(reports)));
    });
  });

  describe('the moderation desk', () => {
    it('opens for QM, support and city managers only', async () => {
      for (const who of ['readOnly', 'finance', 'ops'] as const) {
        expect((await desk(who, '/reports')).status, who).toBe(403);
      }
      for (const who of ['qm', 'support', 'cmSurat', 'admin'] as const) {
        expect((await desk(who, '/reports')).status, who).toBe(200);
      }
    });

    it('lists the open reports of the caller’s cities, oldest first, in keyset pages', async () => {
      const first = await desk('support', '/reports?limit=3');
      expect(first.json.data.items.map((i: Json) => i.id)).toEqual([
        reports.proOnReview,
        reports.xOnReview,
        reports.yOnPro,
      ]);
      expect(first.json.data.items[0]).toMatchObject({
        targetKind: 'REVIEW',
        targetName: 'Asha Patel',
        reporterKind: 'PHOTOGRAPHER',
        reporterName: 'Asha Patel',
        cityName: 'Surat',
        status: 'OPEN',
      });
      const next = await desk(
        'support',
        `/reports?limit=3&cursor=${first.json.data.nextCursor as string}`,
      );
      expect(next.json.data.items.map((i: Json) => i.id)).toEqual([
        reports.proOnY,
        reports.proOnReviewX,
      ]);
      expect(next.json.data.nextCursor).toBeNull();
    });

    it("another city's manager sees none of them, and a report id answers 404", async () => {
      const list = await desk('cmMumbai', '/reports?status=ALL');
      expect(list.json.data.items).toEqual([]);
      const one = await desk('cmMumbai', `/reports/${reports.proOnReview}`);
      expect(one.status).toBe(404);
      expect(one.json.error.code).toBe('REPORT_NOT_FOUND');
      const hide = await decide('cmMumbai', reports.proOnReview, {
        decision: 'HIDE',
        note: 'Abusive',
      });
      expect(hide.status).toBe(404);
    });

    it('shows a review report with the review, its author and what can be decided', async () => {
      const r = await desk('qm', `/reports/${reports.proOnReview}`);
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({
        review: {
          id: reviewY,
          rating: 2,
          isPublished: true,
          photographerName: 'Asha Patel',
          authorName: 'Rohan Shah',
        },
        reportedReview: {
          rating: 2,
          comment: 'Late and rude. Call or mail , see or for a refund',
        },
        person: { kind: 'USER', id: clientY, warnings: 0 },
        otherOpenReports: 1,
        allowedDecisions: ['HIDE', 'KEEP', 'WARN', 'DISMISS'],
        history: [],
      });
    });

    it('HIDE unpublishes the review, closes both reports on it, audits, and recomputes the rating', async () => {
      const r = await decide('qm', reports.proOnReview, {
        decision: 'HIDE',
        note: 'Abusive and shares contact details',
      });
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({
        status: 'ACTIONED',
        decision: 'HIDE',
        review: { isPublished: false },
        allowedDecisions: [],
        history: [{ decision: 'HIDE', reportsClosed: 2, staffName: 'Test QUALITY_MANAGER' }],
      });
      const other = await desk('qm', `/reports/${reports.xOnReview}`);
      expect(other.json.data).toMatchObject({ status: 'ACTIONED', decision: 'HIDE' });

      const audit = await e2e.db.sql<{ actor_id: string; entity_id: string; after_state: Json }[]>`
        SELECT actor_id, entity_id, after_state FROM audit_logs WHERE action = 'moderation.decide'`;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_id: staff.qm,
        entity_id: reports.proOnReview,
        after_state: { status: 'ACTIONED', decision: 'HIDE', review_published: false },
      });
      expect((await events('review.hidden')).at(-1)?.payload).toMatchObject({
        review_id: reviewY,
        photographer_id: proA,
      });

      await drainOutbox(e2e);
      expect(await metrics(proA)).toEqual({ rating_avg_bps: 4000, rating_count: 1 });
      const mine = await client(clientY, 'GET', `/bookings/${bookingY}/review`);
      expect(mine.json.data).toMatchObject({ isPublished: false, canEdit: false });
      const edit = await client(clientY, 'POST', `/bookings/${bookingY}/review`, { rating: 5 });
      expect(edit.status).toBe(409);
      expect(edit.json.error.code).toBe('REVIEW_HIDDEN');
      const report = await client(clientX, 'POST', '/reports', {
        targetKind: 'REVIEW',
        targetId: reviewY,
        reason: 'SPAM',
      });
      expect(report.status).toBe(404);
    });

    it('a decided report cannot be decided again', async () => {
      const r = await decide('qm', reports.proOnReview, { decision: 'KEEP', note: 'Second look' });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('REPORT_ALREADY_DECIDED');
    });

    it('the Surat city manager warns the photographer; the warning is recorded and emitted', async () => {
      const notReview = await decide('cmSurat', reports.yOnPro, {
        decision: 'HIDE',
        note: 'Not a review',
      });
      expect(notReview.status).toBe(422);
      expect(notReview.json.error.code).toBe('DECISION_NOT_ALLOWED');
      const r = await decide('cmSurat', reports.yOnPro, {
        decision: 'WARN',
        note: 'Spoke to the photographer about conduct',
      });
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({
        status: 'ACTIONED',
        decision: 'WARN',
        person: { kind: 'PHOTOGRAPHER', id: proA, name: 'Asha Patel', warnings: 1 },
      });
      expect((await events('moderation.warning_issued')).at(-1)).toMatchObject({
        aggregate_id: proA,
        payload: { warned_kind: 'PHOTOGRAPHER', report_id: reports.yOnPro },
      });
    });

    it('KEEP leaves the review up, records who looked, and closes it to edits', async () => {
      const r = await decide('qm', reports.proOnReviewX, {
        decision: 'KEEP',
        note: 'A fair account of the shoot',
      });
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({
        status: 'DISMISSED',
        decision: 'KEEP',
        review: { id: reviewX, isPublished: true },
        reportedReview: { rating: 4, comment: 'Lovely candid shots' },
      });
      await drainOutbox(e2e);
      expect(await metrics(proA)).toEqual({ rating_avg_bps: 4000, rating_count: 1 });
      const edit = await client(clientX, 'POST', `/bookings/${bookingX}/review`, { rating: 1 });
      expect(edit.status).toBe(409);
      expect(edit.json.error.code).toBe('REVIEW_MODERATED');
    });

    it('support dismisses the last one and the queue is empty', async () => {
      const r = await decide('support', reports.proOnY, {
        decision: 'DISMISS',
        note: 'No evidence of harassment',
      });
      expect(r.status).toBe(200);
      expect(r.json.data.status).toBe('DISMISSED');
      expect((await desk('support', '/reports')).json.data.items).toEqual([]);
      const decided = await desk('support', '/reports?status=DECIDED');
      expect(decided.json.data.items.map((i: Json) => i.decision)).toEqual([
        'DISMISS',
        'KEEP',
        'WARN',
        'HIDE',
        'HIDE',
      ]);
      const [actions] = await e2e.db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM moderation_actions`;
      expect(actions?.n).toBe(4);
    });
  });

  describe('blocking a photographer', () => {
    it('only one who worked on your booking; idempotent; listed', async () => {
      const never = await client(clientX, 'POST', '/me/blocks', { photographerId: proB });
      expect(never.status).toBe(404);
      expect(never.json.error.code).toBe('PHOTOGRAPHER_NOT_FOUND');
      for (let i = 0; i < 2; i++) {
        const r = await client(clientX, 'POST', '/me/blocks', { photographerId: proA });
        expect(r.status).toBe(200);
        expect(r.json.data).toMatchObject({ photographerId: proA, name: 'Asha Patel' });
      }
      expect((await events('client_block.added')).map((e) => e.aggregate_id)).toEqual([clientX]);
      const list = await client(clientX, 'GET', '/me/blocks');
      expect(list.json.data.map((b: Json) => b.photographerId)).toEqual([proA]);
    });

    it("the blocked photographer is not offered the client's next booking; another is", async () => {
      const start = new Date(e2e.now().getTime() + 5 * DAY);
      const next = (await bookAndPay(e2e, clientX, start)).id as string;
      const offersOf = async (proId: string) =>
        (
          (
            await e2e.call('GET', '/pro/offers', {
              token: await tokenFor(e2e, 'PHOTOGRAPHER', proId),
            })
          ).json.data as Json[]
        ).map((o) => o.bookingId);
      expect(await offersOf(proA)).not.toContain(next);
      expect(await offersOf(proB)).toContain(next);

      const early = await client(clientX, 'POST', `/bookings/${next}/review`, { rating: 5 });
      expect(early.status).toBe(409);
      expect(early.json.error.code).toBe('BOOKING_NOT_DELIVERED');
    });

    it('unblocking is idempotent and emitted once', async () => {
      for (let i = 0; i < 2; i++) {
        const r = await client(clientX, 'POST', `/me/blocks/${proA}/unblock`);
        expect(r.status).toBe(200);
        expect(r.json.data).toEqual({ photographerId: proA, blocked: false });
      }
      expect(await events('client_block.removed')).toHaveLength(1);
      expect((await client(clientX, 'GET', '/me/blocks')).json.data).toEqual([]);
    });
  });
});
