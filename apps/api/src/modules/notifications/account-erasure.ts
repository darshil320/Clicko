import { Injectable } from '@nestjs/common';
import type { Tx } from './notifications.types';

export interface NotificationErasure {
  readonly pushTokens: number;
  readonly preferences: number;
}

/**
 * Account deletion (ADR-0030): a deleted client's app installs and notification preferences are
 * removed outright, in the deletion's transaction. notification_sends (append-only, destinations
 * masked) is kept as the record of what was sent.
 */
@Injectable()
export class NotificationAccountErasure {
  async eraseClient(tx: Tx, userId: string): Promise<NotificationErasure> {
    const tokens = await tx`DELETE FROM device_push_tokens WHERE user_id = ${userId}`;
    const prefs = await tx`DELETE FROM notification_preferences WHERE user_id = ${userId}`;
    return { pushTokens: tokens.count, preferences: prefs.count };
  }
}
