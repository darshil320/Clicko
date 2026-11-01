import type postgres from 'postgres';
import type { Channel } from './templates/templates';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

/**
 * Who a message is for. USER and PHOTOGRAPHER are app accounts (preferences, push tokens);
 * SUBJECT is a booking's person at the venue (G-08), reached by SMS on the booking's own number —
 * its recipient id is the booking id.
 */
export type RecipientKind = 'USER' | 'PHOTOGRAPHER' | 'SUBJECT';

/** An app account that owns push tokens and preferences. */
export interface AccountRef {
  readonly kind: 'USER' | 'PHOTOGRAPHER';
  readonly id: string;
}

export interface Recipient {
  readonly kind: RecipientKind;
  readonly id: string;
}

export const isAccount = (r: Recipient): r is AccountRef =>
  r.kind === 'USER' || r.kind === 'PHOTOGRAPHER';

/** The owner column of device_push_tokens / notification_preferences for an account. */
export const ownerColumn = (a: AccountRef): 'user_id' | 'photographer_id' =>
  a.kind === 'USER' ? 'user_id' : 'photographer_id';

export type SendStatus = 'SENT' | 'FAILED' | 'SKIPPED';

/** Why nothing was sent to a recipient (notification_sends.error_code of a SKIPPED row). */
export type SkipReason =
  | 'OPTED_OUT'
  | 'NO_CHANNEL'
  | 'NO_DESTINATION'
  | 'INVALID_VARIABLES'
  | 'NO_LONGER_RELEVANT';

export interface SendRecord {
  readonly dedupeKey: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly templateCode: string;
  readonly templateVersion: number;
  readonly channel: Channel | null;
  readonly recipient: Recipient;
  readonly bookingId: string | null;
  readonly destinationMasked: string | null;
  readonly status: SendStatus;
  readonly provider: string | null;
  readonly providerMessageId: string | null;
  readonly errorCode: string | null;
  readonly at: Date;
}
