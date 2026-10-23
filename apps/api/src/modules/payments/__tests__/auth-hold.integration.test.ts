import { randomBytes, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../../config/env';
import { seedLaunchCities } from '../../../infra/db/seed';
import { seedLaunchRuleset } from '../../../infra/db/seeds/launch-ruleset.seed';
import { RedisLocks } from '../../../infra/queues/redis-lock';
import {
  bookingRequest,
  bookingsService,
  createQuotedBooking,
  insertUser,
} from '../../../test-support/booking-fixtures';
import { TEST_REDIS_URL } from '../../../test-support/e2e-app';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { AuthHoldsService, HoldBusyError } from '../auth-holds.service';
import type { CaptureResult, ReleaseResult } from '../gateways/payment-gateway.port';
import { SandboxGateway } from '../gateways/sandbox.gateway';
import { InvoicesService } from '../invoices.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentsService } from '../payments.service';
import type { PaymentRecord } from '../payments.types';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentsRepository } from '../repositories/payments.repository';
import { WebhookEventsRepository } from '../repositories/webhook-events.repository';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const SECRET = 'integration-sandbox-secret-0123';

/** Scripted gateway outcomes; counts calls. */
class ScriptedGateway extends SandboxGateway {
  captures = 0;
  releases = 0;
  captureResult: CaptureResult = 'CAPTURED';
  releaseResult: ReleaseResult = 'RELEASED';
  override async capture(): Promise<CaptureResult> {
    this.captures += 1;
    return this.captureResult;
  }
  override async releaseAuthorization(): Promise<ReleaseResult> {
    this.releases += 1;
    return this.releaseResult;
  }
}

