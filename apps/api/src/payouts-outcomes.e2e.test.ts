import { roundHalfUp } from '@clickco/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxSubscribers, type PublishedEvent } from './infra/outbox/outbox-subscribers';
import { SecretBox } from './modules/admin/auth/secret-box';
import { base32Decode } from './modules/admin/auth/totp';
import { BookingsService } from './modules/bookings/bookings.service';
import { walkTo } from './modules/media/__tests__/media-fixtures';
import { BANK_ACCOUNT_CIPHER, type BankAccountCipher } from './modules/payouts/bank-account-cipher';
import { PayoutsService } from './modules/payouts/payouts.service';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  fixAt,
  insertClient,
  proAction,
  setNow,
  tokenFor,
} from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff, codeFor, staffToken } from './test-support/staff-fixtures';

/** Monday 7 Dec 2026, 10:00 IST. */
const NOW = new Date('2026-12-07T04:30:00.000Z');
/** Monday 14 Dec 2026, 10:00 IST: the weekly payout run. */
const NEXT_MONDAY = new Date('2026-12-14T04:30:00.000Z');
const MIN = 60_000;
const DAY = 86_400_000;
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN);
const START_X = new Date(NOW.getTime() + 2 * DAY + 120 * MIN); // access denied
const START_Y = new Date(NOW.getTime() + 3 * DAY + 120 * MIN); // client absent
const TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const UTR = 'HDFCN26121400077';
let keySeq = 0;
const idem = () => `payout-outcomes-${String(++keySeq).padStart(6, '0')}`;

interface PayoutRow {
  id: string;
  status: string;
  basis: string;
  basis_bps: number;
  gross: string;
  net: string;
  tds: string;
  eligible_at: Date;
  withheld_reason: string | null;
}

/**
 * ADR-0027 D5: shoots that never reach delivery pay the photographer through the same payouts
 * row, batch, TDS and ledger as a delivered one — data loss in full (the third in a year withheld),
 * access denied at half, client absent at the booked payout without the waived waiting share —
 * each once however often the outbox redelivers. Then the Pro earnings list the paid transfer
 * with its TDS and only the UTR's last four characters.
 */
