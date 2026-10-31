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
}

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

const byId = (a: EventRow, b: EventRow): number => {
  const d = BigInt(a.id) - BigInt(b.id);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
};

/**
 * The outbox poller (ADR-0010, backoff per ADR-0012 D9; performance audit, ADR-0027 D6).
 *
 * 1. **Claim** — one short transaction takes up to 100 due, unpublished events in id order with
 *    FOR UPDATE SKIP LOCKED and pushes their next_attempt_at out by a lease, then commits. No row
 *    lock and no transaction is held while subscribers run (Razorpay, storage deletes …).
 * 2. **Deliver** — outside any transaction, in id order; subscribers run in their own transactions.
 * 3. **Settle** — each event individually: published_at on success, or the failure, retry backoff
 *    and (at the limit) the dead letter in one small transaction.
 *
 * Parallel ticks never share a claimed event. Delivery is at-least-once: a claim whose tick died
 * comes back when the lease runs out. Order is as before: id order within a tick, and a failing
 * event never blocks later ones (it retries on its own backoff).
 */
@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async tick(): Promise<PublishTickResult> {
    const now = this.clock();
    const rows = await this.claim(now);
    const deadline = now.getTime() + TICK_DEADLINE_MS;
    let published = 0;
    let failed = 0;
    for (const [index, row] of rows.entries()) {
      if (this.clock().getTime() >= deadline) {
        await this.release(rows.slice(index));
        break;
      }
      const failure = await this.deliver(toEvent(row));
      if (failure === null) {
        await this.sql`
          UPDATE domain_events SET published_at = ${this.clock()}, next_attempt_at = NULL
           WHERE id = ${row.id} AND published_at IS NULL`;
        published += 1;
      } else {
        await this.sql.begin((tx) => this.recordFailure(tx, row, failure, now));
        failed += 1;
      }
    }
    return { published, failed };
  }

  /** Claims a batch and commits at once: the lease, not a row lock, keeps other ticks off it. */
  private async claim(now: Date): Promise<EventRow[]> {
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
      UPDATE domain_events d SET next_attempt_at = ${leaseUntil}
        FROM due WHERE d.id = due.id
      RETURNING d.id, d.event_id, d.event_type, d.aggregate_kind, d.aggregate_id, d.payload,
                d.occurred_at, d.publish_attempts`;
    return [...rows].sort(byId);
  }

  /** Hands unstarted claims back (due at once) so the next tick picks them up in id order. */
  private async release(rows: readonly EventRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.sql`
      UPDATE domain_events SET next_attempt_at = NULL
       WHERE id IN ${this.sql(rows.map((r) => r.id))} AND published_at IS NULL`;
  }

  private async recordFailure(
    tx: postgres.TransactionSql,
    row: EventRow,
    failure: Failure,
    now: Date,
  ): Promise<void> {
    const attempts = row.publish_attempts + 1;
    // Backoff from the moment of failure, not the start of the tick; a dead letter is parked
    // at 'infinity' so it drops out of the due-index scan instead of being re-read every tick.
    const deadLettered = attempts >= MAX_PUBLISH_ATTEMPTS;
    const retryAt = new Date(this.clock().getTime() + backoffMs(attempts));
    // published_at IS NULL: a tick that outlived its lease never undoes another's delivery.
    const updated = await tx`
      UPDATE domain_events
         SET publish_attempts = ${attempts},
             last_error = ${`${failure.subscriber}: ${failure.errorName}`},
             next_attempt_at = CASE WHEN ${deadLettered} THEN 'infinity'::timestamptz ELSE ${retryAt}::timestamptz END
       WHERE id = ${row.id} AND published_at IS NULL`;
    if (updated.count === 0) return;
    if (attempts < MAX_PUBLISH_ATTEMPTS || row.event_type === DEAD_LETTER) return;
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
  }

  /** null on success; otherwise the first failing subscriber and its error class. */
  private async deliver(event: PublishedEvent): Promise<Failure | null> {
    for (const sub of this.subscribers.subscribersOf(event.eventType)) {
      try {
        await sub.handle(event);
      } catch (error) {
        const errorName = error instanceof Error ? error.name : typeof error;
        this.logger.warn(
          `Subscriber ${sub.name} failed on ${event.eventType} ${event.eventId} (${errorName})`,
        );
        return { subscriber: sub.name, errorName };
      }
    }
    return null;
  }
}
