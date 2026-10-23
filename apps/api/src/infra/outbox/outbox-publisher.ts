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
 * The outbox poller (ADR-0010, backoff per ADR-0012 D9). One tick claims up to 100 due,
 * unpublished events in id order with FOR UPDATE SKIP LOCKED (parallel ticks never share an
 * event), hands each to its subscribers and marks it published — or records the failure, schedules
 * the retry and moves on. Subscribers run in their own transactions.
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
    return this.sql.begin(async (tx) => {
      const rows = await tx<EventRow[]>`
        SELECT id, event_id, event_type, aggregate_kind, aggregate_id, payload, occurred_at,
               publish_attempts
        FROM domain_events
        WHERE published_at IS NULL AND publish_attempts < ${MAX_PUBLISH_ATTEMPTS}
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
        ORDER BY id
        LIMIT ${PUBLISH_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED`;
      let published = 0;
      let failed = 0;
      for (const row of rows) {
        const failure = await this.deliver(toEvent(row));
        if (failure === null) {
          await tx`UPDATE domain_events SET published_at = ${this.clock()} WHERE id = ${row.id}`;
          published += 1;
        } else {
          await this.recordFailure(tx, row, failure, now);
          failed += 1;
        }
      }
      return { published, failed };
    });
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
    await tx`
      UPDATE domain_events
         SET publish_attempts = ${attempts},
             last_error = ${`${failure.subscriber}: ${failure.errorName}`},
             next_attempt_at = CASE WHEN ${deadLettered} THEN 'infinity'::timestamptz ELSE ${retryAt}::timestamptz END
       WHERE id = ${row.id}`;
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
