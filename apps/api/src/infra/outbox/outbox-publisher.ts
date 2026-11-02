import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../db/db.module';
import { appendDomainEvent } from './outbox';
import { OutboxSubscribers, type PublishedEvent } from './outbox-subscribers';

export const PUBLISH_BATCH_SIZE = 100;

/**
 * After this many failures an event is dead-lettered: published_at stays NULL, last_error says
 * which subscriber failed, and an `ops.dead_letter` event alerts ops. Replay = reset
 * publish_attempts and next_attempt_at (ADR-0012 D9).
 */
export const MAX_PUBLISH_ATTEMPTS = 50;

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CEILING_MS = 15 * 60_000;
const DEAD_LETTER = 'ops.dead_letter';

/** Delay before retry number `attempts` (1-based): 2 s, 4 s, 8 s … capped at 15 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CEILING_MS);
}

interface EventRow {
  id: string;
  event_id: string;
  event_type: string;
  aggregate_kind: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  publish_attempts: number;
}

interface Failure {
  readonly subscriber: string;
  /** Error class name only: messages can carry personal data (phones, addresses). */
  readonly errorName: string;
  /** A timed-out delivery's work, still running: settles once its handler returns. */
  readonly abandoned?: Promise<unknown>;
}

/** How a failure settled: recorded, recorded with the claim kept (`HELD`), or the claim was lost. */
type FailureOutcome = 'RECORDED' | 'HELD' | 'LOST';

export interface PublishTickResult {
  readonly published: number;
  readonly failed: number;
}

const toEvent = (r: EventRow): PublishedEvent => ({
  eventId: r.event_id,
  eventType: r.event_type,
  aggregateKind: r.aggregate_kind,
  aggregateId: r.aggregate_id,
  payload: r.payload,
  occurredAt: r.occurred_at,
});

/**
 * How long a claimed event stays invisible to other ticks. A tick that dies mid-delivery (crash,
 * deploy) loses its claim when this runs out, and the event is delivered again — at-least-once.
 */
export const CLAIM_LEASE_MS = 10 * 60_000;
/** A tick stops starting new deliveries after this and hands the rest back, well inside the lease. */
export const TICK_DEADLINE_MS = CLAIM_LEASE_MS / 2;
/**
 * How long one event's delivery (its subscribers, in order) may run. Past it the subscriber still
 * running is recorded as failed (`DeliveryTimeout`) and its signal is aborted. A tick starts no
 * delivery after TICK_DEADLINE_MS, so its last one settles by TICK_DEADLINE_MS + this: inside the
 * lease, where no other tick can claim the event.
 *
 * JavaScript cannot stop a handler that ignores the signal, so the tick keeps the claim (its token
 * and a fresh lease) until that handler returns, then hands the event back on its backoff. A
 * handler that never returns loses the claim when the lease runs out. Either way no second copy of
 * the delivery starts while the first is known to be running.
 */
export const DELIVERY_TIMEOUT_MS = 2 * 60_000;

/** A delivery that ran past its time limit; also the reason its AbortSignal carries. */
export class DeliveryTimeoutError extends Error {
  constructor(limitMs: number) {
    super(`Outbox delivery ran past ${limitMs} ms`);
    this.name = 'DeliveryTimeout';
  }
}

const TIMED_OUT = Symbol('TIMED_OUT');

const byId = (a: EventRow, b: EventRow): number => {
  const d = BigInt(a.id) - BigInt(b.id);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
};

/**
 * The outbox poller (ADR-0010, backoff per ADR-0012 D9; performance audit, ADR-0027 D6).
 *
 * 1. **Claim** — one short transaction takes up to 100 due, unpublished events in id order with
 *    FOR UPDATE SKIP LOCKED, pushes their next_attempt_at out by a lease and writes this tick's
 *    random claim token, then commits. No row lock and no transaction is held while subscribers
 *    run (Razorpay, storage deletes …).
 * 2. **Deliver** — outside any transaction, in id order; subscribers run in their own
 *    transactions, within DELIVERY_TIMEOUT_MS per event.
 * 3. **Settle** — each event individually: published_at on success, or the failure, retry backoff
 *    and (at the limit) the dead letter in one small transaction. Every settle (and a hand-back)
 *    matches the claim token and clears it, so a tick that lost its claim changes nothing. A
 *    timed-out delivery keeps its claim until its handler returns (DELIVERY_TIMEOUT_MS).
 *
 * Parallel ticks never share a claimed event. Delivery is at-least-once: a claim whose tick died
 * comes back when the lease runs out. Order is as before: id order within a tick, and a failing
 * event never blocks later ones (it retries on its own backoff).
 */
