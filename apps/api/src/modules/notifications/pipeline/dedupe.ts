import { createHash } from 'node:crypto';
import type { Recipient } from '../notifications.types';

/**
 * notification_sends.dedupe_key and the BullMQ job id: sha256 hex of event id | recipient kind |
 * recipient id | template code. The same event redelivered to the same recipient is the same
 * message — never sent twice on a channel (ADR-0027 D2). 64 hex characters: no ':' for BullMQ.
 */
export function dedupeKey(eventId: string, recipient: Recipient, templateCode: string): string {
  return createHash('sha256')
    .update(`${eventId}|${recipient.kind}|${recipient.id}|${templateCode}`)
    .digest('hex');
}