describe.runIf(TEST_DATABASE_URL)('AuthHoldsService (<3h holds, ADR-0012 D4)', () => {
  let db: ScratchDb;
  let redis: Redis;
  let locks: RedisLocks;
  const prefix = `clickco-holds-${randomBytes(4).toString('hex')}`;
  const gateway = new ScriptedGateway(SECRET, () => NOW);
  let payments: PaymentsService;
  let holds: AuthHoldsService;
  let userId: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    await seedLaunchRuleset(db.sql);
    userId = await insertUser(db.sql, '+919876543210');
    redis = new Redis(TEST_REDIS_URL);
    locks = new RedisLocks(redis, { QUEUE_PREFIX: prefix } as Env);
    const ledger = new LedgerService();
    const repo = new PaymentsRepository();
    payments = new PaymentsService(
      gateway,
      repo,
      new WebhookEventsRepository(),
      new InvoicesRepository(),
      new InvoicesService(new InvoicesRepository(), ledger),
      ledger,
      db.sql,
      () => NOW,
    );
    holds = new AuthHoldsService(gateway, repo, payments, locks, db.sql, () => NOW);
  }, 60_000);

  afterAll(async () => {
    const keys = await redis?.keys(`${prefix}:*`);
    if (keys?.length) await redis.del(...keys);
    redis?.disconnect();
    await db?.drop();
  });

  /** A QUOTED <3h booking with an AUTHORIZED, auth-only FULL payment. */
  async function authorisedHold(): Promise<{ bookingId: string; payment: PaymentRecord }> {
    const start = new Date(NOW.getTime() + 2 * 60 * 60_000).toISOString();
    const { view } = await createQuotedBooking(
      db.sql,
      userId,
      NOW,
      bookingRequest({ categoryCode: 'PORTRAIT' }, start),
    );
    const created = await db.sql.begin((tx) =>
      payments.createOrder(tx, {
        bookingId: view.id,
        userId,
        purpose: 'FULL',
        amountPaise: view.advancePaise,
        authorizeOnly: true,
      }),
    );
    await db.sql.begin((tx) =>
      payments.markAuthorized(tx, {
        payment: created,
        event: {
          kind: 'PAYMENT_AUTHORIZED',
          eventType: 'payment.authorized',
          providerOrderId: created.providerOrderId ?? '',
          providerPaymentId: `pay_${randomUUID().slice(0, 8)}`,
          amountPaise: created.amountPaise,
          method: 'CARD',
          vpaOrLast4: '4242',
          feePaise: 0n,
        },
        authorizedAt: NOW,
        authExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
      }),
    );
    const hold = await holds.held(db.sql, view.id);
    if (!hold) throw new Error('expected an authorised hold');
    return { bookingId: view.id, payment: hold };
  }

  const basisFor = (bookingId: string) =>
    db.sql.begin((tx) => bookingsService(db.sql).quoteSnapshotTotals(tx, bookingId));
  const status = async (id: string) => (await payments.findById(id))?.status;
  const flags = (paymentId: string) =>
    db.sql<{ reason: string }[]>`
      SELECT payload->>'reason' AS reason FROM domain_events
      WHERE event_type = 'payment.needs_review' AND aggregate_id = ${paymentId}`;

  it('finds the AUTHORIZED auth-only payment for a booking, and nothing for others', async () => {
    const { bookingId, payment } = await authorisedHold();
    expect(payment).toMatchObject({ bookingId, status: 'AUTHORIZED', isAuthOnly: true });
    expect(await holds.held(db.sql, randomUUID())).toBeNull();
  });

  it('records a capture once: ledger, FULL invoice, CAPTURED — a repeat is ALREADY_RECORDED', async () => {
    const { bookingId, payment } = await authorisedHold();
    expect(await holds.withLock(payment.id, () => holds.capture(payment))).toBe('CAPTURED');
    const basis = await basisFor(bookingId);
    const first = await db.sql.begin((tx) => holds.recordCapture(tx, payment.id, NOW, basis));
    const again = await db.sql.begin((tx) => holds.recordCapture(tx, payment.id, NOW, basis));
    expect(first).toMatchObject({ kind: 'RECORDED', amountPaise: payment.amountPaise });
    expect(again).toEqual({ kind: 'ALREADY_RECORDED' });
    expect(await payments.findById(payment.id)).toMatchObject({
      status: 'CAPTURED',
      capturedPaise: payment.amountPaise,
    });
    const [invoice] = await payments.invoicesForBooking(bookingId);
    expect(invoice).toMatchObject({ purpose: 'FULL', totalPaise: payment.amountPaise });
    const kinds = await db.sql<{ txn_kind: string }[]>`
      SELECT DISTINCT txn_kind FROM ledger_entries WHERE booking_id = ${bookingId} ORDER BY txn_kind`;
    expect(kinds.map((k) => k.txn_kind)).toEqual(['ADVANCE_CAPTURED', 'GST_ACCRUED']);
  });

  it('a second capture or release of the same payment waits its turn (Redis lease)', async () => {
    const { payment } = await authorisedHold();
    let inner: unknown = null;
    await holds.withLock(payment.id, async () => {
      inner = await holds.withLock(payment.id, async () => 'ran').catch((e: unknown) => e);
    });
    expect(inner).toBeInstanceOf(HoldBusyError);
  });

  it('releases a hold at the gateway, marks it AUTH_RELEASED with an event, and only once', async () => {
    const { bookingId, payment } = await authorisedHold();
    const before = gateway.releases;
    expect(await holds.release(bookingId, 'UNFILLED')).toBe('RELEASED');
    expect(await holds.release(bookingId, 'UNFILLED')).toBe('NONE');
    expect(gateway.releases).toBe(before + 1);
    expect(await status(payment.id)).toBe('AUTH_RELEASED');
    const events = await db.sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM domain_events
      WHERE event_type = 'payment.auth_released' AND aggregate_id = ${payment.id}`;
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ booking_id: bookingId, reason: 'UNFILLED' });
  });

  it('never releases what the gateway says it captured: flagged instead', async () => {
    const { bookingId, payment } = await authorisedHold();
    gateway.releaseResult = 'CAPTURED';
    try {
      expect(await holds.release(bookingId, 'UNFILLED')).toBe('FLAGGED');
    } finally {
      gateway.releaseResult = 'RELEASED';
    }
    expect(await status(payment.id)).toBe('AUTHORIZED');
    expect((await flags(payment.id)).map((f) => f.reason)).toEqual(['CAPTURED_AT_RELEASE']);
  });

  it('an unconfirmed release throws (the outbox retries) and changes nothing', async () => {
    const { bookingId, payment } = await authorisedHold();
    gateway.releaseResult = 'UNKNOWN';
    try {
      await expect(holds.release(bookingId, 'UNFILLED')).rejects.toThrow(/unconfirmed/);
    } finally {
      gateway.releaseResult = 'RELEASED';
    }
    expect(await status(payment.id)).toBe('AUTHORIZED');
  });

  it('a capture recorded after the hold was released books the money and flags it once', async () => {
    const { bookingId, payment } = await authorisedHold();
    await holds.release(bookingId, 'UNFILLED');
    const basis = await basisFor(bookingId);
    const rec = await db.sql.begin((tx) => holds.recordCapture(tx, payment.id, NOW, basis));
    expect(rec).toEqual({ kind: 'CAPTURED_AFTER_RELEASE', amountPaise: payment.amountPaise });
    expect(await status(payment.id)).toBe('CAPTURED');
    expect(await payments.invoicesForBooking(bookingId)).toEqual([]);
    expect((await flags(payment.id)).map((f) => f.reason)).toEqual(['CAPTURED_AFTER_RELEASE']);
    expect(await payments.flagCapturedForRefund(bookingId, 'REFUND_DUE_UNFILLED')).toBe(1);
    expect(await payments.flagCapturedForRefund(bookingId, 'REFUND_DUE_UNFILLED')).toBe(1);
    expect((await flags(payment.id)).map((f) => f.reason).sort()).toEqual([
      'CAPTURED_AFTER_RELEASE',
      'REFUND_DUE_UNFILLED',
    ]);
  });
});
