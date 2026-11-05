import { roundHalfUp } from '@clickco/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxSubscribers } from './infra/outbox/outbox-subscribers';
import { JOB } from './infra/queues/queue-names';
import { walkTo } from './modules/media/__tests__/media-fixtures';
import { PAYMENT_GATEWAY } from './modules/payments/gateways/payment-gateway.port';
import { SandboxGateway } from './modules/payments/gateways/sandbox.gateway';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  insertClient,
  setNow,
  tokenFor,
} from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';

/** Wednesday 24 Feb 2027, 10:00 IST — still the 2026-27 wedding season (Peak Season to 28 Feb). */
const NOW = new Date('2027-02-24T04:30:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 10:00 IST on a day in 2027 ("03-10" → 10 March). */
const tenAm = (monthDay: string) => new Date(`2027-${monthDay}T04:30:00.000Z`);
const plusHours = (d: Date, h: number) => new Date(d.getTime() + h * HOUR);

let keySeq = 0;
const idem = () => `cancellations-e2e-${String(++keySeq).padStart(6, '0')}`;

type Which = 'A' | 'B' | 'C' | 'D' | 'P' | 'K' | 'E1' | 'E2';

interface RefundRow {
  id: string;
  payment_id: string;
  status: string;
  amount: string;
  reason_code: string;
  requested_by_kind: string;
  requested_by_id: string | null;
  approved_by: string | null;
  provider_refund_id: string | null;
  attempts: number;
}

/**
 * A client cancels their own paid booking (DOMAIN §2: any pre-shoot state → CANCELLED_CLIENT) and
 * the T&C §3 ladder decides what comes back: quote first, then an idempotent POST that re-checks
 * the band under the booking lock, releases dispatch, refunds through the refunds module to the
 * sandbox gateway (credit note + balanced ledger), pays the photographer their share of what was
 * kept, and tells both sides.
 */
describe.runIf(TEST_DATABASE_URL)('client cancellation and the T&C §3 refund ladder', () => {
  let e2e: E2eApp;
  let client: string;
  let proA: string;
  const ids = {} as Record<Which, string>;
  const assignments = {} as Partial<Record<Which, string>>;

  const userToken = () => tokenFor(e2e, 'USER', client);
  const quote = async (bookingId: string) =>
    e2e.call('GET', `/bookings/${bookingId}/cancellation`, { token: await userToken() });
  const cancel = async (bookingId: string, expected?: number, key = idem()) =>
    e2e.call('POST', `/bookings/${bookingId}/cancel`, {
      token: await userToken(),
      idempotencyKey: key,
      ...(expected === undefined ? {} : { body: { expectedRefundPaise: expected } }),
    });
  /** Quote, then cancel confirming the quoted refund; drains the outbox. */
  const quoteAndCancel = async (bookingId: string, key = idem()) => {
    const q = await quote(bookingId);
    expect(q.status).toBe(200);
    const res = await cancel(bookingId, q.json.data.refundPaise, key);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    await drainOutbox(e2e);
    return { quote: q.json.data as Json, res: res.json.data as Json };
  };

  const refundsOf = (bookingId: string) =>
    e2e.db.sql<RefundRow[]>`
      SELECT id, payment_id, status, amount_paise::text AS amount, reason_code, requested_by_kind,
             requested_by_id, approved_by, provider_refund_id, attempts
      FROM refunds WHERE booking_id = ${bookingId} ORDER BY created_at, id`;
  const bookingRow = async (bookingId: string) =>
    (
      await e2e.db.sql<
        {
          status: string;
          total: string;
          advance: string;
          cancellation_reason: string | null;
          cancelled_at: Date | null;
        }[]
      >`
        SELECT status, total_paise::text AS total, advance_paise::text AS advance,
               cancellation_reason, cancelled_at
        FROM bookings WHERE id = ${bookingId}`
    )[0];
  const capturedOf = async (bookingId: string): Promise<bigint> => {
    const [row] = await e2e.db.sql<{ paise: string }[]>`
      SELECT coalesce(sum(captured_paise), 0)::text AS paise FROM payments
      WHERE booking_id = ${bookingId}`;
    return BigInt(row?.paise ?? '0');
  };
  const cancelledEvent = async (bookingId: string) =>
    (
      await e2e.db.sql<{ event_id: string; payload: Json; occurred_at: Date }[]>`
        SELECT event_id, payload, occurred_at FROM domain_events
        WHERE event_type = 'booking.cancelled_client' AND aggregate_id = ${bookingId}`
    )[0];
  const payoutOf = async (bookingId: string) =>
    e2e.db.sql<
      {
        photographer_id: string;
        status: string;
        basis: string;
        basis_bps: number;
        gross: string;
        eligible_at: Date;
      }[]
    >`
      SELECT photographer_id, status, basis, basis_bps, gross_paise::text AS gross, eligible_at
      FROM payouts WHERE booking_id = ${bookingId}`;
  const offerOf = async (bookingId: string): Promise<bigint> => {
    const [row] = await e2e.db.sql<{ paise: string }[]>`
      SELECT offered_payout_paise::text AS paise FROM dispatch_attempts
      WHERE booking_id = ${bookingId} AND outcome = 'ACCEPTED'`;
    if (!row) throw new Error(`no accepted offer on ${bookingId}`);
    return BigInt(row.paise);
  };
  const notificationsFor = (eventId: string) =>
    e2e.scheduler
      .pending(JOB.NOTIFICATION_SEND)
      .map((j) => j.data as Json)
      .filter((d) => d.eventId === eventId)
      .map((d) => [d.templateCode, d.recipientKind, d.recipientId]);
  /** Every ledger txn touching these bookings balances (DOMAIN §5 rule 8). */
  const unbalancedTxns = async (bookingIds: readonly string[]) =>
    e2e.db.sql<{ txn_id: string }[]>`
      SELECT txn_id FROM ledger_entries
      WHERE txn_id IN (SELECT txn_id FROM ledger_entries WHERE booking_id IN ${e2e.db.sql([...bookingIds])})
      GROUP BY txn_id
      HAVING sum(CASE direction WHEN 'DEBIT' THEN amount_paise ELSE -amount_paise END) <> 0`;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    proA = await insertPhotographer(e2e.db.sql, {
      phone: '+919999177101',
      name: 'Asha Patel',
      km: 3,
      acceptsEmergency: true, // offered the same-day broadcasts
      categories: [{ code: 'FOOD', tier: 'EXPERT' }],
    });
    client = await insertClient(e2e, '+919999277101');
    const starts: Record<Which, Date> = {
      A: tenAm('03-10'), // 14 days out: > 7 days
      B: tenAm('03-11'), // cancelled 4 days before: 3–7 days
      C: tenAm('03-12'), // accepted, cancelled 48 h before: 24–72 h + the photographer's share
      D: tenAm('03-13'), // cancelled 12 h before: under 24 h
      P: tenAm('02-27'), // peak season, 72 h out: §3.2
      K: tenAm('03-15'), // accepted, then checked in: refused
      E1: plusHours(NOW, 9), // SAME_DAY (19:00 IST): §3.3 before acceptance
      E2: plusHours(NOW, 21), // SAME_DAY (07:00 IST next day): §3.3 after acceptance
    };
    for (const which of Object.keys(starts) as Which[]) {
      ids[which] = (await bookAndPay(e2e, client, starts[which])).id as string;
    }
    for (const which of ['C', 'K'] as const) {
      assignments[which] = await acceptOffer(e2e, proA, ids[which]);
    }
  }, 300_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('before payment (the path that already existed)', () => {
    it('a QUOTED booking cancels without a body, nothing to refund', async () => {
      const created = await e2e.call('POST', '/bookings', {
        token: await userToken(),
        idempotencyKey: idem(),
        body: {
          tier: 'PROFESSIONAL',
          categoryCode: 'FOOD',
          pincode: '395007',
          scheduledStart: tenAm('03-20').toISOString(),
          hours: 2,
          venueAddress: '4 Athwalines, Surat',
          booker: { name: 'Rohan Shah', phone: '+919700000888' },
          modelReleaseConsent: false,
          acceptedTermsVersion: '2.0',
        },
      });
      const id = created.json.data.booking.id as string;
      const q = await quote(id);
      expect(q.json.data).toMatchObject({
        cancellable: true,
        band: 'BEFORE_PAYMENT',
        refundPaise: 0,
        paidPaise: 0,
      });
      const res = await cancel(id);
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        status: 'CANCELLED_CLIENT',
        cancellation: { band: 'BEFORE_PAYMENT', refundPaise: 0, refundIds: [] },
      });
      expect((await bookingRow(id))?.cancellation_reason).toBe('CLIENT_CANCELLED_BEFORE_PAYMENT');
    });
  });

  describe('T&C §3.1 more than 7 days: the full advance, to the sandbox gateway', () => {
    let refundPaise: number;
    let firstResponse: Json;
    const firstKey = idem();

    it('quotes the band in plain words, then refunds everything paid', async () => {
      const booking = await bookingRow(ids.A);
      const paid = await capturedOf(ids.A);
      expect(paid).toBe(BigInt(booking?.advance ?? '0'));
      const { quote: q, res } = await quoteAndCancel(ids.A, firstKey);
      firstResponse = res;
      expect(q).toMatchObject({
        cancellable: true,
        blockedBy: null,
        band: 'MORE_THAN_7_DAYS',
        clause: '3.1',
        peakSeason: false,
        paidPaise: Number(paid),
        refundPaise: Number(paid),
        keptPaise: 0,
        refundBps: 10_000,
        changesAt: plusHours(tenAm('03-10'), -72).toISOString(),
      });
      expect(q.reason).toMatch(/more than 7 days/);
      refundPaise = q.refundPaise;
      expect(res).toMatchObject({
        id: ids.A,
        status: 'CANCELLED_CLIENT',
        cancellation: { band: 'MORE_THAN_7_DAYS', refundPaise, keptPaise: 0 },
      });
      expect(res.cancellation.refundIds).toHaveLength(1);
    });

    it('the refund reached the sandbox gateway: COMPLETED, credit note, payment refunded', async () => {
      const [refund, ...more] = await refundsOf(ids.A);
      expect(more).toEqual([]);
      expect(refund).toMatchObject({
        status: 'COMPLETED',
        amount: String(refundPaise),
        reason_code: 'CLIENT_CANCEL',
        requested_by_kind: 'USER',
        requested_by_id: client,
        approved_by: null, // the published rule is the approval: no four-eyes
        attempts: 1,
      });
      expect(refund?.provider_refund_id).toMatch(/^rfnd_sbx_/);
      const [payment] = await e2e.db.sql<{ provider_payment_id: string; refunded: string }[]>`
        SELECT provider_payment_id, refunded_paise::text AS refunded FROM payments
        WHERE id = ${refund?.payment_id ?? ''}`;
      expect(payment?.refunded).toBe(String(refundPaise));
      const gateway = e2e.get(PAYMENT_GATEWAY);
      if (!(gateway instanceof SandboxGateway)) throw new Error('expected the sandbox');
      expect(
        await gateway.findRefund(payment?.provider_payment_id ?? '', refund?.id ?? ''),
      ).toMatchObject({ status: 'PROCESSED', providerRefundId: refund?.provider_refund_id });
      const notes = await e2e.db.sql<{ total: string }[]>`
        SELECT total_amount_paise::text AS total FROM credit_notes WHERE refund_id = ${refund?.id ?? ''}`;
      expect(notes.map((n) => n.total)).toEqual([String(refundPaise)]);
    });

    it('the ledger balances, and REFUND_ISSUED takes the refund out of gateway cash', async () => {
      expect(await unbalancedTxns([ids.A])).toEqual([]);
      const lines = await e2e.db.sql<{ account: string; direction: string; amount: string }[]>`
        SELECT account, direction, amount_paise::text AS amount FROM ledger_entries
        WHERE booking_id = ${ids.A} AND txn_kind = 'REFUND_ISSUED' ORDER BY id`;
      expect(lines).toContainEqual({
        account: 'CASH_GATEWAY',
        direction: 'CREDIT',
        amount: String(refundPaise),
      });
      const debits = lines.filter((l) => l.direction === 'DEBIT');
      expect(debits.reduce((s, l) => s + BigInt(l.amount), 0n)).toBe(BigInt(refundPaise));
    });

    it('cancelling twice: the same key replays, a new key is refused, one refund only', async () => {
      const replay = await cancel(ids.A, refundPaise, firstKey);
      expect(replay.status).toBe(200);
      expect(replay.json.data).toEqual(firstResponse);
      const again = await cancel(ids.A, refundPaise);
      expect(again.status).toBe(409);
      expect(again.json.error.code).toBe('ALREADY_CANCELLED');
      expect(await refundsOf(ids.A)).toHaveLength(1);
      const q = await quote(ids.A);
      expect(q.json.data).toMatchObject({ cancellable: false, blockedBy: 'ALREADY_CANCELLED' });
    });

    it('dispatch let go: open offers cancelled, rounds ended; SLA clocks disarmed', async () => {
      const attempts = await e2e.db.sql<{ outcome: string }[]>`
        SELECT outcome FROM dispatch_attempts WHERE booking_id = ${ids.A}`;
      expect(attempts.length).toBeGreaterThan(0);
      expect(attempts.every((a) => a.outcome === 'CANCELLED')).toBe(true);
      const open = await e2e.db.sql`
        SELECT 1 FROM dispatch_rounds WHERE booking_id = ${ids.A} AND ended_at IS NULL`;
      expect(open).toHaveLength(0);
      const armed = await e2e.db.sql`
        SELECT 1 FROM sla_clocks WHERE booking_id = ${ids.A} AND state = 'ARMED'`;
      expect(armed).toHaveLength(0);
      expect(await payoutOf(ids.A)).toEqual([]); // nobody had accepted: no photographer share
    });

    it('the client hears about it (BOOKING_CANCELLED), the refund amount follows', async () => {
      const event = await cancelledEvent(ids.A);
      expect(event?.payload).toMatchObject({
        reason: 'CLIENT_CANCELLED',
        actor_kind: 'USER',
        band: 'MORE_THAN_7_DAYS',
        refund_paise: refundPaise,
        kept_paise: 0,
        photographer_id: null,
      });
      expect(notificationsFor(event?.event_id ?? '')).toEqual([
        ['BOOKING_CANCELLED', 'USER', client],
      ]);
    });
  });

  describe('T&C §3.2 peak season, 72 h out: half the advance', () => {
    it('keeps 50 % where §3.1 alone would refund everything', async () => {
      const { quote: q } = await quoteAndCancel(ids.P);
      const advance = BigInt((await bookingRow(ids.P))?.advance ?? '0');
      const back = roundHalfUp(advance * 5_000n, 10_000n);
      expect(q).toMatchObject({
        band: 'PEAK_SEASON_UNDER_7_DAYS',
        clause: '3.2',
        peakSeason: true,
        refundBps: 5_000,
        refundPaise: Number(back),
        keptPaise: Number(advance - back),
      });
      const refunds = await refundsOf(ids.P);
      expect(refunds.map((r) => [r.status, r.amount])).toEqual([['COMPLETED', String(back)]]);
    });
  });

  describe('T&C §3.3 emergency and same-day bookings', () => {
    it('before a photographer accepts: free of charge, everything paid comes back', async () => {
      const { quote: q } = await quoteAndCancel(ids.E1);
      const paid = await capturedOf(ids.E1);
      expect(paid).toBe(BigInt((await bookingRow(ids.E1))?.total ?? '0')); // 100 % upfront
      expect(q).toMatchObject({
        band: 'EMERGENCY_BEFORE_ACCEPTANCE',
        clause: '3.3',
        refundPaise: Number(paid),
        keptPaise: 0,
        changesAt: null,
      });
      expect((await refundsOf(ids.E1)).map((r) => r.status)).toEqual(['COMPLETED']);
    });

    it('a photographer accepts after the quote: the POST refuses the old terms, then nothing back', async () => {
      const before = await quote(ids.E2);
      expect(before.json.data.band).toBe('EMERGENCY_BEFORE_ACCEPTANCE');
      assignments.E2 = await acceptOffer(e2e, proA, ids.E2);
      const stale = await cancel(ids.E2, before.json.data.refundPaise);
      expect(stale.status).toBe(409);
      expect(stale.json.error.code).toBe('CANCELLATION_TERMS_CHANGED');
      expect((await bookingRow(ids.E2))?.status).toBe('ASSIGNED');
      const { quote: q } = await quoteAndCancel(ids.E2);
      const total = BigInt((await bookingRow(ids.E2))?.total ?? '0');
      expect(q).toMatchObject({
        band: 'EMERGENCY_AFTER_ACCEPTANCE',
        refundPaise: 0,
        keptPaise: Number(total),
      });
      expect(await refundsOf(ids.E2)).toEqual([]);
    });

    it('the photographer who accepted is paid in full for it (everything was kept)', async () => {
      const [payout, ...more] = await payoutOf(ids.E2);
      expect(more).toEqual([]);
      expect(payout).toMatchObject({
        photographer_id: proA,
        status: 'PENDING',
        basis: 'CLIENT_CANCELLED',
        basis_bps: 10_000,
        gross: (await offerOf(ids.E2)).toString(),
      });
      const [assignment] = await e2e.db.sql<{ status: string; release_reason: string }[]>`
        SELECT status, release_reason FROM assignments WHERE id = ${assignments.E2 ?? ''}`;
      expect(assignment).toEqual({ status: 'RELEASED', release_reason: 'CLIENT_CANCELLED' });
    });
  });

  describe('refusals', () => {
    it('once anything was paid, the POST needs the confirmed refund', async () => {
      const res = await cancel(ids.B);
      expect(res.status).toBe(422);
      expect(res.json.error.code).toBe('CANCELLATION_CONFIRMATION_REQUIRED');
      expect((await bookingRow(ids.B))?.status).toBe('DISPATCHING');
    });

    it('after check-in there is no client cancellation (DOMAIN §2)', async () => {
      await walkTo(e2e, ids.K, assignments.K ?? '', 'CHECKED_IN');
      const q = await quote(ids.K);
      expect(q.status).toBe(200);
      expect(q.json.data).toMatchObject({
        cancellable: false,
        blockedBy: 'SHOOT_STARTED',
        band: null,
        refundPaise: 0,
      });
      const res = await cancel(ids.K, 0);
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('CANCEL_NOT_AVAILABLE');
      expect((await bookingRow(ids.K))?.status).toBe('CHECKED_IN');
      expect(await refundsOf(ids.K)).toEqual([]);
    });

    it('someone else’s booking is 404, like a missing one', async () => {
      const other = await insertClient(e2e, '+919999277102');
      const res = await e2e.call('GET', `/bookings/${ids.B}/cancellation`, {
        token: await tokenFor(e2e, 'USER', other),
      });
      expect(res.status).toBe(404);
      const post = await e2e.call('POST', `/bookings/${ids.B}/cancel`, {
        token: await tokenFor(e2e, 'USER', other),
        idempotencyKey: idem(),
        body: { expectedRefundPaise: 0 },
      });
      expect(post.status).toBe(404);
    });
  });

  describe('T&C §3.1 3–7 days (4 days before): the full advance', () => {
    it('a stale figure is refused, the quoted one goes through', async () => {
      setNow(e2e, tenAm('03-07'));
      const q = await quote(ids.B);
      expect(q.json.data).toMatchObject({ band: 'DAYS_3_TO_7', refundBps: 10_000 });
      const wrong = await cancel(ids.B, q.json.data.refundPaise - 1);
      expect(wrong.status).toBe(409);
      expect(wrong.json.error.code).toBe('CANCELLATION_TERMS_CHANGED');
      const { res } = await quoteAndCancel(ids.B);
      expect(res.cancellation).toMatchObject({ band: 'DAYS_3_TO_7', keptPaise: 0 });
      expect((await refundsOf(ids.B)).map((r) => r.status)).toEqual(['COMPLETED']);
    });
  });

  describe('race with dispatch accept (both take the booking lock)', () => {
    it('either the cancel wins (full refund, accept refused) or the accept wins (cancel refused)', async () => {
      const start = plusHours(e2e.now(), 9); // SAME_DAY
      const r = (await bookAndPay(e2e, client, start)).id as string;
      const q = await quote(r);
      expect(q.json.data.band).toBe('EMERGENCY_BEFORE_ACCEPTANCE');
      const proToken = await tokenFor(e2e, 'PHOTOGRAPHER', proA);
      const offers = await e2e.call('GET', '/pro/offers', { token: proToken });
      const offer = (offers.json.data as Json[]).find((o) => o.bookingId === r);
      expect(offer).toBeDefined();
      const [accepted, cancelled] = await Promise.all([
        e2e.call('POST', `/pro/offers/${offer?.attemptId}/accept`, {
          token: proToken,
          idempotencyKey: idem(),
        }),
        cancel(r, q.json.data.refundPaise),
      ]);
      await drainOutbox(e2e);
      const status = (await bookingRow(r))?.status;
      const active = await e2e.db.sql`
        SELECT 1 FROM assignments WHERE booking_id = ${r} AND status IN ('ASSIGNED', 'EN_ROUTE')`;
      if (cancelled.status === 200) {
        expect(accepted.status).toBe(409);
        expect(status).toBe('CANCELLED_CLIENT');
        expect(active).toHaveLength(0);
        expect((await refundsOf(r)).map((x) => x.amount)).toEqual([
          String(q.json.data.refundPaise),
        ]);
      } else {
        expect(accepted.status).toBe(200);
        expect(cancelled.status).toBe(409);
        expect(cancelled.json.error.code).toBe('CANCELLATION_TERMS_CHANGED');
        expect(status).toBe('ASSIGNED');
        expect(active).toHaveLength(1);
        expect(await refundsOf(r)).toEqual([]);
      }
      expect(await unbalancedTxns([r])).toEqual([]);
    });
  });

  describe('T&C §3.1 24–72 h, after a photographer accepted: half back, their share of the rest', () => {
    let keptPaise: bigint;

    it('refunds half the advance and releases the assignment', async () => {
      setNow(e2e, plusHours(tenAm('03-12'), -48));
      const { quote: q, res } = await quoteAndCancel(ids.C);
      const advance = BigInt((await bookingRow(ids.C))?.advance ?? '0');
      const back = roundHalfUp(advance * 5_000n, 10_000n);
      keptPaise = advance - back;
      expect(q).toMatchObject({
        band: 'HOURS_24_TO_72',
        refundPaise: Number(back),
        keptPaise: Number(keptPaise),
        changesAt: plusHours(tenAm('03-12'), -24).toISOString(),
      });
      expect(res.cancellation.refundIds).toHaveLength(1);
      const [assignment] = await e2e.db.sql<{ status: string; release_reason: string }[]>`
        SELECT status, release_reason FROM assignments WHERE id = ${assignments.C ?? ''}`;
      expect(assignment).toEqual({ status: 'RELEASED', release_reason: 'CLIENT_CANCELLED' });
      const upcoming = await e2e.call('GET', '/pro/assignments', {
        token: await tokenFor(e2e, 'PHOTOGRAPHER', proA),
      });
      expect((upcoming.json.data as Json[]).map((a) => a.bookingId)).not.toContain(ids.C);
    });

    it('the photographer’s share: the payout scaled by what was kept, once however redelivered', async () => {
      const total = BigInt((await bookingRow(ids.C))?.total ?? '0');
      const offer = await offerOf(ids.C);
      const event = await cancelledEvent(ids.C);
      const [payout] = await payoutOf(ids.C);
      expect(payout).toMatchObject({
        photographer_id: proA,
        status: 'PENDING',
        basis: 'CLIENT_CANCELLED',
        basis_bps: Number(roundHalfUp(keptPaise * 10_000n, total)),
        gross: roundHalfUp(offer * keptPaise, total).toString(),
      });
      expect(payout?.eligible_at.getTime()).toBe((event?.occurred_at.getTime() ?? 0) + 3 * DAY);
      const handler = e2e
        .get(OutboxSubscribers)
        .subscribersOf('booking.cancelled_client')
        .find((s) => s.name.startsWith('payouts.'));
      if (!handler || !event) throw new Error('no payouts subscriber for booking.cancelled_client');
      await handler.handle({
        eventId: event.event_id,
        eventType: 'booking.cancelled_client',
        aggregateKind: 'booking',
        aggregateId: ids.C,
        payload: event.payload,
        occurredAt: event.occurred_at,
      });
      expect(await payoutOf(ids.C)).toHaveLength(1);
    });

    it('both sides hear about it', async () => {
      const event = await cancelledEvent(ids.C);
      expect(event?.payload).toMatchObject({
        assignment_id: assignments.C,
        photographer_id: proA,
        kept_paise: Number(keptPaise),
      });
      expect(notificationsFor(event?.event_id ?? '').sort()).toEqual(
        [
          ['BOOKING_CANCELLED', 'USER', client],
          ['PRO_JOB_CANCELLED', 'PHOTOGRAPHER', proA],
        ].sort(),
      );
    });
  });

  describe('T&C §3.1 under 24 hours: no refund', () => {
    it('cancels, keeps the advance, raises no refund', async () => {
      setNow(e2e, plusHours(tenAm('03-13'), -12));
      const { quote: q, res } = await quoteAndCancel(ids.D);
      const advance = Number((await bookingRow(ids.D))?.advance ?? '0');
      expect(q).toMatchObject({
        band: 'UNDER_24_HOURS',
        refundPaise: 0,
        keptPaise: advance,
        changesAt: null,
      });
      expect(res).toMatchObject({ status: 'CANCELLED_CLIENT', cancellation: { refundIds: [] } });
      expect(await refundsOf(ids.D)).toEqual([]);
      expect(await payoutOf(ids.D)).toEqual([]);
    });

    it('every ledger txn on every cancelled booking balances', async () => {
      expect(await unbalancedTxns(Object.values(ids))).toEqual([]);
    });
  });
});
