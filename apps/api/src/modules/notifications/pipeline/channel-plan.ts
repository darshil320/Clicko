import type { Channel, TemplateDef } from '../templates/templates';

/** 21:00–08:00 IST: non-essential messages wait (ADR-0027 D2). */
export const QUIET_HOURS = { startHourIst: 21, endHourIst: 8 } as const;
const IST_OFFSET_MS = 330 * 60_000;
const HOUR_MS = 3_600_000;

/**
 * When a message of this category may go: `now`, or — for a non-essential one inside quiet hours —
 * the next 08:00 IST.
 */
export function sendableAt(category: TemplateDef['category'], now: Date): Date {
  if (category === 'transactional') return now;
  const istMs = now.getTime() + IST_OFFSET_MS;
  const dayStartIst = Math.floor(istMs / (24 * HOUR_MS)) * 24 * HOUR_MS;
  const hour = (istMs - dayStartIst) / HOUR_MS;
  if (hour >= QUIET_HOURS.endHourIst && hour < QUIET_HOURS.startHourIst) return now;
  const nextEndIst =
    hour < QUIET_HOURS.endHourIst
      ? dayStartIst + QUIET_HOURS.endHourIst * HOUR_MS
      : dayStartIst + (24 + QUIET_HOURS.endHourIst) * HOUR_MS;
  return new Date(nextEndIst - IST_OFFSET_MS);
}

export interface RecipientPreferences {
  readonly whatsappOptIn: boolean;
  readonly muteWhatsapp: boolean;
  readonly muteSms: boolean;
  readonly mutePush: boolean;
}

export const DEFAULT_PREFERENCES: RecipientPreferences = {
  whatsappOptIn: false,
  muteWhatsapp: false,
  muteSms: false,
  mutePush: false,
};

export interface ChannelPlan {
  /** Tried in order until one succeeds: WhatsApp first, SMS as the fallback. */
  readonly messaging: readonly ('WHATSAPP' | 'SMS')[];
  readonly push: boolean;
  /** Why nothing goes, when nothing does. */
  readonly skipReason: 'OPTED_OUT' | 'NO_CHANNEL' | null;
}

/**
 * The per-recipient channel plan (ADR-0027 D2). WhatsApp only with an explicit opt-in (Meta
 * policy); SMS otherwise, and as the fallback when WhatsApp fails. Push for app users with a
 * registered device. Mutes silence non-essential messages only — transactional ones always go.
 */
export function planChannels(
  def: Pick<TemplateDef, 'channels' | 'category'>,
  prefs: RecipientPreferences,
  pushTokens: number,
): ChannelPlan {
  const essential = def.category === 'transactional';
  const has = (c: Channel) => def.channels.includes(c);
  const messaging: ('WHATSAPP' | 'SMS')[] = [];
  let mutedSomething = false;
  if (has('WHATSAPP') && prefs.whatsappOptIn) {
    if (essential || !prefs.muteWhatsapp) messaging.push('WHATSAPP');
    else mutedSomething = true;
  }
  if (has('SMS')) {
    if (essential || !prefs.muteSms) messaging.push('SMS');
    else mutedSomething = true;
  }
  let push = false;
  if (has('PUSH') && pushTokens > 0) {
    if (essential || !prefs.mutePush) push = true;
    else mutedSomething = true;
  }
  const nothing = messaging.length === 0 && !push;
  return {
    messaging,
    push,
    skipReason: nothing ? (mutedSomething ? 'OPTED_OUT' : 'NO_CHANNEL') : null,
  };
}