describe.runIf(TEST_DATABASE_URL)('payouts for undelivered shoots + Pro paid transfers', () => {
  let e2e: E2eApp;
  let proA: string;
  let proB: string;
  let finance: string;
  const ids: Record<'X' | 'Y' | 'D1' | 'D2' | 'D3', { booking: string; assignment: string }> =
    {} as never;

  const payoutOf = async (bookingId: string): Promise<PayoutRow | undefined> =>
    (
      await e2e.db.sql<PayoutRow[]>`
        SELECT id, status, basis, basis_bps, gross_paise::text AS gross, net_paise::text AS net,
               tds_paise::text AS tds, eligible_at, withheld_reason
        FROM payouts WHERE booking_id = ${bookingId}`
    )[0];
  const offerOf = async (bookingId: string): Promise<bigint> => {
    const [row] = await e2e.db.sql<{ paise: string }[]>`
      SELECT offered_payout_paise::text AS paise FROM dispatch_attempts
      WHERE booking_id = ${bookingId} AND outcome = 'ACCEPTED'`;
    if (!row) throw new Error(`no accepted offer on ${bookingId}`);
    return BigInt(row.paise);
  };
  const travelOf = async (bookingId: string): Promise<bigint> => {
    const [row] = await e2e.db.sql<{ paise: string }[]>`
      SELECT travel_amount_paise::text AS paise FROM booking_price_snapshots
      WHERE booking_id = ${bookingId} AND sequence = 1`;
    return BigInt(row?.paise ?? '0');
  };
  const eventAt = async (type: string, bookingId: string): Promise<Date> => {
    const [row] = await e2e.db.sql<{ occurred_at: Date }[]>`
      SELECT occurred_at FROM domain_events
      WHERE event_type = ${type} AND aggregate_id = ${bookingId} ORDER BY id LIMIT 1`;
    if (!row) throw new Error(`no ${type} on ${bookingId}`);
    return row.occurred_at;
  };
  const payoutEvents = (payoutId: string) =>
    e2e.db.sql<{ event_type: string; payload: Json }[]>`
      SELECT event_type, payload FROM domain_events
      WHERE aggregate_id = ${payoutId} AND event_type LIKE 'payout.%' ORDER BY id`;
  const staffPost = async (path: string, body?: unknown) =>
    e2e.call('POST', path, {
      token: await staffToken(e2e, finance),
      idempotencyKey: idem(),
      ...(body === undefined ? {} : { body }),
    });
  const code = () => {
    e2e.advance(30_000);
    return codeFor(e2e, TOTP);
  };
  const dataLoss = async (which: 'D1' | 'D2' | 'D3') => {
    const { booking, assignment } = ids[which];
    await walkTo(e2e, booking, assignment, 'CHECKED_OUT', 120);
    const bookings = e2e.get(BookingsService);
    for (const [to, kind] of [
      ['UPLOADING', 'PHOTOGRAPHER'],
      ['DATA_LOSS', 'STAFF'],
    ] as const) {
      const at = e2e.now();
      await e2e.db.sql.begin((tx) =>
        bookings.transition(tx, {
          bookingId: booking,
          to,
          actor: { kind, id: null },
          occurredAt: at,
          reason: 'payout outcomes test',
          ...(to === 'DATA_LOSS'
            ? { payload: { loss_kind: 'COMPLETE', affected_proportion_bps: 10_000 } }
            : {}),
        }),
      );
    }
    await drainOutbox(e2e);
  };
  const publishedEvent = async (type: string, bookingId: string): Promise<PublishedEvent> => {
    const [row] = await e2e.db.sql<
      {
        event_id: string;
        aggregate_kind: string;
        payload: Record<string, unknown>;
        occurred_at: Date;
      }[]
    >`
      SELECT event_id, aggregate_kind, payload, occurred_at FROM domain_events
      WHERE event_type = ${type} AND aggregate_id = ${bookingId} ORDER BY id LIMIT 1`;
    if (!row) throw new Error(`no ${type} on ${bookingId}`);
    return {
      eventId: row.event_id,
      eventType: type,
      aggregateKind: row.aggregate_kind,
      aggregateId: bookingId,
      payload: row.payload,
      occurredAt: row.occurred_at,
    };
  };
  const payoutHandler = (type: string) => {
    const sub = e2e
      .get(OutboxSubscribers)
      .subscribersOf(type)
      .find((s) => s.name.startsWith('payouts.'));
    if (!sub) throw new Error(`no payouts subscriber for ${type}`);
    return sub.handle;
  };

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    finance = (await bootstrapStaff(e2e, 'finance@clickco.test', 'FINANCE')).id;
    const box = new SecretBox(e2e.env.STAFF_TOTP_KEY);
    await e2e.db.sql`
      UPDATE staff_users SET totp_secret = ${box.seal(base32Decode(TOTP), finance)}
      WHERE id = ${finance}`;
    const food = [{ code: 'FOOD', tier: 'EXPERT' as const }];
    proA = await insertPhotographer(e2e.db.sql, {
      phone: '+919999176101',
      name: 'Asha Patel',
      km: 3,
      categories: food,
    });
    const client = await insertClient(e2e, '+919999276101');
    const starts = {
      X: START_X,
      Y: START_Y,
      D1: new Date(NOW.getTime() + 4 * DAY),
      D2: new Date(NOW.getTime() + 5 * DAY),
      D3: new Date(NOW.getTime() + 6 * DAY),
    } as const;
    for (const which of ['X', 'Y', 'D1', 'D2', 'D3'] as const) {
      const booking = await bookAndPay(e2e, client, starts[which]);
      ids[which] = {
        booking: booking.id as string,
        assignment: await acceptOffer(e2e, proA, booking.id as string),
      };
    }
    // Registered after the dispatching so it is never offered (and never takes) these bookings.
    proB = await insertPhotographer(e2e.db.sql, {
      phone: '+919999176102',
      name: 'Bina Mehta',
      km: 4,
      categories: food,
    });
  }, 240_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('data loss (DOMAIN §2, G-13)', () => {
    it('pays the full payout, due 3 days after the loss was confirmed', async () => {
      await dataLoss('D1');
      const p = await payoutOf(ids.D1.booking);
      const lostAt = await eventAt('booking.data_loss', ids.D1.booking);
      expect(p).toMatchObject({
        status: 'PENDING',
        basis: 'DATA_LOSS',
        basis_bps: 10_000,
        gross: (await offerOf(ids.D1.booking)).toString(),
        tds: '0',
        withheld_reason: null,
      });
      expect(p?.net).toBe(p?.gross);
      expect(p?.eligible_at.getTime()).toBe(lostAt.getTime() + 3 * DAY);
      const events = await payoutEvents(p?.id ?? '');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: 'payout.created',
        payload: { basis: 'DATA_LOSS', booking_id: ids.D1.booking, photographer_id: proA },
      });
    });

    it('the third loss within a year is withheld, with the reason, and ops is told', async () => {
      await dataLoss('D2');
      expect((await payoutOf(ids.D2.booking))?.status).toBe('PENDING');
      await dataLoss('D3');
      const p = await payoutOf(ids.D3.booking);
      expect(p).toMatchObject({ status: 'WITHHELD', basis: 'DATA_LOSS' });
      expect(p?.withheld_reason).toMatch(/number 3 .* 365 days/);
      const events = await payoutEvents(p?.id ?? '');
      expect(events.map((e) => e.event_type)).toEqual(['payout.withheld']);
      const alerts = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events WHERE event_type = 'ops.alert'
          AND payload->>'source_event_type' = 'payout.withheld'`;
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.payload).toMatchObject({
        booking_id: ids.D3.booking,
        severity: 'MEDIUM',
        details: { payout_id: p?.id, photographer_id: proA, basis: 'DATA_LOSS' },
      });
    });

    it('redelivery of the same event changes nothing (at-least-once outbox)', async () => {
      for (const which of ['D1', 'D3'] as const) {
        const before = await payoutOf(ids[which].booking);
        const event = await publishedEvent('booking.data_loss', ids[which].booking);
        await payoutHandler('booking.data_loss')(event);
        await payoutHandler('booking.data_loss')(event);
        expect(await payoutOf(ids[which].booking)).toEqual(before);
        expect(await payoutEvents(before?.id ?? '')).toHaveLength(1);
      }
    });
  });

  describe('access denied (T&C §7.2)', () => {
    it('confirmed by staff: half the payout, travel in full, rounded once, due 3 days later', async () => {
      setNow(e2e, plus(START_X, -5));
      expect(
        (await proAction(e2e, proA, ids.X.assignment, 'check-in', fixAt(0.05, 0))).status,
      ).toBe(200);
      const report = await proAction(e2e, proA, ids.X.assignment, 'access-denied', {
        note: 'Security will not let me in',
        ...fixAt(0.05, 0),
      });
      expect(report.status).toBe(201);
      // No payout on a report alone: only the staff confirmation ends the booking.
      await drainOutbox(e2e);
      expect(await payoutOf(ids.X.booking)).toBeUndefined();
      const confirmed = await e2e.call(
        'POST',
        `/dev/assignments/${ids.X.assignment}/confirm-incident`,
        { body: { kind: 'ACCESS_DENIED' } },
      );
      expect(confirmed.json.data?.bookingStatus).toBe('ACCESS_DENIED');
      await drainOutbox(e2e);
      const p = await payoutOf(ids.X.booking);
      const deniedAt = await eventAt('booking.access_denied', ids.X.booking);
      const travel = await travelOf(ids.X.booking);
      const offer = await offerOf(ids.X.booking);
      expect(p).toMatchObject({
        status: 'PENDING',
        basis: 'ACCESS_DENIED',
        basis_bps: 5_000,
        gross: (roundHalfUp(offer - travel, 2n) + travel).toString(),
      });
      expect(p?.eligible_at.getTime()).toBe(deniedAt.getTime() + 3 * DAY);
    });

    it('two deliveries at once still make one payout and one event', async () => {
      const before = await payoutOf(ids.X.booking);
      const event = await publishedEvent('booking.access_denied', ids.X.booking);
      const handle = payoutHandler('booking.access_denied');
      await Promise.all([handle(event), handle(event)]);
      expect(await payoutOf(ids.X.booking)).toEqual(before);
      expect(await payoutEvents(before?.id ?? '')).toHaveLength(1);
      expect(
        await e2e.get(PayoutsService).accrueForOutcome(ids.X.booking, 'ACCESS_DENIED', NOW),
      ).toBe('EXISTS');
    });

    it('an outcome the booking did not reach accrues nothing, and ops is told once', async () => {
      const service = e2e.get(PayoutsService);
      expect(await service.accrueForOutcome(ids.Y.booking, 'DATA_LOSS', e2e.now())).toBe(
        'WRONG_OUTCOME',
      );
      expect(await service.accrueForOutcome(ids.Y.booking, 'DATA_LOSS', e2e.now())).toBe(
        'WRONG_OUTCOME',
      );
      expect(await payoutOf(ids.Y.booking)).toBeUndefined();
      const alerts = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events WHERE event_type = 'ops.alert'
          AND aggregate_id = ${ids.Y.booking}
          AND payload->>'source_event_type' = 'payout.not_accrued'`;
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.payload).toMatchObject({
        severity: 'HIGH',
        details: { basis: 'DATA_LOSS' },
      });
    });
  });

  describe('client absent (T&C §3.8)', () => {
    it('the booked payout, without the share of the waiting charge waived at review', async () => {
      setNow(e2e, plus(START_Y, -5));
      await proAction(e2e, proA, ids.Y.assignment, 'check-in', fixAt(0.05, 0));
      setNow(e2e, plus(START_Y, 40));
      const waiting = await proAction(e2e, proA, ids.Y.assignment, 'waiting', {
        minutes: 35,
        note: 'Nobody at the venue',
        ...fixAt(0, 0),
      });
      expect(waiting.status).toBe(201);
      const [share] = await e2e.db.sql<{ paise: string }[]>`
        SELECT expected_payout_paise::text AS paise FROM booking_price_snapshots
        WHERE booking_id = ${ids.Y.booking} AND sequence = 2`;
      expect(BigInt(share?.paise ?? '0')).toBeGreaterThan(0n);
      setNow(e2e, plus(START_Y, 61));
      const absent = await proAction(e2e, proA, ids.Y.assignment, 'client-absent', {
        ...fixAt(0.05, 0),
        note: 'Venue locked, phone off',
      });
      expect(absent.status).toBe(200);
      await drainOutbox(e2e);
      // The photographer's own report pays nothing until staff settle its review.
      expect(await payoutOf(ids.Y.booking)).toBeUndefined();
      const [review] = await e2e.db.sql<{ event_id: string }[]>`
        SELECT event_id FROM domain_events WHERE event_type = 'booking.needs_review'
          AND aggregate_id = ${ids.Y.booking} AND payload->>'reason' = 'CLIENT_NON_ATTENDANCE'`;
      const settled = await staffPost(`/admin/reviews/${review?.event_id}/settle`, {
        outcome: 'NO_ACTION',
        note: 'Venue confirmed nobody came',
      });
      expect(settled.status).toBe(200);
      await drainOutbox(e2e);
      const p = await payoutOf(ids.Y.booking);
      const absentAt = await eventAt('assignment.client_absent_reported', ids.Y.booking);
      expect(p).toMatchObject({
        status: 'PENDING',
        basis: 'CLIENT_ABSENT',
        basis_bps: 10_000,
        gross: (await offerOf(ids.Y.booking)).toString(),
      });
      expect(p?.eligible_at.getTime()).toBe(absentAt.getTime() + 3 * DAY);
    });

    it('redelivered: still one payout', async () => {
      const before = await payoutOf(ids.Y.booking);
      const event = await publishedEvent('review.settled', ids.Y.booking);
      await payoutHandler('review.settled')(event);
      expect(await payoutOf(ids.Y.booking)).toEqual(before);
      expect(await payoutEvents(before?.id ?? '')).toHaveLength(1);
    });
  });

  describe('the same batch, TDS and ledger as a delivered payout (ADR-0026 D3)', () => {
    let batchId: string;

    it('the weekly batch takes every due outcome payout but never the withheld one', async () => {
      const cipher = e2e.get<BankAccountCipher>(BANK_ACCOUNT_CIPHER);
      await e2e.db.sql`
        INSERT INTO photographer_bank_accounts (photographer_id, account_holder, account_number_enc,
          account_last4, ifsc, bank_name, is_primary, verified_at)
        VALUES (${proA}, 'Asha Patel', ${cipher.seal('001234567890', proA)}, '7890',
                'HDFC0001234', 'HDFC Bank', true, now())`;
      await e2e.db.sql`UPDATE photographers SET pan_number = 'ABCPE1234F' WHERE id = ${proA}`;
      // Push one payout over the ₹30,000 single-payment limit so s.194C TDS (1 %) applies to it.
      await e2e.db.sql`
        UPDATE payouts SET gross_paise = 4000000, net_paise = 4000000
        WHERE booking_id = ${ids.X.booking}`;
      setNow(e2e, NEXT_MONDAY);
      const draft = await staffPost('/admin/payouts/batches', { kind: 'WEEKLY' });
      expect(draft.status).toBe(201);
      batchId = draft.json.data.id as string;
      const lines = (draft.json.data.transfers[0].lines as Json[]).map((l) => l.bookingId);
      expect(new Set(lines)).toEqual(
        new Set([ids.D1.booking, ids.D2.booking, ids.X.booking, ids.Y.booking]),
      );
      expect(draft.json.data.transfers[0].tdsPaise).toBe(40_000);
    });

    it('export credits each payout with balanced postings and TDS withheld on the big one', async () => {
      const res = await staffPost(`/admin/payouts/batches/${batchId}/export`, { code: code() });
      expect(res.status).toBe(200);
      const x = await payoutOf(ids.X.booking);
      expect(x).toMatchObject({ status: 'APPROVED', tds: '40000', net: '3960000' });
      const unbalanced = await e2e.db.sql`
        SELECT txn_id FROM ledger_entries GROUP BY txn_id
        HAVING sum(CASE WHEN direction = 'DEBIT' THEN amount_paise ELSE -amount_paise END) <> 0`;
      expect(unbalanced).toHaveLength(0);
      const tds = await e2e.db.sql<{ net: string }[]>`
        SELECT sum(amount_paise)::text AS net FROM ledger_entries
        WHERE payout_id = ${x?.id ?? ''} AND txn_kind = 'TDS_WITHHELD' AND account = 'TDS_PAYABLE'`;
      expect(tds[0]?.net).toBe('40000');
      const withheld = await payoutOf(ids.D3.booking);
      const posted = await e2e.db.sql`
        SELECT 1 FROM ledger_entries WHERE payout_id = ${withheld?.id ?? ''}`;
      expect(posted).toHaveLength(0);
    });

    it('bank file and UTR: the transfer is paid', async () => {
      expect(
        (await staffPost(`/admin/payouts/batches/${batchId}/bank-file`, { code: code() })).status,
      ).toBe(200);
      const paid = await staffPost(`/admin/payouts/batches/${batchId}/mark-paid`, {
        code: code(),
        transfers: [{ photographerId: proA, utr: UTR }],
      });
      expect(paid.status).toBe(200);
      expect((await payoutOf(ids.Y.booking))?.status).toBe('PAID');
    });
  });

  describe('GET /pro/earnings lists paid transfers with TDS (ADR-0027 D5)', () => {
    it('batch reference, paid date, gross, TDS, deductions, net — and only the UTR last 4', async () => {
      const res = await e2e.call('GET', '/pro/earnings', {
        token: await tokenFor(e2e, 'PHOTOGRAPHER', proA),
      });
      expect(res.status).toBe(200);
      const rows = await e2e.db.sql<{ gross: string; tds: string; net: string }[]>`
        SELECT sum(gross_paise)::text AS gross, sum(tds_paise)::text AS tds,
               sum(net_paise)::text AS net
        FROM payouts WHERE photographer_id = ${proA} AND status = 'PAID'`;
      const sums = rows[0];
      expect(res.json.data.paidTransfers).toEqual([
        {
          batchReference: 'PO20261214W',
          paidAt: e2e.now().toISOString(),
          payoutCount: 4,
          grossPaise: Number(sums?.gross),
          tdsPaise: 40_000,
          deductionsPaise: 0,
          netPaise: Number(sums?.net),
          utrLast4: '0077',
        },
      ]);
      expect(JSON.stringify(res.json)).not.toContain(UTR);
      // Paid and withheld jobs are no longer pending; each job pays what its payout says.
      expect(res.json.data.pendingPayoutPaise).toBe(0);
      const jobs = new Map((res.json.data.jobs as Json[]).map((j) => [j.bookingId, j]));
      expect(jobs.get(ids.Y.booking)).toMatchObject({
        payoutStatus: 'PAID',
        payoutBasis: 'CLIENT_ABSENT',
        totalPayoutPaise: Number((await payoutOf(ids.Y.booking))?.gross),
      });
      expect(jobs.get(ids.D3.booking)).toMatchObject({
        payoutStatus: 'WITHHELD',
        totalPayoutPaise: 0,
      });
      // Access denied has no check-out, so it is not a job, but the month still counts it.
      expect(jobs.has(ids.X.booking)).toBe(false);
      expect(res.json.data.monthPaise).toBe(Number(sums?.gross));
    });

    it('another photographer sees none of it', async () => {
      const res = await e2e.call('GET', '/pro/earnings', {
        token: await tokenFor(e2e, 'PHOTOGRAPHER', proB),
      });
      expect(res.status).toBe(200);
      expect(res.json.data.paidTransfers).toEqual([]);
    });
  });
  describe('finance releases a withheld payout (ADR-0027 D5)', () => {
    it('the Due tab lists it with the reason; release needs a code and a note, then it is due', async () => {
      const held = await payoutOf(ids.D3.booking);
      const due = await e2e.call('GET', '/admin/payouts/due', {
        token: await staffToken(e2e, finance),
      });
      expect(due.json.data.withheld).toEqual([
        expect.objectContaining({
          payoutId: held?.id,
          photographerName: 'Asha Patel',
          basis: 'DATA_LOSS',
          grossPaise: Number(held?.gross),
          reason: held?.withheld_reason,
        }),
      ]);
      const path = `/admin/payouts/withheld/${held?.id}/release`;
      const wrong = await staffPost(path, { code: '000000', note: 'Second card was fine' });
      expect([wrong.status, wrong.json.error.code]).toEqual([422, 'STEP_UP_CODE_INVALID']);
      const res = await staffPost(path, { code: code(), note: 'Second card was fine' });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ payoutId: held?.id, status: 'PENDING' });
      expect((await payoutOf(ids.D3.booking))?.status).toBe('PENDING');
      const [audit] = await e2e.db.sql<{ actor_id: string; after_state: Json }[]>`
        SELECT actor_id, after_state FROM audit_logs WHERE action = 'payout.release'`;
      expect(audit).toMatchObject({ actor_id: finance, after_state: { status: 'PENDING' } });
      const again = await staffPost(path, { code: code(), note: 'Again' });
      expect([again.status, again.json.error.code]).toEqual([409, 'PAYOUT_NOT_WITHHELD']);
      // Pending again on the photographer's earnings.
      const earnings = await e2e.call('GET', '/pro/earnings', {
        token: await tokenFor(e2e, 'PHOTOGRAPHER', proA),
      });
      expect(earnings.json.data.pendingPayoutPaise).toBe(Number(held?.gross));
    });
  });
});
