import { Injectable } from '@nestjs/common';
import type { Db, SendRecord } from '../notifications.types';
import type { Channel } from '../templates/templates';

/** What has already happened for one dedupe key (a redelivered event or a BullMQ retry). */
export interface SendOutcomes {
  readonly sentChannels: ReadonlySet<Channel>;
  readonly skipped: boolean;
}

/**
 * notification_sends: append-only (INSERT and SELECT only; migration 0015 revokes the rest). The
 * partial unique index (dedupe_key, channel) WHERE status = 'SENT' is the idempotency backstop:
 * a second SENT row for the same message and channel is dropped.
 */
@Injectable()
export class NotificationSendsRepository {
  /** false when a SENT row for this dedupe key and channel already existed. */
  async insert(db: Db, s: SendRecord): Promise<boolean> {
    const rows = await db`
      INSERT INTO notification_sends
        (dedupe_key, event_id, event_type, template_code, template_version, channel,
         recipient_kind, recipient_id, booking_id, destination_masked, status, provider,
         provider_message_id, error_code, created_at)
      VALUES (${s.dedupeKey}, ${s.eventId}, ${s.eventType}, ${s.templateCode},
              ${s.templateVersion}, ${s.channel}, ${s.recipient.kind}, ${s.recipient.id},
              ${s.bookingId}, ${s.destinationMasked}, ${s.status}, ${s.provider},
              ${s.providerMessageId}, ${s.errorCode}, ${s.at})
      ON CONFLICT (dedupe_key, channel) WHERE status = 'SENT' DO NOTHING
      RETURNING id`;
    return rows.length > 0;
  }

  async outcomes(db: Db, dedupeKey: string): Promise<SendOutcomes> {
    const rows = await db<{ channel: Channel | null; status: string }[]>`
      SELECT DISTINCT channel, status FROM notification_sends
      WHERE dedupe_key = ${dedupeKey} AND status IN ('SENT', 'SKIPPED')`;
    return {
      sentChannels: new Set(
        rows.flatMap((r) => (r.status === 'SENT' && r.channel ? [r.channel] : [])),
      ),
      skipped: rows.some((r) => r.status === 'SKIPPED'),
    };
  }
}
