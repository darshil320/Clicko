import type { StaffRole } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SecretBox } from './modules/admin/auth/secret-box';
import { base32Decode } from './modules/admin/auth/totp';
import { BookingsService } from './modules/bookings/bookings.service';
import { walkTo } from './modules/media/__tests__/media-fixtures';
import { RefundsService } from './modules/refunds/refunds.service';
import { ReviewsService } from './modules/refunds/reviews.service';
import { SlaService } from './modules/sla/sla.service';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  idemKey,
  insertClient,
  tokenFor,
} from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff, cityIdOf, codeFor, staffToken } from './test-support/staff-fixtures';

/** Monday 7 Dec 2026, 10:00 IST. */
const NOW = new Date('2026-12-07T04:30:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const NOTE = 'Both cards corrupted; the photographer sent the card reader logs';

type Who = 'qm' | 'qm2' | 'cm' | 'cmMumbai' | 'ops' | 'readOnly' | 'finance' | 'admin';
type Which = 'uploading' | 'processing' | 'qa' | 'early';

/**
 * ADR-0030 D2 — the staff routes to a lost shoot (DOMAIN §2: UPLOADING / PROCESSING / QA, STAFF
 * confirms). The Quality Manager or the booking's city manager confirms, four-eyes in one request
 * (their fresh code plus a second QM / finance / super admin with theirs). A complete loss ends
 * the booking and sends everything paid back by rule (T&C §5.5), replacing refunds still waiting
 * or failed; `booking.data_loss` accrues the photographer's full payout. A partial loss leaves the
 * booking on the delivery path, refunds the affected share as far as it can now and leaves the
 * rest as a review item. Audited, city-scoped, idempotent.
 */
describe.runIf(TEST_DATABASE_URL)('data loss confirmed by staff', () => {
  let e2e: E2eApp;
  let pro: string;
  let clientId: string;
  const staff = {} as Record<Who, string>;
  const b = {} as Record<Which, { id: string; reference: string }>;
  const assignments = {} as Partial<Record<Which, string>>;
  const keys = { confirm: idemKey('data-loss') };

  /** A fresh code for every use: the clock steps past the last one first. */
  const code = () => {
    e2e.advance(30_000);
    return codeFor(e2e, TOTP);
  };
  const fourEyes = (co: Who) => ({
    code: code(),
    coApprover: { email: `${co}@clickco.test`, code: codeFor(e2e, TOTP) },
  });
  const post = async (who: Who, path: string, body?: unknown, key = idemKey('dl')) =>
    e2e.call('POST', path, {
      token: await staffToken(e2e, staff[who]),
      idempotencyKey: key,
      ...(body === undefined ? {} : { body }),
    });
  const confirm = (who: Who, which: Which, co: Who = 'qm2', key?: string, note = NOTE) =>
    post(who, `/admin/bookings/${b[which].id}/data-loss`, { note, ...fourEyes(co) }, key);
  const partial = (who: Who, which: Which, bps: number, co: Who = 'finance', key?: string) =>
    post(
      who,
      `/admin/bookings/${b[which].id}/partial-loss`,
      { affectedProportionBps: bps, note: NOTE, ...fourEyes(co) },
      key,
    );
  const status = async (which: Which) =>
    (
      await e2e.db.sql<{ status: string }[]>`SELECT status FROM bookings WHERE id = ${b[which].id}`
    )[0]?.status;
  const refundsOf = (which: Which) =>
    e2e.db.sql<Json[]>`
      SELECT id, status, reason_code, amount_paise::int AS amount, payment_id, requested_by_kind,
             rejected_by, decision_note
      FROM refunds WHERE booking_id = ${b[which].id} ORDER BY created_at, id`;
  const capturedOn = async (which: Which): Promise<number> => {
    const [row] = await e2e.db.sql<{ paise: string }[]>`
      SELECT coalesce(sum(captured_paise), 0)::text AS paise FROM payments
      WHERE booking_id = ${b[which].id}`;
    return Number(row?.paise ?? 0);
  };
  const walkFor = async (which: Which, to: 'UPLOADING' | 'PROCESSING' | 'QA') => {
    const bookingId = b[which].id;
    await walkTo(e2e, bookingId, assignments[which] as string, 'CHECKED_OUT', 80);
    const path = (['UPLOADING', 'PROCESSING', 'QA'] as const).slice(
      0,
      ['UPLOADING', 'PROCESSING', 'QA'].indexOf(to) + 1,
    );
    for (const next of path) {
      const at = e2e.now();
      await e2e.db.sql.begin((tx) =>
        e2e.get(BookingsService).transition(tx, {
          bookingId,
          to: next,
          actor: { kind: next === 'UPLOADING' ? 'PHOTOGRAPHER' : 'SYSTEM', id: null },
          occurredAt: at,
          reason: 'data loss test',
        }),
      );
    }
    await drainOutbox(e2e);
  };

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    const surat = await cityIdOf(e2e, 'Surat');
    const mumbai = await cityIdOf(e2e, 'Mumbai');
    const box = new SecretBox(e2e.env.STAFF_TOTP_KEY);
    const make = async (who: Who, role: StaffRole, city: string | null) => {
      const id = (await bootstrapStaff(e2e, `${who}@clickco.test`, role, city)).id;
      staff[who] = id;
      await e2e.db.sql`
        UPDATE staff_users SET totp_secret = ${box.seal(base32Decode(TOTP), id)} WHERE id = ${id}`;
    };
    await make('qm', 'QUALITY_MANAGER', null);
    await make('qm2', 'QUALITY_MANAGER', null);
    await make('cm', 'CITY_MANAGER', surat);
    await make('cmMumbai', 'CITY_MANAGER', mumbai);
    await make('ops', 'OPS_AGENT', surat);
    await make('readOnly', 'READ_ONLY', null);
    await make('finance', 'FINANCE', null);
    await make('admin', 'SUPER_ADMIN', null);
    pro = await insertPhotographer(e2e.db.sql, {
      phone: '+919999178001',
      name: 'Asha Patel',
      km: 3,
      categories: [{ code: 'FOOD', tier: 'EXPERT' }],
    });
    clientId = await insertClient(e2e, '+919999278001');
    for (const [which, days] of [
      ['uploading', 4],
      ['processing', 5],
      ['qa', 6],
      ['early', 7],
    ] as const) {
      const booked = await bookAndPay(e2e, clientId, new Date(NOW.getTime() + days * DAY));
      b[which] = { id: booked.id as string, reference: booked.reference as string };
      if (which !== 'early') assignments[which] = await acceptOffer(e2e, pro, booked.id as string);
    }
    await walkFor('uploading', 'UPLOADING');
    await walkFor('processing', 'PROCESSING');
    await walkFor('qa', 'QA');
    // A second captured payment on the PROCESSING and QA bookings (an extension paid on its own):
    // what goes back is then above the Quality Manager's ceiling (half the booking, or ₹5,000).
    for (const which of ['processing', 'qa'] as const) {
      await e2e.db.sql`
        INSERT INTO payments (booking_id, user_id, purpose, status, amount_paise, captured_paise,
                              provider, provider_order_id, provider_payment_id, captured_at)
        SELECT booking_id, user_id, 'EXTENSION', 'CAPTURED', 50000, 50000, provider,
               ${`order_dl_extra_${which}`}, ${`pay_dl_extra_${which}`}, ${e2e.now()}
        FROM payments WHERE booking_id = ${b[which].id} LIMIT 1`;
    }
  }, 300_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('who may confirm, and when', () => {
    it('only the Quality Manager or the city manager, in the booking’s city', async () => {
      expect((await confirm('ops', 'uploading')).status).toBe(403);
      expect((await confirm('readOnly', 'uploading')).status).toBe(403);
      expect((await confirm('finance', 'uploading')).status).toBe(403);
      // Another city's booking answers like a missing one.
      expect((await confirm('cmMumbai', 'uploading')).status).toBe(404);
      expect(await status('uploading')).toBe('UPLOADING');
    });

    it('needs a note that says what was lost, and both codes', async () => {
      expect((await confirm('qm', 'uploading', 'qm2', undefined, 'lost')).status).toBe(400);
      const noCodes = await post('qm', `/admin/bookings/${b.uploading.id}/data-loss`, {
        note: NOTE,
      });
      expect(noCodes.status).toBe(400);
      expect(await status('uploading')).toBe('UPLOADING');
    });

    it('a second person, never the confirmer: a super admin cannot co-approve themselves', async () => {
      const self = await confirm('admin', 'uploading', 'admin');
      expect(self.status).toBe(403);
      expect(self.json.error.code).toBe('CO_APPROVER_INVALID');
      const ops = await confirm('qm', 'uploading', 'ops');
      expect(ops.status).toBe(403);
      expect(ops.json.error.code).toBe('CO_APPROVER_INVALID');
      const wrong = await post('qm', `/admin/bookings/${b.uploading.id}/data-loss`, {
        note: NOTE,
        code: '000000',
        coApprover: { email: 'qm2@clickco.test', code: codeFor(e2e, TOTP) },
      });
      expect(wrong.status).toBe(422);
      expect(await status('uploading')).toBe('UPLOADING');
      expect(await refundsOf('uploading')).toEqual([]);
    });

    it('only between upload and QA: a booking still being dispatched is refused', async () => {
      const res = await confirm('qm', 'early');
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('DATA_LOSS_WRONG_STAGE');
      expect(res.json.error.message).toMatch(/uploading, processing or in QA/);
      expect(await status('early')).toBe('DISPATCHING');
      const part = await partial('qm', 'early', 3_000);
      expect(part.status).toBe(409);
      expect(part.json.error.code).toBe('DATA_LOSS_WRONG_STAGE');
    });
  });

  describe('complete loss, from upload: refunds still waiting or failed are replaced', () => {
    let paid: number;
    let waiting: string;
    let failed: string;
    let refundId: string;
    let confirmBody: Json;
    let breachRefund: string;
    const TIED = 15_000;

    it('sets up a refund waiting for approval and one that failed at the gateway', async () => {
      const refunds = e2e.get(RefundsService);
      // ₹100.13: the sandbox fails a first attempt whose paise end in 13.
      const [toFail] = await refunds.request({
        bookingId: b.uploading.id,
        amountPaise: 10_013n,
        reasonCode: 'GOODWILL',
        note: 'Sorry for the wait',
        staffId: staff.ops,
      });
      e2e.advance(30_000);
      const approved = await post('finance', `/admin/refunds/${toFail?.id}/approve`, {
        code: codeFor(e2e, TOTP),
      });
      expect(approved.json.data.status).toBe('FAILED');
      const [ask] = await refunds.request({
        bookingId: b.uploading.id,
        amountPaise: 20_000n,
        reasonCode: 'GOODWILL',
        note: 'Late reply',
        staffId: staff.ops,
      });
      failed = toFail?.id ?? '';
      waiting = ask?.id ?? '';
      // A refund raised by settling a review item (e.g. a late-delivery remedy): its settlement is
      // applied only when it completes, so a data loss must leave it alone.
      const [review] = await e2e.db.sql<{ event_id: string }[]>`
        INSERT INTO domain_events (event_type, aggregate_kind, aggregate_id, payload, occurred_at)
        VALUES ('booking.needs_review', 'booking', ${b.uploading.id},
                ${e2e.db.sql.json({ booking_id: b.uploading.id, reason: 'GOODWILL_CHECK' })},
                ${e2e.now()})
        RETURNING event_id::text`;
      await e2e.get(ReviewsService).settle(
        review?.event_id ?? '',
        {
          outcome: 'REFUND_REQUESTED',
          amountPaise: BigInt(TIED),
          refundReason: 'GOODWILL',
          creditPaise: 0n,
          note: 'Goodwill for the wait',
        },
        { staffId: staff.finance, roles: ['FINANCE'] },
      );
      const [tied] = await e2e.db.sql<{ id: string }[]>`
        SELECT id FROM refunds
        WHERE booking_id = ${b.uploading.id} AND review_resolution_id IS NOT NULL`;
      breachRefund = tied?.id ?? '';
      paid = await capturedOn('uploading');
    });

    it('the QM and finance confirm: the booking ends and everything paid goes back', async () => {
      confirmBody = { note: NOTE, ...fourEyes('finance') };
      const res = await post(
        'qm',
        `/admin/bookings/${b.uploading.id}/data-loss`,
        confirmBody,
        keys.confirm,
      );
      expect(res.status).toBe(200);
      // Everything paid, less the review-tied refund that stays in flight on its own.
      expect(res.json.data).toMatchObject({
        bookingId: b.uploading.id,
        status: 'DATA_LOSS',
        refundPaise: paid - TIED,
      });
      expect(res.json.data.supersededRefundIds.sort()).toEqual([failed, waiting].sort());
      expect(res.json.data.refundIds).toHaveLength(1);
      refundId = res.json.data.refundIds[0] as string;
      expect(await status('uploading')).toBe('DATA_LOSS');

      const rows = await refundsOf('uploading');
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of [failed, waiting]) {
        expect(byId.get(id)).toMatchObject({
          status: 'REJECTED',
          rejected_by: staff.qm,
          decision_note: 'Superseded by data loss',
        });
      }
      // Issued by rule (T&C §5.5): no approver, sent to the gateway at once.
      expect(byId.get(refundId)).toMatchObject({
        status: 'COMPLETED',
        reason_code: 'DATA_LOSS',
        amount: paid - TIED,
        requested_by_kind: 'SYSTEM',
      });
      expect(byId.get(breachRefund)).toMatchObject({ status: 'REQUESTED', amount: TIED });
      const rejected = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events
        WHERE event_type = 'refund.rejected' AND aggregate_id IN ${e2e.db.sql([failed, waiting])}`;
      expect(rejected).toHaveLength(2);
      expect(rejected[0]?.payload).toMatchObject({ note: 'Superseded by data loss' });

      const [event] = await e2e.db.sql<{ actor_kind: string; actor_id: string }[]>`
        SELECT actor_kind, actor_id FROM booking_status_events
        WHERE booking_id = ${b.uploading.id} AND to_status = 'DATA_LOSS'`;
      expect(event).toMatchObject({ actor_kind: 'STAFF', actor_id: staff.qm });
      const events = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events
        WHERE event_type = 'booking.data_loss' AND aggregate_id = ${b.uploading.id}`;
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({
        from_status: 'UPLOADING',
        actor_kind: 'STAFF',
        loss_kind: 'COMPLETE',
        affected_proportion_bps: 10_000,
        refund_amount_paise: paid - TIED,
      });
      const audit = await e2e.db.sql<Json[]>`
        SELECT actor_id, entity_kind, entity_id, before_state, after_state FROM audit_logs
        WHERE action = 'booking.data_loss'`;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_id: staff.qm,
        entity_kind: 'booking',
        entity_id: b.uploading.id,
        before_state: { status: 'UPLOADING' },
        after_state: {
          status: 'DATA_LOSS',
          note: NOTE,
          refund_amount_paise: paid - TIED,
          refund_ids: [refundId],
          superseded_refund_ids: expect.arrayContaining([failed, waiting]),
          co_approved_by: staff.finance,
          step_up: 'TOTP',
        },
      });
    });

    it('a retried click replays; a second confirmation is refused', async () => {
      const replay = await post(
        'qm',
        `/admin/bookings/${b.uploading.id}/data-loss`,
        confirmBody,
        keys.confirm,
      );
      expect(replay.status).toBe(200);
      expect(replay.headers.get('idempotent-replayed')).toBe('true');
      expect(replay.json.data.refundIds).toEqual([refundId]);
      const again = await confirm('cm', 'uploading', 'finance');
      expect(again.status).toBe(409);
      expect(again.json.error.code).toBe('DATA_LOSS_WRONG_STAGE');
      expect(
        (await refundsOf('uploading')).filter((r) => r.reason_code === 'DATA_LOSS'),
      ).toHaveLength(1);
    });

    it('an SLA clock firing before the outbox runs is cancelled, not breached', async () => {
      const [clock] = await e2e.db.sql<{ id: string; due_at: Date }[]>`
        SELECT id, due_at FROM sla_clocks
        WHERE booking_id = ${b.uploading.id} AND state = 'ARMED' ORDER BY due_at LIMIT 1`;
      expect(clock).toBeDefined();
      const wait = (clock?.due_at.getTime() ?? 0) - e2e.now().getTime();
      if (wait > 0) e2e.advance(wait + 1_000);
      expect(await e2e.get(SlaService).fire(clock?.id ?? '')).toBe('SKIPPED');
      const [after] = await e2e.db.sql<{ state: string }[]>`
        SELECT state FROM sla_clocks WHERE id = ${clock?.id ?? ''}`;
      expect(after?.state).toBe('CANCELLED');
      const missed = await e2e.db.sql`
        SELECT 1 FROM domain_events
        WHERE aggregate_id = ${clock?.id ?? ''} AND event_type LIKE 'sla.%'`;
      expect(missed).toHaveLength(0);
    });

    it('the outbox accrues the photographer’s full payout', async () => {
      await drainOutbox(e2e);
      const [payout] = await e2e.db.sql<Json[]>`
        SELECT status, basis, basis_bps, gross_paise::text AS gross FROM payouts
        WHERE booking_id = ${b.uploading.id}`;
      const [offer] = await e2e.db.sql<{ paise: string }[]>`
        SELECT offered_payout_paise::text AS paise FROM dispatch_attempts
        WHERE booking_id = ${b.uploading.id} AND outcome = 'ACCEPTED'`;
      expect(payout).toEqual({
        status: 'PENDING',
        basis: 'DATA_LOSS',
        basis_bps: 10_000,
        gross: offer?.paise,
      });
      const armed = await e2e.db.sql`
        SELECT 1 FROM sla_clocks WHERE booking_id = ${b.uploading.id} AND state = 'ARMED'`;
      expect(armed).toHaveLength(0);
    });

    it('the client sees everything they paid come back', async () => {
      const money = await e2e.call('GET', `/bookings/${b.uploading.id}/money`, {
        token: await tokenFor(e2e, 'USER', clientId),
      });
      expect(money.status).toBe(200);
      expect(money.json.data.refunds).toEqual([
        expect.objectContaining({ amountPaise: paid - TIED, status: 'REFUNDED' }),
      ]);
      const [ledger] = await e2e.db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ledger_entries
        WHERE booking_id = ${b.uploading.id} AND txn_kind = 'REFUND_ISSUED'`;
      expect(ledger?.n).toBeGreaterThan(0);
    });
  });

  it('from PROCESSING, by the city manager with finance: both payments go back', async () => {
    const paid = await capturedOn('processing');
    // Above the Quality Manager's ceiling only finance (or a super admin) may be the second person.
    const qm = await confirm('cm', 'processing', 'qm2');
    expect(qm.status).toBe(403);
    expect(qm.json.error.code).toBe('CO_APPROVER_INVALID');
    expect(qm.json.error.message).toMatch(/finance/);
    expect(await status('processing')).toBe('PROCESSING');
    const res = await confirm('cm', 'processing', 'finance');
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ status: 'DATA_LOSS', refundPaise: paid });
    expect(res.json.data.refundIds).toHaveLength(2);
    const rows = await refundsOf('processing');
    expect(rows.map((r) => r.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(rows.reduce((s, r) => s + (r.amount as number), 0)).toBe(paid);
    expect(new Set(rows.map((r) => r.payment_id)).size).toBe(2);
    const [event] = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events
      WHERE event_type = 'booking.data_loss' AND aggregate_id = ${b.processing.id}`;
    expect(event?.payload).toMatchObject({ from_status: 'PROCESSING', loss_kind: 'COMPLETE' });
  });

  describe('partial loss, at QA: the booking carries on', () => {
    let total: number;
    let paid: number;

    it('refunds the affected share as far as it can now; the rest waits for the balance', async () => {
      const [row] = await e2e.db.sql<{ total: string }[]>`
        SELECT total_paise::text AS total FROM bookings WHERE id = ${b.qa.id}`;
      total = Number(row?.total);
      paid = await capturedOn('qa');
      const owed = Math.floor((total * 7_000 + 5_000) / 10_000);
      expect(owed).toBeGreaterThan(paid); // 70 % of a 50/50 booking: more than the advance

      const qm = await partial('qm', 'qa', 7_000, 'qm2');
      expect(qm.status).toBe(403);
      expect(qm.json.error.code).toBe('CO_APPROVER_INVALID');
      const res = await partial('qm', 'qa', 7_000);
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        bookingId: b.qa.id,
        status: 'QA',
        affectedProportionBps: 7_000,
        owedPaise: owed,
        refundPaise: paid,
        dueAfterBalancePaise: owed - paid,
      });
      expect(await status('qa')).toBe('QA');
      const rows = await refundsOf('qa');
      expect(rows.map((r) => [r.status, r.reason_code])).toEqual([
        ['COMPLETED', 'DATA_LOSS'],
        ['COMPLETED', 'DATA_LOSS'],
      ]);
      expect(rows.reduce((sum, r) => sum + (r.amount as number), 0)).toBe(paid);
      const [event] = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events
        WHERE event_type = 'booking.partial_data_loss' AND aggregate_id = ${b.qa.id}`;
      expect(event?.payload).toMatchObject({
        loss_kind: 'PARTIAL',
        affected_proportion_bps: 7_000,
        refund_amount_paise: owed,
        refunded_now_paise: paid,
        due_after_balance_paise: owed - paid,
      });
      const audit = await e2e.db.sql<Json[]>`
        SELECT after_state FROM audit_logs WHERE action = 'booking.partial_loss'`;
      expect(audit[0]?.after_state).toMatchObject({
        affected_proportion_bps: 7_000,
        co_approved_by: staff.finance,
      });
    });

    it('the rest is a review item on the "To settle" desk, so it is not lost', async () => {
      const res = await e2e.call('GET', '/admin/reviews', {
        token: await staffToken(e2e, staff.finance),
      });
      expect(res.status).toBe(200);
      const item = (res.json.data.items as Json[]).find((i) => i.bookingId === b.qa.id);
      expect(item).toMatchObject({ reason: 'PARTIAL_DATA_LOSS_REMAINDER' });
      expect(item?.title).toMatch(/lost/i);
    });

    it('once per booking; the photographer is not paid on a partial loss until delivery', async () => {
      const again = await partial('qm', 'qa', 1_000);
      expect(again.status).toBe(409);
      expect(again.json.error.code).toBe('PARTIAL_LOSS_ALREADY_RECORDED');
      await drainOutbox(e2e);
      expect(await e2e.db.sql`SELECT 1 FROM payouts WHERE booking_id = ${b.qa.id}`).toHaveLength(0);
    });
  });

  it('after a partial loss the rest can still be found lost: a complete loss refunds what is left', async () => {
    const res = await confirm('qm', 'qa', 'qm2');
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ status: 'DATA_LOSS', refundPaise: 0, refundIds: [] });
    expect(await status('qa')).toBe('DATA_LOSS');
    // Nothing moved, so a second Quality Manager was enough; the partial-loss remainder is closed.
    const [closed] = await e2e.db.sql<Json[]>`
      SELECT r.outcome, r.note, r.resolved_by FROM review_resolutions r
      JOIN domain_events e ON e.event_id = r.review_event_id
      WHERE e.aggregate_id = ${b.qa.id} AND e.payload->>'reason' = 'PARTIAL_DATA_LOSS_REMAINDER'`;
    expect(closed).toEqual({
      outcome: 'NO_ACTION',
      note: 'Superseded by data loss',
      resolved_by: staff.qm,
    });
  });

  it('every confirmation is guarded: four-eyes routes refuse an expired session too', async () => {
    e2e.advance(HOUR);
    const res = await e2e.call('POST', `/admin/bookings/${b.early.id}/partial-loss`, {
      idempotencyKey: idemKey('anon'),
      body: { affectedProportionBps: 1_000, note: NOTE, ...fourEyes('qm2') },
    });
    expect(res.status).toBe(401);
  });
});
