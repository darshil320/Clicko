import { Injectable } from '@nestjs/common';
import { type AccountRef, type Db, ownerColumn, type Tx } from '../notifications.types';
import type { RecipientPreferences } from '../pipeline/channel-plan';

export interface PreferencesRecord extends RecipientPreferences {
  readonly whatsappOptInAt: Date | null;
  readonly updatedAt: Date;
}

interface Row {
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: Date | null;
  mute_whatsapp: boolean;
  mute_sms: boolean;
  mute_push: boolean;
  updated_at: Date;
}

const toRecord = (r: Row): PreferencesRecord => ({
  whatsappOptIn: r.whatsapp_opt_in,
  whatsappOptInAt: r.whatsapp_opt_in_at,
  muteWhatsapp: r.mute_whatsapp,
  muteSms: r.mute_sms,
  mutePush: r.mute_push,
  updatedAt: r.updated_at,
});

/** notification_preferences: no row means the defaults (no WhatsApp opt-in, no mutes). */
@Injectable()
export class PreferencesRepository {
  async find(db: Db, owner: AccountRef): Promise<PreferencesRecord | null> {
    const col = ownerColumn(owner);
    const [row] = await db<Row[]>`
      SELECT whatsapp_opt_in, whatsapp_opt_in_at, mute_whatsapp, mute_sms, mute_push, updated_at
      FROM notification_preferences WHERE ${db(col)} = ${owner.id}`;
    return row ? toRecord(row) : null;
  }

  /** The row under FOR UPDATE, created with the defaults first if the account has none. */
  async lockOrCreate(tx: Tx, owner: AccountRef, now: Date): Promise<PreferencesRecord> {
    const col = ownerColumn(owner);
    const userId = owner.kind === 'USER' ? owner.id : null;
    const photographerId = owner.kind === 'PHOTOGRAPHER' ? owner.id : null;
    await tx`
      INSERT INTO notification_preferences (user_id, photographer_id, created_at, updated_at)
      VALUES (${userId}, ${photographerId}, ${now}, ${now})
      ON CONFLICT DO NOTHING`;
    const [row] = await tx<Row[]>`
      SELECT whatsapp_opt_in, whatsapp_opt_in_at, mute_whatsapp, mute_sms, mute_push, updated_at
      FROM notification_preferences WHERE ${tx(col)} = ${owner.id} FOR UPDATE`;
    if (!row) throw new Error('notification_preferences: no row after insert');
    return toRecord(row);
  }

  async update(
    tx: Tx,
    owner: AccountRef,
    p: RecipientPreferences & { readonly whatsappOptInAt: Date | null },
    now: Date,
  ): Promise<PreferencesRecord> {
    const col = ownerColumn(owner);
    const [row] = await tx<Row[]>`
      UPDATE notification_preferences
         SET whatsapp_opt_in = ${p.whatsappOptIn}, whatsapp_opt_in_at = ${p.whatsappOptInAt},
             mute_whatsapp = ${p.muteWhatsapp}, mute_sms = ${p.muteSms},
             mute_push = ${p.mutePush}, updated_at = ${now}
       WHERE ${tx(col)} = ${owner.id}
      RETURNING whatsapp_opt_in, whatsapp_opt_in_at, mute_whatsapp, mute_sms, mute_push, updated_at`;
    if (!row) throw new Error('notification_preferences: update matched no row');
    return toRecord(row);
  }
}
