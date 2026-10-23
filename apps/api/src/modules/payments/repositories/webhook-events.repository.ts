import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { Db } from '../payments.types';

export interface WebhookRow {
  readonly provider: string;
  readonly eventType: string;
  readonly payload: postgres.JSONValue;
  readonly receivedAt: Date;
}

/** payment_webhook_events: every webhook stored raw and deduped (schema §11). */
@Injectable()
export class WebhookEventsRepository {
  /**
   * Bad signatures are kept for forensics under a random id, so a forged request can never
   * pre-claim a real event id and make the genuine webhook look like a duplicate.
   */
  async recordInvalid(db: Db, w: WebhookRow): Promise<void> {
    await db`
      INSERT INTO payment_webhook_events
        (provider, provider_event_id, event_type, signature_valid, payload, received_at)
      VALUES (${w.provider}, ${`invalid:${randomUUID()}`}, ${w.eventType}, false,
              ${db.json(w.payload)}, ${w.receivedAt})`;
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
        (provider, provider_event_id, event_type, signature_valid, payload, received_at)
      VALUES (${w.provider}, ${w.providerEventId}, ${w.eventType}, true, ${db.json(w.payload)},
              ${w.receivedAt})
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