@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);
  /** DELIVERY_TIMEOUT_MS; a test subclass shortens it. */
  protected readonly deliveryTimeoutMs: number = DELIVERY_TIMEOUT_MS;

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async tick(): Promise<PublishTickResult> {
    const now = this.clock();
    const claimToken = randomUUID();
    const rows = await this.claim(now, claimToken);
    const deadline = now.getTime() + TICK_DEADLINE_MS;
    let published = 0;
    let failed = 0;
    for (const [index, row] of rows.entries()) {
      if (this.clock().getTime() >= deadline) {
        await this.release(rows.slice(index), claimToken);
        break;
      }
      const failure = await this.deliver(toEvent(row));
      const settled =
        failure === null
          ? await this.markPublished(row, claimToken)
          : await this.settleFailure(row, failure, now, claimToken);
      if (!settled) {
        this.logger.warn(
          `Outbox ${row.event_type} ${row.event_id}: claim lost before settling (another tick owns it)`,
        );
      } else if (failure === null) {
        published += 1;
      } else {
        failed += 1;
      }
    }
    return { published, failed };
  }

  /**
   * Claims a batch and commits at once: the lease, not a row lock, keeps other ticks off it, and
   * the token says which tick holds it.
   */
  private async claim(now: Date, claimToken: string): Promise<EventRow[]> {
    const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
    const rows = await this.sql<EventRow[]>`
      WITH due AS (
        SELECT id FROM domain_events
        WHERE published_at IS NULL AND publish_attempts < ${MAX_PUBLISH_ATTEMPTS}
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
        ORDER BY id
        LIMIT ${PUBLISH_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE domain_events d SET next_attempt_at = ${leaseUntil}, claim_token = ${claimToken}
        FROM due WHERE d.id = due.id
      RETURNING d.id, d.event_id, d.event_type, d.aggregate_kind, d.aggregate_id, d.payload,
                d.occurred_at, d.publish_attempts`;
    return [...rows].sort(byId);
  }

  /** True when this tick still held the claim and the event is now published. */
  private async markPublished(row: EventRow, claimToken: string): Promise<boolean> {
    const updated = await this.sql`
      UPDATE domain_events
         SET published_at = ${this.clock()}, next_attempt_at = NULL, claim_token = NULL
       WHERE id = ${row.id} AND published_at IS NULL AND claim_token = ${claimToken}`;
    return updated.count > 0;
  }

  /** Hands unstarted claims back (due at once) so the next tick picks them up in id order. */
  private async release(rows: readonly EventRow[], claimToken: string): Promise<void> {
    if (rows.length === 0) return;
    await this.sql`
      UPDATE domain_events SET next_attempt_at = NULL, claim_token = NULL
       WHERE id IN ${this.sql(rows.map((r) => r.id))} AND published_at IS NULL
         AND claim_token = ${claimToken}`;
  }

  /** True when this tick still held the claim and the failure is recorded. */
  private async settleFailure(
    row: EventRow,
    failure: Failure,
    now: Date,
    claimToken: string,
  ): Promise<boolean> {
    const outcome = await this.sql.begin((tx) =>
      this.recordFailure(tx, row, failure, now, claimToken),
    );
    if (outcome === 'HELD' && failure.abandoned) {
      this.handBackWhenDone(row, claimToken, failure.abandoned);
    }
    return outcome !== 'LOST';
  }

  private async recordFailure(
    tx: postgres.TransactionSql,
    row: EventRow,
    failure: Failure,
    now: Date,
    claimToken: string,
  ): Promise<FailureOutcome> {
    const attempts = row.publish_attempts + 1;
    // Backoff from the moment of failure, not the start of the tick; a dead letter is parked
    // at 'infinity' so it drops out of the due-index scan instead of being re-read every tick.
    const deadLettered = attempts >= MAX_PUBLISH_ATTEMPTS;
    const at = this.clock().getTime();
    // A timed-out handler may still be running: keep the claim for a fresh lease, so no tick
    // starts a second copy; handBackWhenDone releases it on backoff once the handler returns.
    const held = failure.abandoned !== undefined && !deadLettered;
    const retryAt = new Date(
      held ? Math.max(at + backoffMs(attempts), at + CLAIM_LEASE_MS) : at + backoffMs(attempts),
    );
    // The claim token: a tick that outlived its lease never overwrites a newer tick's lease or
    // undoes another's delivery (a published event has no token).
    const updated = await tx`
      UPDATE domain_events
         SET publish_attempts = ${attempts},
             last_error = ${`${failure.subscriber}: ${failure.errorName}`},
             next_attempt_at = CASE WHEN ${deadLettered} THEN 'infinity'::timestamptz ELSE ${retryAt}::timestamptz END,
             claim_token = ${held ? claimToken : null}
       WHERE id = ${row.id} AND published_at IS NULL AND claim_token = ${claimToken}`;
    if (updated.count === 0) return 'LOST';
    if (attempts < MAX_PUBLISH_ATTEMPTS || row.event_type === DEAD_LETTER) {
      return held ? 'HELD' : 'RECORDED';
    }
    this.logger.error(
      `Dead letter: ${row.event_type} ${row.event_id} failed ${attempts} times in ${failure.subscriber}`,
    );
    await appendDomainEvent(tx, {
      eventType: DEAD_LETTER,
      aggregateKind: row.aggregate_kind,
      aggregateId: row.aggregate_id,
      occurredAt: now,
      payload: {
        event_id: row.event_id,
        event_type: row.event_type,
        aggregate_kind: row.aggregate_kind,
        aggregate_id: row.aggregate_id,
        subscriber: failure.subscriber,
        error: failure.errorName,
        attempts,
      },
    });
    return 'RECORDED';
  }

  /**
   * Once a timed-out delivery's handler returns, hands its still-held claim back: due on the
   * failure's backoff (never later than the lease already set). A no-op once the lease has run out
   * and another tick has claimed the event. Runs after the tick; it only logs, never throws.
   */
  private handBackWhenDone(row: EventRow, claimToken: string, abandoned: Promise<unknown>): void {
    const attempts = row.publish_attempts + 1;
    const label = `Outbox ${row.event_type} ${row.event_id}`;
    void abandoned
      .then(async () => {
        const retryAt = new Date(this.clock().getTime() + backoffMs(attempts));
        const updated = await this.sql`
          UPDATE domain_events
             SET next_attempt_at = LEAST(next_attempt_at, ${retryAt}::timestamptz),
                 claim_token = NULL
           WHERE id = ${row.id} AND published_at IS NULL AND claim_token = ${claimToken}`;
        if (updated.count > 0) {
          this.logger.warn(`${label}: the timed-out delivery has returned; retrying on backoff`);
        }
      })
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : typeof error;
        this.logger.warn(
          `${label}: could not hand the claim back (${name}); its lease will expire`,
        );
      });
  }

  /**
   * null on success; otherwise the first failing subscriber and its error class. The whole
   * delivery runs within the time limit: past it, the subscriber still running is the failure,
   * its signal is aborted, no later subscriber starts (they run on the retry), and the still-
   * running work is returned as `abandoned`. The timer is always cleared.
   */
  private async deliver(event: PublishedEvent): Promise<Failure | null> {
    const controller = new AbortController();
    const { signal } = controller;
    let running = '(none)';
    const work = (async (): Promise<Failure | null> => {
      for (const sub of this.subscribers.subscribersOf(event.eventType)) {
        if (signal.aborted) return null; // timed out: nobody reads this result any more
        running = sub.name;
        try {
          await sub.handle(event, signal);
        } catch (error) {
          if (signal.aborted) return null;
          const errorName = error instanceof Error ? error.name : typeof error;
          this.logger.warn(
            `Subscriber ${sub.name} failed on ${event.eventType} ${event.eventId} (${errorName})`,
          );
          return { subscriber: sub.name, errorName };
        }
      }
      return null;
    })();
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.deliveryTimeoutMs);
    });
    let outcome: Failure | null | typeof TIMED_OUT;
    try {
      outcome = await Promise.race([work, expired]);
    } finally {
      clearTimeout(timer);
    }
    if (outcome !== TIMED_OUT) return outcome;
    const timeout = new DeliveryTimeoutError(this.deliveryTimeoutMs);
    controller.abort(timeout);
    this.logger.warn(
      `Subscriber ${running} ran past ${this.deliveryTimeoutMs} ms on ${event.eventType} ${event.eventId}`,
    );
    return { subscriber: running, errorName: timeout.name, abandoned: work };
  }
}
