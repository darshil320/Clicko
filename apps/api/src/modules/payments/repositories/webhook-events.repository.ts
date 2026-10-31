import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { Db } from '../payments.types';

export interface WebhookRow {
  readonly provider: string;
  readonly eventType: string;
  /** What Clickco parsed from the webhook (webhook-record.ts) — never the raw payload (L1). */
  readonly payload: postgres.JSONValue;
  /** sha256 of the exact signed body: proves what arrived without keeping it. */
  readonly bodySha256: string;
  readonly receivedAt: Date;
}

export interface RejectedWebhook {
  readonly provider: string;
  /** The start of the UTC hour the attempt falls in. */
  readonly bucketStart: Date;
  readonly bodySha256: string;
  readonly bodyBytes: number;
  readonly receivedAt: Date;
}

/** payment_webhook_events: every verified webhook, deduped (schema §11, addendum 0012). */
@Injectable()
export class WebhookEventsRepository {
  /**
   * Audit M3: a bad signature is counted per provider per hour with a sample of its body hash —
   * one row per hour, not per attempt, so a flood cannot fill the table. Nothing in this table
   * can pre-claim a genuine event id.
   */
  async countRejected(db: Db, r: RejectedWebhook): Promise<void> {
    await db`
      INSERT INTO payment_webhook_rejections AS w
        (provider, bucket_start, rejected_count, first_body_sha256, last_body_sha256,
         last_body_bytes, last_received_at)
      VALUES (${r.provider}, ${r.bucketStart}, 1, ${r.bodySha256}, ${r.bodySha256},
              ${r.bodyBytes}, ${r.receivedAt})
      ON CONFLICT (provider, bucket_start) DO UPDATE
        SET rejected_count   = w.rejected_count + 1,
            last_body_sha256 = EXCLUDED.last_body_sha256,
            last_body_bytes  = EXCLUDED.last_body_bytes,
            last_received_at = greatest(w.last_received_at, EXCLUDED.last_received_at)`;
  }

  /**
   * Insert-or-find on (provider, provider_event_id). A row that exists but was never processed
   * (its processing failed) is handed back for another attempt; a processed one is a duplicate.
   */
  async claim(
    db: Db,
    w: WebhookRow & { providerEventId: string },
  ): Promise<{ id: string; alreadyProcessed: boolean }> {
    const [inserted] = await db<{ id: string }[]>`
      INSERT INTO payment_webhook_events
        (provider, provider_event_id, event_type, signature_valid, payload, body_sha256,
         received_at)
      VALUES (${w.provider}, ${w.providerEventId}, ${w.eventType}, true, ${db.json(w.payload)},
              ${w.bodySha256}, ${w.receivedAt})
      ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`;
    if (inserted) return { id: inserted.id, alreadyProcessed: false };
    const [existing] = await db<{ id: string; processed_at: Date | null }[]>`
      SELECT id, processed_at FROM payment_webhook_events
      WHERE provider = ${w.provider} AND provider_event_id = ${w.providerEventId}`;
    if (!existing) throw new Error('webhook claim: row vanished after a conflict');
    return { id: existing.id, alreadyProcessed: existing.processed_at !== null };
  }

  async markProcessed(db: Db, id: string, note: string | null, at: Date): Promise<void> {
    await db`
      UPDATE payment_webhook_events SET processed_at = ${at}, processing_error = ${note}
       WHERE id = ${id}`;
  }

  /** Leaves processed_at NULL so the gateway's retry processes it again. */
  async markFailed(db: Db, id: string, error: string): Promise<void> {
    await db`UPDATE payment_webhook_events SET processing_error = ${error} WHERE id = ${id}`;
  }
}
