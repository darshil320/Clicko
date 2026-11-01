import type {
  NotificationPreferencesView,
  RegisterPushTokenBody,
  RegisterPushTokenResponse,
  UnregisterPushTokenResponse,
  UpdateNotificationPreferencesBody,
} from '@clickco/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import type { AccountRef } from './notifications.types';
import { DEFAULT_PREFERENCES, type RecipientPreferences } from './pipeline/channel-plan';
import { PreferencesRepository } from './repositories/preferences.repository';
import { PushTokensRepository } from './repositories/push-tokens.repository';

/** At most this many live push tokens per account (installs); the least recently seen go first. */
export const MAX_LIVE_PUSH_TOKENS = 10;

/**
 * A token another account holds and saw within this long is revoked, not moved (security review
 * L4): an install that changed accounts registers again on its next start and then moves.
 */
export const PUSH_TOKEN_MOVE_AFTER_MS = 24 * 3_600_000;

const view = (p: RecipientPreferences, updatedAt: Date | null): NotificationPreferencesView => ({
  whatsappOptIn: p.whatsappOptIn,
  muteWhatsapp: p.muteWhatsapp,
  muteSms: p.muteSms,
  mutePush: p.mutePush,
  updatedAt: updatedAt ? updatedAt.toISOString() : null,
});

/**
 * What a client or photographer controls (ADR-0027 D2): their app installs' push tokens and their
 * notification preferences. Transactional messages ignore the mutes; WhatsApp needs an explicit
 * opt-in, recorded with its time (evidence for Meta's policy).
 */
@Injectable()
export class NotificationSettingsService {
  private readonly logger = new Logger(NotificationSettingsService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PushTokensRepository) private readonly tokens: PushTokensRepository,
    @Inject(PreferencesRepository) private readonly preferences: PreferencesRepository,
  ) {}

  /**
   * Registers or refreshes. A token another account holds moves here only once that hold is
   * revoked or stale; a live, recent one is revoked instead and `registered` is false.
   */
  async registerPushToken(
    owner: AccountRef,
    body: RegisterPushTokenBody,
  ): Promise<RegisterPushTokenResponse> {
    const now = this.clock();
    const result = await this.sql.begin(async (tx) => {
      const r = await this.tokens.register(
        tx,
        owner,
        body.token,
        body.platform,
        now,
        PUSH_TOKEN_MOVE_AFTER_MS,
      );
      await this.tokens.cap(tx, owner, MAX_LIVE_PUSH_TOKENS, now);
      return r;
    });
    // Never the token: only that an install changed hands.
    if (result.outcome === 'MOVED') this.logger.log(`A push token moved to a ${owner.kind}`);
    if (result.outcome === 'REFUSED') {
      this.logger.warn(`A push token live on another account was revoked (${owner.kind} asked)`);
    }
    return {
      registered: result.outcome !== 'REFUSED',
      platform: body.platform,
      lastSeenAt: result.lastSeenAt.toISOString(),
    };
  }

  /** Only the caller's own token; the same answer whether or not it was registered. */
  async unregisterPushToken(
    owner: AccountRef,
    token: string,
  ): Promise<UnregisterPushTokenResponse> {
    await this.tokens.revokeOwn(this.sql, owner, token, this.clock());
    return { unregistered: true };
  }

  async view(owner: AccountRef): Promise<NotificationPreferencesView> {
    const row = await this.preferences.find(this.sql, owner);
    return row ? view(row, row.updatedAt) : view(DEFAULT_PREFERENCES, null);
  }

  async update(
    owner: AccountRef,
    body: UpdateNotificationPreferencesBody,
  ): Promise<NotificationPreferencesView> {
    const now = this.clock();
    const saved = await this.sql.begin(async (tx) => {
      const current = await this.preferences.lockOrCreate(tx, owner, now);
      const next = {
        whatsappOptIn: body.whatsappOptIn ?? current.whatsappOptIn,
        muteWhatsapp: body.muteWhatsapp ?? current.muteWhatsapp,
        muteSms: body.muteSms ?? current.muteSms,
        mutePush: body.mutePush ?? current.mutePush,
      };
      // A new opt-in is stamped now; keeping it keeps its time; withdrawing it clears it.
      const whatsappOptInAt = next.whatsappOptIn
        ? current.whatsappOptIn
          ? current.whatsappOptInAt
          : now
        : null;
      return this.preferences.update(tx, owner, { ...next, whatsappOptInAt }, now);
    });
    return view(saved, saved.updatedAt);
  }
}
